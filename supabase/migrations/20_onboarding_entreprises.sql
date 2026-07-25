-- ============================================================================
-- 20 - Onboarding SaaS : creation d'entreprises par le super-admin
-- A executer apres 19_tarifs_uniquement_par_paire.sql.
-- ============================================================================
--
-- CONSTAT : la table entreprises n'avait qu'une policy RLS de LECTURE. Aucune
-- policy d'ECRITURE n'existait -- meme un super_admin ne pouvait pas creer
-- une nouvelle entreprise cliente depuis l'application ; il fallait le faire
-- a la main en SQL. C'est le vrai verrou avant tout onboarding en libre-service.
--
-- Ce patch ajoute les policies INSERT/UPDATE, reservees au super_admin (une
-- entreprise qui vient d'etre creee n'a encore aucun rattachement "propre",
-- donc la regle habituelle "id_entreprise = entreprise_de()" ne s'applique
-- pas ici : c'est necessairement une action cross-tenant, reservee au rang
-- le plus eleve).
--
-- La creation du premier utilisateur admin de la nouvelle entreprise
-- reutilise la fonction Edge "creer-utilisateur" existante, qui autorise deja
-- un super_admin a cibler n'importe quelle id_entreprise -- aucun changement
-- necessaire de ce cote.
-- ============================================================================

begin;

create policy ins_entreprises on public.entreprises for insert with check (
  public.est_super_admin());
create policy upd_entreprises on public.entreprises for update using (
  public.est_super_admin());

grant insert, update on public.entreprises to authenticated;

-- Petite vue pratique pour le panneau super-admin : nombre d'utilisateurs et
-- de commandes par entreprise, pour un premier coup d'oeil sans naviguer.
create or replace view public.v_entreprises_apercu
with (security_invoker = true) as
select
  e.id_entreprise, e.code_entreprise, e.nom, e.actif, e.cree_le,
  (select count(*) from public.utilisateurs u where u.id_entreprise = e.id_entreprise and u.actif) as nb_utilisateurs,
  (select count(*) from public.commandes c where c.id_entreprise = e.id_entreprise) as nb_commandes
from public.entreprises e;

grant select on public.v_entreprises_apercu to authenticated;

commit;

select 'fix_20_ok' as status;
