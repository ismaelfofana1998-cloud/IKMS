-- ============================================================================
-- 55 - (select auth.uid()) au lieu de auth.uid() nu dans les policies RLS
-- A executer apres 54_estimation_tarifaire_publique.sql.
--
-- Optimisation de performance pure, aucun changement de comportement : sur
-- une table scannee ligne par ligne, un "auth.uid()" nu ecrit directement
-- dans une clause USING/WITH CHECK peut etre re-evalue a chaque ligne.
-- L'ecrire "(select auth.uid())" permet a Postgres de le hisser en InitPlan
-- (une seule evaluation par requete, peu importe le nombre de lignes
-- scannees). Les deux formes renvoient exactement la meme valeur -- aucun
-- changement de resultat, seulement potentiellement de plan d'execution.
--
-- IMPORTANT -- perimetre volontairement restreint : sur les 32 occurrences
-- de "auth.uid()" du projet, seules celles ecrites DIRECTEMENT dans une
-- clause USING/WITH CHECK d'un "create policy" sont modifiees ici. Les
-- occurrences a l'INTERIEUR d'un corps de fonction (entreprise_de(),
-- est_super_admin(), client_pro_de(), et les rpc_lister_mes_notifications /
-- rpc_compter_notifications_non_lues / rpc_marquer_toutes_notifications_lues
-- / rpc_definir_texte_personnalise / rpc_retirer_texte_personnalise) ne sont
-- PAS touchees ici, volontairement : l'optimisation InitPlan s'applique au
-- point d'appel visible par le planificateur de requete pour LA requete en
-- cours -- l'envelopper a l'interieur d'une fonction appelee une fois par
-- ligne par la policy appelante (ex. public.entreprise_de(), jamais
-- lui-meme enveloppe en "(select public.entreprise_de())" dans les policies
-- ci-dessous) n'apporte aucun gain mesurable tant que le point d'appel
-- externe n'est pas lui-meme enveloppe -- un chantier plus large et distinct
-- (envelopper les appels a entreprise_de()/est_super_admin() eux-memes dans
-- chaque policy), a traiter separement si voulu.
--
-- ALTER POLICY, jamais DROP + CREATE : modifie uniquement l'expression
-- USING/WITH CHECK d'une policy existante, conserve son nom, son proprietaire
-- et son ordre -- aucune fenetre sans policy, aucun risque de l'oublier au
-- reactivation.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- public.utilisateurs (00_install_v3.sql)
-- ---------------------------------------------------------------------------
alter policy sel_utilisateurs on public.utilisateurs
using (id_utilisateur = (select auth.uid()) or id_entreprise = public.entreprise_de() or public.est_super_admin());

alter policy ins_utilisateurs_self on public.utilisateurs
with check (
  (id_utilisateur = (select auth.uid()) or (select auth.uid()) is null)
  and role in ('expediteur','destinataire')
);

alter policy upd_utilisateurs on public.utilisateurs
using (id_utilisateur = (select auth.uid()) or id_entreprise = public.entreprise_de() or public.est_super_admin())
with check (id_utilisateur = (select auth.uid()) or id_entreprise = public.entreprise_de() or public.est_super_admin());

-- ---------------------------------------------------------------------------
-- public.clients_pro (24_espace_client_pro.sql)
-- ---------------------------------------------------------------------------
alter policy sel_clients_pro_self on public.clients_pro
using (id_auth = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- storage.objects, bucket "personnalisation" (34_stockage_personnalisation.sql)
-- ---------------------------------------------------------------------------
alter policy "personnalisation_ecriture_admin" on storage.objects
with check (
  bucket_id = 'personnalisation'
  and exists (
    select 1 from public.utilisateurs u
    join public.entreprises e on e.id_entreprise = u.id_entreprise
    where u.id_utilisateur = (select auth.uid()) and u.actif
      and u.role in ('admin', 'super_admin')
      and e.code_entreprise = (storage.foldername(name))[1]
  )
);

alter policy "personnalisation_maj_admin" on storage.objects
using (
  bucket_id = 'personnalisation'
  and exists (
    select 1 from public.utilisateurs u
    join public.entreprises e on e.id_entreprise = u.id_entreprise
    where u.id_utilisateur = (select auth.uid()) and u.actif
      and u.role in ('admin', 'super_admin')
      and e.code_entreprise = (storage.foldername(name))[1]
  )
);

alter policy "personnalisation_suppression_admin" on storage.objects
using (
  bucket_id = 'personnalisation'
  and exists (
    select 1 from public.utilisateurs u
    join public.entreprises e on e.id_entreprise = u.id_entreprise
    where u.id_utilisateur = (select auth.uid()) and u.actif
      and u.role in ('admin', 'super_admin')
      and e.code_entreprise = (storage.foldername(name))[1]
  )
);

-- ---------------------------------------------------------------------------
-- public.textes_personnalises (35_textes_personnalises.sql)
-- ---------------------------------------------------------------------------
alter policy maj_textes_personnalises_admin on public.textes_personnalises
using (
  id_entreprise = public.entreprise_de()
  and (public.jwt_role() in ('admin', 'super_admin')
       or exists (select 1 from public.utilisateurs u where u.id_utilisateur = (select auth.uid()) and u.role in ('admin', 'super_admin') and u.actif))
)
with check (
  id_entreprise = public.entreprise_de()
  and (public.jwt_role() in ('admin', 'super_admin')
       or exists (select 1 from public.utilisateurs u where u.id_utilisateur = (select auth.uid()) and u.role in ('admin', 'super_admin') and u.actif))
);

-- ---------------------------------------------------------------------------
-- public.notifications_internes (48_notifications_internes.sql)
-- ---------------------------------------------------------------------------
alter policy sel_notifications on public.notifications_internes
using (
  id_utilisateur = (select auth.uid())
  or (id_hub is not null and id_hub = (select u.id_hub_affecte from public.utilisateurs u where u.id_utilisateur = (select auth.uid())))
  or public.jwt_role() in ('admin','super_admin')
);

alter policy upd_notifications_lu on public.notifications_internes
using (
  id_utilisateur = (select auth.uid())
  or (id_hub is not null and id_hub = (select u.id_hub_affecte from public.utilisateurs u where u.id_utilisateur = (select auth.uid())))
);

commit;

select 'fix_55_ok' as status;
