-- ============================================================================
-- 35 - Textes personnalisables de la page expéditeur (titre/sous-titre)
-- A executer apres 34_stockage_personnalisation.sql.
-- ============================================================================
--
-- Complete la personnalisation des images (patch 34) avec la possibilite de
-- changer les 3 phrases d'accroche ("Rapide, et suivi en direct.", etc.) --
-- meme principe : lecture publique (page expediteur anonyme), ecriture
-- reservee a un admin de sa propre entreprise.
-- ============================================================================

begin;

create table if not exists public.textes_personnalises (
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  cle text not null check (cle in ('mode-moto', 'mode-velo', 'mode-van')),
  titre text,
  sous_titre text,
  maj_le timestamptz not null default now(),
  primary key (id_entreprise, cle)
);

alter table public.textes_personnalises enable row level security;

create policy sel_textes_personnalises_admin on public.textes_personnalises for select
using (id_entreprise = public.entreprise_de());

create policy maj_textes_personnalises_admin on public.textes_personnalises for all
using (id_entreprise = public.entreprise_de() and (public.jwt_role() in ('admin', 'super_admin') or exists (select 1 from public.utilisateurs u where u.id_utilisateur = auth.uid() and u.role in ('admin', 'super_admin') and u.actif)))
with check (id_entreprise = public.entreprise_de() and (public.jwt_role() in ('admin', 'super_admin') or exists (select 1 from public.utilisateurs u where u.id_utilisateur = auth.uid() and u.role in ('admin', 'super_admin') and u.actif)));

grant select, insert, update, delete on public.textes_personnalises to authenticated;

-- Lecture publique, par code entreprise (comme rpc_nom_entreprise et
-- rpc_lister_personnalisation) -- la page expediteur est vue par des
-- expediteurs anonymes, jamais connectes.
create or replace function public.rpc_lire_textes_personnalises(p_code_entreprise text)
returns table(cle text, titre text, sous_titre text)
language sql stable security definer set search_path = public as $$
  select t.cle, t.titre, t.sous_titre
  from public.textes_personnalises t
  join public.entreprises e on e.id_entreprise = t.id_entreprise
  where e.code_entreprise = upper(trim(p_code_entreprise));
$$;
grant execute on function public.rpc_lire_textes_personnalises to anon, authenticated;

-- Enregistre (cree ou met a jour) le texte d'un tenant pour une cle donnee --
-- appele depuis le panneau centrale, deja protege par les policies
-- ci-dessus, mais un RPC dedie evite au front d'avoir a faire un upsert
-- manuel avec l'id_entreprise en dur.
create or replace function public.rpc_definir_texte_personnalise(p_cle text, p_titre text, p_sous_titre text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Meme schema que est_super_admin()/entreprise_de() : le JWT peut ne pas
  -- encore avoir ses claims synchronises (utilisateur tout juste cree, ou
  -- session ouverte avant la synchro) -- on retombe alors sur une lecture
  -- directe de la table utilisateurs, jamais sur un simple "if not X" qui
  -- laisserait passer un NULL comme s'il etait autorise.
  -- coalesce(..., false) sur l'ensemble, pas seulement sur jwt_role() : un
  -- "NULL or false" reste NULL en SQL (pas false), et "if not NULL" ne se
  -- declenche jamais en PL/pgSQL -- deuxieme piege du meme genre, attrape
  -- par le test qui a suivi (un agent passait a travers sans ce coalesce).
  if not coalesce(
    public.jwt_role() in ('admin', 'super_admin')
    or exists (select 1 from public.utilisateurs u where u.id_utilisateur = auth.uid() and u.role in ('admin', 'super_admin') and u.actif),
    false
  ) then
    raise exception 'Reserve a un administrateur.';
  end if;
  insert into public.textes_personnalises (id_entreprise, cle, titre, sous_titre, maj_le)
  values (public.entreprise_de(), p_cle, nullif(trim(p_titre), ''), nullif(trim(p_sous_titre), ''), now())
  on conflict (id_entreprise, cle) do update
    set titre = excluded.titre, sous_titre = excluded.sous_titre, maj_le = now();
end;
$$;
grant execute on function public.rpc_definir_texte_personnalise to authenticated;

-- Retire une personnalisation de texte (retour au texte par defaut) --
-- symetrique de la suppression d'image du patch 34.
create or replace function public.rpc_retirer_texte_personnalise(p_cle text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- coalesce(..., false) sur l'ensemble, pas seulement sur jwt_role() : un
  -- "NULL or false" reste NULL en SQL (pas false), et "if not NULL" ne se
  -- declenche jamais en PL/pgSQL -- deuxieme piege du meme genre, attrape
  -- par le test qui a suivi (un agent passait a travers sans ce coalesce).
  if not coalesce(
    public.jwt_role() in ('admin', 'super_admin')
    or exists (select 1 from public.utilisateurs u where u.id_utilisateur = auth.uid() and u.role in ('admin', 'super_admin') and u.actif),
    false
  ) then
    raise exception 'Reserve a un administrateur.';
  end if;
  delete from public.textes_personnalises where id_entreprise = public.entreprise_de() and cle = p_cle;
end;
$$;
grant execute on function public.rpc_retirer_texte_personnalise to authenticated;

commit;

select 'fix_35_ok' as status;
