-- ============================================================================
-- 34 - Stockage des images de personnalisation (page expéditeur par tenant)
-- A executer apres 33_gestion_abonnement_super_admin.sql.
-- ============================================================================
--
-- LIMITE IMPORTANTE A CONNAITRE : contrairement a tous les autres patches de
-- ce projet, celui-ci n'a PAS pu etre teste sur un Postgres local classique
-- -- le schema "storage" (buckets, objects, RLS specifique) est une
-- extension propre a l'infrastructure Supabase, absente d'une installation
-- Postgres standard. Tout ce qui suit est ecrit selon la documentation et les
-- conventions Supabase Storage, mais merite une verification manuelle apres
-- deploiement (uploader une image en tant qu'admin, verifier qu'un autre
-- tenant ne peut pas ecrire dans le dossier d'un autre).
--
-- Convention de chemin : {code_entreprise}/{desktop|mobile}/{cle-image}.webp
-- ex. IKIGAI/desktop/mode-moto.webp
-- ============================================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('personnalisation', 'personnalisation', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Lecture publique (la page expéditeur est vue par des expéditeurs anonymes).
drop policy if exists "personnalisation_lecture_publique" on storage.objects;
create policy "personnalisation_lecture_publique" on storage.objects for select
using (bucket_id = 'personnalisation');

-- Ecriture (upload/remplacement) reservee a un admin/super_admin de
-- l'entreprise correspondant au premier segment du chemin (son propre
-- code_entreprise) -- jamais celui d'un autre tenant.
drop policy if exists "personnalisation_ecriture_admin" on storage.objects;
create policy "personnalisation_ecriture_admin" on storage.objects for insert
with check (
  bucket_id = 'personnalisation'
  and exists (
    select 1 from public.utilisateurs u
    join public.entreprises e on e.id_entreprise = u.id_entreprise
    where u.id_utilisateur = auth.uid() and u.actif
      and u.role in ('admin', 'super_admin')
      and e.code_entreprise = (storage.foldername(name))[1]
  )
);

drop policy if exists "personnalisation_maj_admin" on storage.objects;
create policy "personnalisation_maj_admin" on storage.objects for update
using (
  bucket_id = 'personnalisation'
  and exists (
    select 1 from public.utilisateurs u
    join public.entreprises e on e.id_entreprise = u.id_entreprise
    where u.id_utilisateur = auth.uid() and u.actif
      and u.role in ('admin', 'super_admin')
      and e.code_entreprise = (storage.foldername(name))[1]
  )
);

drop policy if exists "personnalisation_suppression_admin" on storage.objects;
create policy "personnalisation_suppression_admin" on storage.objects for delete
using (
  bucket_id = 'personnalisation'
  and exists (
    select 1 from public.utilisateurs u
    join public.entreprises e on e.id_entreprise = u.id_entreprise
    where u.id_utilisateur = auth.uid() and u.actif
      and u.role in ('admin', 'super_admin')
      and e.code_entreprise = (storage.foldername(name))[1]
  )
);

-- Expose publiquement, par code entreprise, la liste des images
-- personnalisees deja en place (pour que la page expediteur sache quoi
-- charger sans avoir a deviner/tenter chaque fichier un par un).
create or replace function public.rpc_lister_personnalisation(p_code_entreprise text)
returns table(chemin text)
language sql stable security definer set search_path = public as $$
  select name from storage.objects
  where bucket_id = 'personnalisation'
    and (storage.foldername(name))[1] = upper(trim(p_code_entreprise));
$$;
grant execute on function public.rpc_lister_personnalisation to anon, authenticated;

commit;

select 'fix_34_ok' as status;
