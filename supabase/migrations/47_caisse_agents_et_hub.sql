-- ============================================================================
-- 47 - Caisse etendue aux agents (point relais) + vue agregee par hub
-- A executer apres 46_cles_api_client_pro.sql.
--
-- Le paiement au retrait en point relais est collecte par un AGENT (pas un
-- livreur) -- la caisse existante (v_caisse_livreur, versements_livreur)
-- filtrait sur role='livreur' et ne montrait donc jamais cet argent nulle
-- part. La table versements_livreur et ses RPC (rpc_verser_caisse,
-- rpc_valider_versement) sont deja generiques en pratique (aucune
-- verification de role a l'ecriture) -- seul le NOM et le FILTRE de la vue
-- etaient trop restrictifs. Etendu ici, sans dupliquer de mecanique.
--
-- Ajoute aussi une vue agregee par hub : combien de cash espece est
-- actuellement detenu (par des agents ET des livreurs) rattache a chaque
-- hub -- utile pour la visibilite operationnelle du jour, sans creer un
-- second registre parallele (calculee, pas stockee).
-- ============================================================================

begin;

-- Etendu a agent ET livreur -- ajoute le role et le hub pour que
-- l'interface puisse regrouper/afficher clairement qui est quoi et ou.
create or replace view public.v_caisse_livreur
with (security_invoker = true) as
select
  u.id_entreprise, u.id_utilisateur as id_livreur, u.nom,
  coalesce((select sum(p.montant) from public.paiements p
            where p.encaisse_par = u.id_utilisateur and p.methode = 'ESPECES' and p.statut = 'PAYE'), 0)
  - coalesce((select sum(vl.montant) from public.versements_livreur vl
              where vl.id_livreur = u.id_utilisateur and vl.valide_par is not null), 0)
  as solde_especes,
  u.role, u.id_hub_affecte
from public.utilisateurs u
where u.role in ('livreur', 'agent') and u.actif;

grant select on public.v_caisse_livreur to authenticated;

-- Vue agregee par hub -- simple somme de la vue ci-dessus, jamais un
-- registre a part (aucun risque de desynchronisation entre les deux).
create or replace view public.v_caisse_hub
with (security_invoker = true) as
select
  u.id_entreprise, u.id_hub_affecte as id_hub, h.nom as nom_hub,
  sum(c.solde_especes) as solde_especes_hub,
  count(*) filter (where c.solde_especes > 0) as nb_personnes_avec_cash
from public.v_caisse_livreur c
join public.utilisateurs u on u.id_utilisateur = c.id_livreur
left join public.hubs h on h.id_hub = u.id_hub_affecte
where u.id_hub_affecte is not null
group by u.id_entreprise, u.id_hub_affecte, h.nom;

grant select on public.v_caisse_hub to authenticated;

commit;

select 'fix_47_ok' as status;
