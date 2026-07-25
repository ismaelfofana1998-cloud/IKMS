-- ============================================================================
-- 60 - Personnalisation de la page d'inscription entreprise (superadmin)
-- A executer apres 59_personnalisation_accroches_generiques.sql.
--
-- Distinct de la personnalisation par tenant (patches 34/35/59) : cette
-- page (entreprise-inscription.html) n'appartient a AUCUNE entreprise -- 
-- c'est la ou une future entreprise s'inscrit, donc seul le super_admin
-- (l'editeur du logiciel) peut la modifier. Une seule ligne de parametres
-- globaux, pas de id_entreprise.
-- ============================================================================

begin;

create table if not exists public.parametres_plateforme (
  cle text primary key,
  valeur text,
  maj_le timestamptz not null default now()
);

alter table public.parametres_plateforme enable row level security;

revoke all on public.parametres_plateforme from public, anon, authenticated;
grant select on public.parametres_plateforme to anon, authenticated;

create policy sel_parametres_plateforme_public on public.parametres_plateforme for select
using (true);

create policy maj_parametres_plateforme_superadmin on public.parametres_plateforme for all
using (public.est_super_admin())
with check (public.est_super_admin());

-- Lecture en une seule fois, transformee en objet cle/valeur cote client
-- plutot qu'une liste de lignes -- la page d'inscription (anonyme) n'a besoin
-- que de ca, jamais d'ecrire.
create or replace function public.rpc_lire_parametres_plateforme()
returns table (cle text, valeur text)
language sql stable security definer set search_path = public as $$
  select cle, valeur from public.parametres_plateforme;
$$;
grant execute on function public.rpc_lire_parametres_plateforme to anon, authenticated;

-- Ecriture reservee au super_admin -- upsert simple, une cle a la fois pour
-- que l'apercu en temps reel puisse sauvegarder chaque champ independamment
-- sans attendre que tout le formulaire soit rempli.
create or replace function public.rpc_definir_parametre_plateforme(p_cle text, p_valeur text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.est_super_admin() then
    raise exception 'Reserve au super-admin.';
  end if;
  insert into public.parametres_plateforme (cle, valeur, maj_le)
  values (p_cle, p_valeur, now())
  on conflict (cle) do update set valeur = excluded.valeur, maj_le = now();
end;
$$;
grant execute on function public.rpc_definir_parametre_plateforme to authenticated;

-- Image de fond du hero -- bucket dedie (distinct de "personnalisation",
-- qui est scope par entreprise) : ici un seul fichier, jamais de dossier
-- par tenant puisque cette page n'appartient a aucun tenant.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plateforme', 'plateforme', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "plateforme_lecture_publique" on storage.objects for select
using (bucket_id = 'plateforme');

create policy "plateforme_ecriture_superadmin" on storage.objects for insert
with check (bucket_id = 'plateforme' and public.est_super_admin());

create policy "plateforme_maj_superadmin" on storage.objects for update
using (bucket_id = 'plateforme' and public.est_super_admin());

create policy "plateforme_suppression_superadmin" on storage.objects for delete
using (bucket_id = 'plateforme' and public.est_super_admin());

commit;

select 'fix_60_ok' as status;
