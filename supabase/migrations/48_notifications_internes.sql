-- ============================================================================
-- 48 - Notifications internes (hub + livreurs)
-- A executer apres 47_caisse_agents_et_hub.sql.
--
-- En attendant les identifiants reels Orange (SMS) et Wave, un systeme de
-- notification qui fonctionne entierement a l'interieur de l'application --
-- pas besoin de fournisseur externe. Une notification cible soit une
-- PERSONNE precise (un livreur qu'on vient d'assigner), soit un HUB entier
-- (n'importe quel agent de ce hub peut la voir et la traiter -- utile
-- quand on ne sait pas quel agent precis sera de service).
-- ============================================================================

begin;

create table if not exists public.notifications_internes (
  id uuid primary key default gen_random_uuid(),
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  id_utilisateur uuid references public.utilisateurs(id_utilisateur),
  id_hub uuid references public.hubs(id_hub),
  type text not null,
  message text not null,
  lien text,
  lu boolean not null default false,
  cree_le timestamptz not null default now(),
  constraint notifications_cible_check check (
    (id_utilisateur is not null and id_hub is null) or
    (id_utilisateur is null and id_hub is not null)
  )
);
create index if not exists idx_notifications_utilisateur on public.notifications_internes(id_utilisateur) where not lu;
create index if not exists idx_notifications_hub on public.notifications_internes(id_hub) where not lu;

alter table public.notifications_internes enable row level security;

-- Visible : la notification qui m'est adressee personnellement, OU une
-- notification de mon hub si j'y suis rattache (agent) -- jamais celles
-- d'un autre hub ni d'un autre utilisateur.
create policy sel_notifications on public.notifications_internes for select
using (
  id_utilisateur = auth.uid()
  or (id_hub is not null and id_hub = (select u.id_hub_affecte from public.utilisateurs u where u.id_utilisateur = auth.uid()))
  or public.jwt_role() in ('admin','super_admin')
);

create policy upd_notifications_lu on public.notifications_internes for update
using (
  id_utilisateur = auth.uid()
  or (id_hub is not null and id_hub = (select u.id_hub_affecte from public.utilisateurs u where u.id_utilisateur = auth.uid()))
);

grant select, update on public.notifications_internes to authenticated;

-- ----------------------------------------------------------------------------
-- Creation : un membre du personnel notifie soit une personne precise, soit
-- tout un hub -- jamais quelqu'un hors de sa propre entreprise.
-- ----------------------------------------------------------------------------
create or replace function public.rpc_creer_notification(
  p_id_utilisateur uuid default null, p_id_hub uuid default null,
  p_type text default 'INFO', p_message text default '', p_lien text default null,
  p_acteur uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_entreprise uuid := public.entreprise_de(v_acteur);
begin
  if p_id_utilisateur is null and p_id_hub is null then
    raise exception 'Precise soit un utilisateur, soit un hub.';
  end if;
  if p_id_utilisateur is not null and not exists (
    select 1 from public.utilisateurs u where u.id_utilisateur = p_id_utilisateur and u.id_entreprise = v_entreprise
  ) then
    raise exception 'Destinataire hors de votre entreprise.';
  end if;
  if p_id_hub is not null and not exists (
    select 1 from public.hubs h where h.id_hub = p_id_hub and h.id_entreprise = v_entreprise
  ) then
    raise exception 'Hub hors de votre entreprise.';
  end if;

  insert into public.notifications_internes (id_entreprise, id_utilisateur, id_hub, type, message, lien)
  values (v_entreprise, p_id_utilisateur, p_id_hub, p_type, p_message, p_lien);
end;
$$;
grant execute on function public.rpc_creer_notification to authenticated;

create or replace function public.rpc_lister_mes_notifications(p_limite int default 30)
returns table (id uuid, type text, message text, lien text, lu boolean, cree_le timestamptz)
language sql stable security definer set search_path = public as $$
  select n.id, n.type, n.message, n.lien, n.lu, n.cree_le
  from public.notifications_internes n
  where n.id_utilisateur = auth.uid()
     or (n.id_hub is not null and n.id_hub = (select u.id_hub_affecte from public.utilisateurs u where u.id_utilisateur = auth.uid()))
  order by n.cree_le desc
  limit p_limite;
$$;
grant execute on function public.rpc_lister_mes_notifications to authenticated;

create or replace function public.rpc_compter_notifications_non_lues()
returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.notifications_internes n
  where not n.lu and (
    n.id_utilisateur = auth.uid()
    or (n.id_hub is not null and n.id_hub = (select u.id_hub_affecte from public.utilisateurs u where u.id_utilisateur = auth.uid()))
  );
$$;
grant execute on function public.rpc_compter_notifications_non_lues to authenticated;

create or replace function public.rpc_marquer_notification_lue(p_id uuid)
returns void
language sql security definer set search_path = public as $$
  update public.notifications_internes set lu = true where id = p_id;
$$;
grant execute on function public.rpc_marquer_notification_lue to authenticated;

create or replace function public.rpc_marquer_toutes_notifications_lues()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.notifications_internes n set lu = true
  where not n.lu and (
    n.id_utilisateur = auth.uid()
    or (n.id_hub is not null and n.id_hub = (select u.id_hub_affecte from public.utilisateurs u where u.id_utilisateur = auth.uid()))
  );
end;
$$;
grant execute on function public.rpc_marquer_toutes_notifications_lues to authenticated;

commit;

select 'fix_48_ok' as status;
