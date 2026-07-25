-- ============================================================================
-- 32 - Nettoyage : suppression de l'ancienne table "compteurs"
-- A executer apres 31_essai_tenant.sql.
-- ============================================================================
--
-- Oubli du patch 26 : la table "compteurs" (compteur par entreprise, a
-- l'origine du bug de collision d'identifiants) a ete remplacee par
-- "compteurs_globaux" (compteur unique par type, partage entre entreprises)
-- -- toutes ses valeurs ont deja ete recuperees a ce moment-la. L'ancienne
-- table n'a jamais ete supprimee : elle ne sert plus a rien depuis, plus
-- aucune fonction ne la lit ni ne l'ecrit (verifie).
-- ============================================================================

begin;

drop table if exists public.compteurs;

commit;

select 'fix_32_ok' as status;
