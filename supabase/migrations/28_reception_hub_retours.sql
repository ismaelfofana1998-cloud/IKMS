-- ============================================================================
-- 28 - Etape de reception au hub manquante pour les retours
-- A executer apres 27_respecter_mode_paiement_client_pro.sql.
-- ============================================================================
--
-- PROBLEME CORRIGE (signale par le client) : des qu'un livreur annoncait
-- ramener un colis au hub (RETOUR_DEMANDE), l'agent avait DIRECTEMENT le
-- choix "reprogrammer" ou "retourner a l'expediteur" -- sans jamais
-- confirmer que le colis est physiquement arrive au hub. Contrairement au
-- depot normal (DEPOT_DEMANDE -> VALIDER_DEPOT -> AU_HUB), il manquait cette
-- etape de confirmation de reception pour les retours.
--
-- Nouvel etat RETOUR_RECU : le colis est physiquement au hub, en attente de
-- decision (reprogrammer ou retourner). Meme principe que VALIDER_DEPOT.
-- ============================================================================

begin;

insert into public.transitions_colis (statut_depart, evenement, statut_arrivee, roles_autorises) values
  ('RETOUR_DEMANDE', 'VALIDER_RETOUR_RECU', 'RETOUR_RECU', '{agent}'),
  ('RETOUR_RECU',     'VALIDER_RETOUR_REPROGRAMMER', 'AU_HUB', '{agent}'),
  ('RETOUR_RECU',     'VALIDER_RETOUR_EXPEDITEUR',   'A_RETOURNER', '{agent}')
on conflict (statut_depart, evenement) do update
  set statut_arrivee = excluded.statut_arrivee, roles_autorises = excluded.roles_autorises;

-- L'ancien chemin direct RETOUR_DEMANDE -> ... n'existe plus une fois les
-- lignes ci-dessus posees (meme evenement, nouvelle source) : on nettoie
-- l'ancienne ligne RETOUR_DEMANDE -> VALIDER_RETOUR_REPROGRAMMER si elle
-- existe encore (elle serait sinon dupliquee avec une source differente).
delete from public.transitions_colis
where statut_depart = 'RETOUR_DEMANDE' and evenement in ('VALIDER_RETOUR_REPROGRAMMER','VALIDER_RETOUR_EXPEDITEUR');

-- v_missions_livreur : RETOUR_RECU est un etat de traitement interne au hub
-- (comme AU_HUB/A_RETOURNER), jamais assigne a un livreur -- a exclure de sa
-- vue de missions, exactement comme les etats equivalents deja exclus.
create or replace view public.v_missions_livreur
with (security_invoker = true) as
select
  c.id_colis, c.id_entreprise, c.statut, c.id_commande, c.id_lot,
  cmd.expediteur_nom, cmd.expediteur_tel, cmd.expediteur_adresse, cmd.gps_expediteur,
  cmd.mode_paiement,
  c.destinataire_nom, c.destinataire_tel, c.destinataire_adresse, c.gps_destinataire,
  c.code_zone, c.montant_livraison, c.motif_retour,
  case
    when c.statut in ('A_RAMASSER') then 'A_RAMASSER'
    when c.statut in ('RAMASSE','DEPOT_DEMANDE','RETOUR_EN_COURS','RETOUR_DEMANDE') then 'A_DEPOSER'
    when c.statut in ('EN_LOT','RECUP_DEMANDEE','RETOUR_ASSIGNE','RETOUR_RECUP_DEMANDEE') then 'AU_HUB'
    when c.statut in ('EN_TOURNEE') then 'A_LIVRER'
    when c.statut in ('EN_RETOUR') then 'RETOURS'
  end as onglet,
  coalesce(l.id_livreur, c.id_livreur_retour, cmd.id_livreur_ramassage) as id_livreur,
  exists (select 1 from public.paiements p
          where p.id_colis = c.id_colis and p.statut = 'PAYE') as paye,
  exists (select 1 from public.paiements p
          where p.id_colis = c.id_colis and p.statut = 'PAYE' and p.payeur = 'EXPEDITEUR') as paye_par_expediteur
from public.colis c
join public.commandes cmd on cmd.id_commande = c.id_commande
left join public.lots_livraison l on l.id_lot = c.id_lot
where c.statut not in ('CREE','AU_HUB','A_RETOURNER','RETOUR_RECU','LIVRE','RETOURNE','ANNULE');

grant select on public.v_missions_livreur to authenticated;

commit;

select 'fix_28_ok' as status;
