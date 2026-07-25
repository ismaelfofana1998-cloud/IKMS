-- ============================================================================
-- 59 - Personnalisation generique "accroche-N" au lieu de mode-moto/velo/van
-- A executer apres 58_renommage_secteur.sql.
--
-- La page expediteur ne propose plus de choix de mode de livraison (moto/
-- velo/van) depuis la refonte du parcours (zone+prix d'abord) -- la
-- contrainte qui limitait "cle" a ces trois valeurs precises n'a plus de
-- sens. Remplacee par un motif generique "accroche-N", qui laisse la page
-- de personnalisation proposer un nombre de creneaux qu'elle choisit elle-
-- meme (aujourd'hui 3 : phrase + photo, pas de sous-titre separe) sans
-- necessiter une nouvelle migration a chaque ajustement.
--
-- Aucune donnee a migrer : les anciennes valeurs mode-moto/velo/van, si un
-- tenant les avait renseignees, restent en base mais ne sont plus lues par
-- la page expediteur (qui ne cherche plus que accroche-1/2/3) -- elles
-- resteront orphelines jusqu'a un nettoyage manuel si besoin, sans risque
-- puisque la table est petite et purement decorative.
-- ============================================================================

begin;

alter table public.textes_personnalises drop constraint if exists textes_personnalises_cle_check;
alter table public.textes_personnalises add constraint textes_personnalises_cle_check
  check (cle ~ '^accroche-[1-9][0-9]*$');

commit;

select 'fix_59_ok' as status;
