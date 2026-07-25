-- ============================================================================
-- 56 - (select public.entreprise_de()/est_super_admin()/client_pro_de())
-- au lieu des appels nus, dans TOUTES les policies qui les utilisent.
-- A executer apres 55_optimisation_auth_uid_policies.sql.
--
-- Complement direct du patch 55. Le patch 55 enveloppait "auth.uid()" quand
-- il apparaissait DIRECTEMENT dans une clause USING/WITH CHECK. Celui-ci
-- s'attaque a l'etage du dessus : la plupart des policies de ce projet
-- n'appellent pas auth.uid() directement, elles appellent entreprise_de(),
-- est_super_admin() ou client_pro_de() -- des fonctions STABLE qui, elles,
-- relisent la table utilisateurs (ou clients_pro) a l'interieur. Tant que le
-- POINT D'APPEL (la policy) n'enveloppe pas cet appel, Postgres peut
-- reappeler la fonction -- donc relire utilisateurs/clients_pro -- une fois
-- par ligne scannee, meme si la fonction elle-meme est STABLE. Envelopper
-- ici, au niveau de la policy, c'est ce qui permet enfin le hissage en
-- InitPlan (un seul appel par requete). C'est le chantier que le patch 55
-- laissait volontairement de cote, en l'annoncant comme "plus gros diff, a
-- traiter comme un patch a part" -- le voici.
--
-- jwt_role() et jwt_entreprise_id() ne sont PAS enveloppees ici : ce sont de
-- simples lectures de auth.jwt() (le JWT deja present en memoire pour la
-- requete), sans acces a aucune table -- aucun gain a en attendre.
--
-- 35 policies touchees, sur 10 fichiers/10 tables (utilisateurs,
-- entreprises, vehicules, zones_tarification, commandes, colis,
-- lots_livraison, evenements_colis, liens_partage, paiements,
-- versements_livreur, zones_tarifs_paires, notifications_log, clients_pro,
-- mouvements_portefeuille, textes_personnalises, hubs,
-- entreprises_paiement_config, cles_api). Meme methode que le patch 55 :
-- ALTER POLICY exclusivement, jamais DROP + CREATE -- aucune fenetre sans
-- policy, noms/proprietaires/ordre inchanges. Sur les 3 policies deja
-- touchees par le patch 55 (sel_utilisateurs, upd_utilisateurs,
-- maj_textes_personnalises_admin), ce patch les re-ecrit une seconde fois
-- avec l'enveloppe complete (auth.uid() ET entreprise_de()/est_super_admin())
-- -- sans risque, ALTER POLICY remplace toujours l'expression entiere.
--
-- A verifier apres application : rejouer test_rls_isolation.sql -- doit
-- montrer EXACTEMENT le meme resultat qu'avant (aucun changement de
-- comportement, uniquement de plan d'execution).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- public.entreprises / public.utilisateurs / public.vehicules / public.zones_tarification (00_install_v3.sql)
-- ---------------------------------------------------------------------------
alter policy sel_entreprises on public.entreprises using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy sel_utilisateurs on public.utilisateurs using (
  id_utilisateur = (select auth.uid()) or id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy sel_vehicules on public.vehicules using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy sel_zones on public.zones_tarification using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy sel_commandes on public.commandes using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy sel_colis on public.colis using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy sel_lots on public.lots_livraison using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy sel_evenements on public.evenements_colis using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy sel_liens on public.liens_partage using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy sel_paiements on public.paiements using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy sel_versements on public.versements_livreur using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy ins_vehicules on public.vehicules with check (
  id_entreprise = (select public.entreprise_de()) and public.jwt_role() in ('agent','admin')
  or (select public.est_super_admin()));

alter policy upd_vehicules on public.vehicules using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy ins_zones on public.zones_tarification with check (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy upd_zones on public.zones_tarification using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy upd_utilisateurs on public.utilisateurs using (
  id_utilisateur = (select auth.uid()) or id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()))
with check (
  id_utilisateur = (select auth.uid()) or id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

-- ---------------------------------------------------------------------------
-- public.zones_tarifs_paires (17_zones_paires_et_obligatoires.sql)
-- ---------------------------------------------------------------------------
alter policy sel_zones_paires on public.zones_tarifs_paires using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy ins_zones_paires on public.zones_tarifs_paires with check (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy upd_zones_paires on public.zones_tarifs_paires using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

-- ---------------------------------------------------------------------------
-- public.entreprises -- onboarding (20_onboarding_entreprises.sql)
-- ---------------------------------------------------------------------------
alter policy ins_entreprises on public.entreprises with check (
  (select public.est_super_admin()));

alter policy upd_entreprises on public.entreprises using (
  (select public.est_super_admin()));

-- ---------------------------------------------------------------------------
-- public.notifications_log (21_notifications_log.sql)
-- ---------------------------------------------------------------------------
alter policy sel_notifications on public.notifications_log using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

-- ---------------------------------------------------------------------------
-- public.clients_pro / public.mouvements_portefeuille (23_paiements_retour_ramassage_clients_pro.sql)
-- ---------------------------------------------------------------------------
alter policy sel_clients_pro on public.clients_pro using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy ins_clients_pro on public.clients_pro with check (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy upd_clients_pro on public.clients_pro using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy sel_mouvements_portefeuille on public.mouvements_portefeuille using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

-- ---------------------------------------------------------------------------
-- public.commandes / public.colis -- espace client pro (24_espace_client_pro.sql)
-- ---------------------------------------------------------------------------
alter policy sel_commandes_client_pro on public.commandes using (
  id_client_pro is not null and id_client_pro = (select public.client_pro_de()));

alter policy sel_colis_client_pro on public.colis using (
  id_commande in (select c.id_commande from public.commandes c where c.id_client_pro = (select public.client_pro_de())));

-- ---------------------------------------------------------------------------
-- public.textes_personnalises (35_textes_personnalises.sql)
-- ---------------------------------------------------------------------------
alter policy sel_textes_personnalises_admin on public.textes_personnalises
using (id_entreprise = (select public.entreprise_de()));

alter policy maj_textes_personnalises_admin on public.textes_personnalises
using (id_entreprise = (select public.entreprise_de()) and (public.jwt_role() in ('admin', 'super_admin') or exists (select 1 from public.utilisateurs u where u.id_utilisateur = (select auth.uid()) and u.role in ('admin', 'super_admin') and u.actif)))
with check (id_entreprise = (select public.entreprise_de()) and (public.jwt_role() in ('admin', 'super_admin') or exists (select 1 from public.utilisateurs u where u.id_utilisateur = (select auth.uid()) and u.role in ('admin', 'super_admin') and u.actif)));

-- ---------------------------------------------------------------------------
-- public.hubs (36_multi_hub.sql)
-- ---------------------------------------------------------------------------
alter policy sel_hubs on public.hubs using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

alter policy ins_hubs on public.hubs with check (
  id_entreprise = (select public.entreprise_de()) and public.jwt_role() in ('agent','admin')
  or (select public.est_super_admin()));

alter policy upd_hubs on public.hubs using (
  id_entreprise = (select public.entreprise_de()) or (select public.est_super_admin()));

-- ---------------------------------------------------------------------------
-- public.entreprises_paiement_config (42_wave_par_entreprise.sql)
-- ---------------------------------------------------------------------------
alter policy sel_config_paiement_admin on public.entreprises_paiement_config
using (id_entreprise = (select public.entreprise_de()) and public.jwt_role() in ('admin','super_admin'));

-- ---------------------------------------------------------------------------
-- public.cles_api (46_cles_api_client_pro.sql)
-- ---------------------------------------------------------------------------
alter policy sel_cles_api_self on public.cles_api
using (id_client = (select public.client_pro_de()));

commit;

select 'fix_56_ok' as status;
