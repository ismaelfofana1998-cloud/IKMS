-- ============================================================================
-- 60 - Groupes tarifaires et tarif intra-zone
-- A executer apres 59_confirmation_hub_retour.sql.
--
-- Une zone garde son code metier precis. Le prix est resolu dans cet ordre :
--   1. exception exacte entre deux zones ;
--   2. tarif propre a la zone, si depart = arrivee ;
--   3. tarif entre les groupes des deux zones.
--
-- Le contrat public reste inchange : rpc_estimer_tarif et rpc_creer_commande
-- continuent d'appeler tarif_zone_zone avec deux codes de zone.
-- ============================================================================

begin;

create table if not exists public.groupes_tarifaires (
  id_groupe uuid primary key default gen_random_uuid(),
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  code text not null,
  nom text not null,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (id_entreprise, code),
  unique (id_entreprise, id_groupe)
);

create index if not exists idx_groupes_tarifaires_entreprise
  on public.groupes_tarifaires(id_entreprise, actif);

create table if not exists public.tarifs_groupes (
  id bigint generated always as identity primary key,
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  groupe_a uuid not null,
  groupe_b uuid not null,
  montant numeric(12,2) not null check (montant > 0),
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  constraint tarifs_groupes_ordre check (groupe_a <= groupe_b),
  constraint tarifs_groupes_a_entreprise_fk
    foreign key (id_entreprise, groupe_a)
    references public.groupes_tarifaires(id_entreprise, id_groupe),
  constraint tarifs_groupes_b_entreprise_fk
    foreign key (id_entreprise, groupe_b)
    references public.groupes_tarifaires(id_entreprise, id_groupe),
  unique (id_entreprise, groupe_a, groupe_b)
);

create index if not exists idx_tarifs_groupes_entreprise
  on public.tarifs_groupes(id_entreprise, actif);

alter table public.zones_tarification
  add column if not exists id_groupe_tarifaire uuid,
  add column if not exists tarif_intra_zone numeric(12,2)
    check (tarif_intra_zone is null or tarif_intra_zone > 0);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'zones_groupe_tarifaire_entreprise_fk'
      and conrelid = 'public.zones_tarification'::regclass
  ) then
    alter table public.zones_tarification
      add constraint zones_groupe_tarifaire_entreprise_fk
      foreign key (id_entreprise, id_groupe_tarifaire)
      references public.groupes_tarifaires(id_entreprise, id_groupe);
  end if;
end;
$$;

create index if not exists idx_zones_tarification_groupe
  on public.zones_tarification(id_entreprise, id_groupe_tarifaire)
  where actif;

-- Reprend les eventuels tarifs historiques zone -> elle-meme. Les exceptions
-- restent en place et prioritaires : cette copie rend simplement le nouveau
-- champ immediatement lisible dans l'interface.
update public.zones_tarification z
set tarif_intra_zone = p.montant
from public.zones_tarifs_paires p
where p.id_entreprise = z.id_entreprise
  and p.actif
  and p.zone_a = z.code_zone
  and p.zone_b = z.code_zone
  and z.tarif_intra_zone is null;

alter table public.groupes_tarifaires enable row level security;
alter table public.tarifs_groupes enable row level security;

create policy sel_groupes_tarifaires on public.groupes_tarifaires
for select using (
  id_entreprise = (select public.entreprise_de())
  or (select public.est_super_admin())
);

create policy ins_groupes_tarifaires on public.groupes_tarifaires
for insert with check (
  id_entreprise = (select public.entreprise_de())
  or (select public.est_super_admin())
);

create policy upd_groupes_tarifaires on public.groupes_tarifaires
for update using (
  id_entreprise = (select public.entreprise_de())
  or (select public.est_super_admin())
) with check (
  id_entreprise = (select public.entreprise_de())
  or (select public.est_super_admin())
);

create policy sel_tarifs_groupes on public.tarifs_groupes
for select using (
  id_entreprise = (select public.entreprise_de())
  or (select public.est_super_admin())
);

create policy ins_tarifs_groupes on public.tarifs_groupes
for insert with check (
  id_entreprise = (select public.entreprise_de())
  or (select public.est_super_admin())
);

create policy upd_tarifs_groupes on public.tarifs_groupes
for update using (
  id_entreprise = (select public.entreprise_de())
  or (select public.est_super_admin())
) with check (
  id_entreprise = (select public.entreprise_de())
  or (select public.est_super_admin())
);

grant select, insert, update on public.groupes_tarifaires to authenticated;
grant select, insert, update on public.tarifs_groupes to authenticated;

create or replace function public.tarif_zone_zone(
  p_entreprise uuid,
  p_zone_depart text,
  p_zone_arrivee text
) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_zone_depart text := upper(trim(coalesce(p_zone_depart, '')));
  v_zone_arrivee text := upper(trim(coalesce(p_zone_arrivee, '')));
  v_groupe_depart uuid;
  v_groupe_arrivee uuid;
  v_tarif_intra numeric;
  v_montant numeric;
begin
  if v_zone_depart = '' or v_zone_arrivee = '' then
    return null;
  end if;

  select p.montant into v_montant
  from public.zones_tarifs_paires p
  where p.id_entreprise = p_entreprise
    and p.actif
    and p.zone_a = least(v_zone_depart, v_zone_arrivee)
    and p.zone_b = greatest(v_zone_depart, v_zone_arrivee);

  if found then
    return v_montant;
  end if;

  select z.id_groupe_tarifaire, z.tarif_intra_zone
  into v_groupe_depart, v_tarif_intra
  from public.zones_tarification z
  where z.id_entreprise = p_entreprise
    and z.code_zone = v_zone_depart
    and z.actif;

  if not found then
    return null;
  end if;

  if v_zone_depart = v_zone_arrivee and v_tarif_intra is not null then
    return v_tarif_intra;
  end if;

  select z.id_groupe_tarifaire into v_groupe_arrivee
  from public.zones_tarification z
  where z.id_entreprise = p_entreprise
    and z.code_zone = v_zone_arrivee
    and z.actif;

  if not found or v_groupe_depart is null or v_groupe_arrivee is null then
    return null;
  end if;

  select t.montant into v_montant
  from public.tarifs_groupes t
  where t.id_entreprise = p_entreprise
    and t.actif
    and t.groupe_a = least(v_groupe_depart, v_groupe_arrivee)
    and t.groupe_b = greatest(v_groupe_depart, v_groupe_arrivee);

  return v_montant;
end;
$$;

-- L'API de lecture conserve exactement sa signature, mais expose maintenant
-- la grille effective (exceptions + tarifs locaux + groupes).
create or replace function public.interne_lister_tarifs_entreprise(
  p_id_entreprise uuid
) returns table (zone_a text, zone_b text, montant numeric)
language sql stable security definer set search_path = public as $$
  select z1.code_zone,
         z2.code_zone,
         public.tarif_zone_zone(
           p_id_entreprise,
           z1.code_zone,
           z2.code_zone
         )
  from public.zones_tarification z1
  join public.zones_tarification z2
    on z2.id_entreprise = z1.id_entreprise
   and z1.code_zone <= z2.code_zone
  where z1.id_entreprise = p_id_entreprise
    and z1.actif
    and z2.actif
    and public.tarif_zone_zone(
      p_id_entreprise,
      z1.code_zone,
      z2.code_zone
    ) is not null
  order by z1.code_zone, z2.code_zone;
$$;

revoke all on function public.interne_lister_tarifs_entreprise(uuid)
  from public, anon, authenticated;
grant execute on function public.interne_lister_tarifs_entreprise(uuid)
  to service_role;

commit;

select 'fix_60_ok' as status;
