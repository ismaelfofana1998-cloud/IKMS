-- ============================================================================
-- 22 - Retours : faille de securite corrigee + etape de recuperation manquante
--       + paiement par l'expediteur
-- A executer apres 21_notifications_log.sql.
-- ============================================================================
--
-- PROBLEME DE SECURITE CORRIGE (signale par le client) : VALIDER_REMISE_EXPEDITEUR
-- verifiait le code contre commandes.code_ramassage -- EXACTEMENT le meme code
-- que celui utilise pour le ramassage initial. Un livreur qui a ramasse un
-- colis connait deja ce code ; s'il est ensuite assigne au retour du meme
-- colis, il pouvait valider "colis rendu a l'expediteur" avec un code qu'il
-- possedait deja, sans jamais re-obtenir de preuve fraiche de l'expediteur.
-- Corrige : un nouveau code_retour, distinct, est genere au moment ou la
-- decision "retour a l'expediteur" est prise, et c'est LUI qui est verifie.
--
-- ETAPE MANQUANTE CORRIGEE : le parcours retour sautait directement de
-- "a retourner" (agent) a "en retour" (colis considere comme deja en main du
-- livreur) sans jamais faire confirmer au livreur qu'il est bien passe le
-- recuperer au hub -- contrairement au parcours de livraison normale, qui
-- exige une demande de recuperation + validation par l'agent. Deux nouvelles
-- transitions comblent cet ecart, sur le meme principe.
--
-- PAIEMENT PAR L'EXPEDITEUR : quand un colis revient (le destinataire n'a pas
-- paye puisqu'il n'a pas ete livre), c'est desormais l'expediteur qui doit
-- regler le montant de livraison avant que la remise finale soit validee --
-- comme pour VALIDER_LIVRAISON, mais avec l'expediteur comme payeur.
-- ============================================================================

begin;

-- 1) Nouvelles colonnes sur colis.
alter table public.colis add column if not exists code_retour text;
alter table public.colis add column if not exists id_livreur_retour uuid references public.utilisateurs(id_utilisateur);

-- 2) Nouveau type de lien de partage (le token existant reste le secret ;
--    voir la note de securite deja presente sur rpc_lire_lien).
alter table public.liens_partage drop constraint if exists liens_partage_type_check;
alter table public.liens_partage add constraint liens_partage_type_check
  check (type in ('POSITION_EXPEDITEUR','POSITION_DESTINATAIRE','SUIVI','CODE_RETOUR'));

-- 3) Machine a etats : etape de recuperation manquante pour les retours.
insert into public.transitions_colis (statut_depart, evenement, statut_arrivee, roles_autorises) values
  ('A_RETOURNER',            'ASSIGNER_RETOUR',              'RETOUR_ASSIGNE',       '{agent}'),
  ('RETOUR_ASSIGNE',         'DEMANDER_RECUPERATION_RETOUR', 'RETOUR_RECUP_DEMANDEE', '{livreur}'),
  ('RETOUR_RECUP_DEMANDEE',  'VALIDER_RECUPERATION_RETOUR',  'EN_RETOUR',             '{agent}')
on conflict (statut_depart, evenement) do update
  set statut_arrivee = excluded.statut_arrivee, roles_autorises = excluded.roles_autorises;

-- 4) avancer_colis : code_retour genere a la decision de retour, verifie a la
--    remise finale (plus jamais code_ramassage), recuperation retour
--    verifiee comme un lot, paiement expediteur exige avant remise finale.
create or replace function public.avancer_colis(
  p_id_colis text,
  p_evenement text,
  p_code text default null,
  p_motif text default null,
  p_details jsonb default '{}'::jsonb,
  p_acteur uuid default null
) returns table (id_colis text, statut text)
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_profil record;
  v_colis record;
  v_commande record;
  v_transition record;
  v_role_ok boolean;
  v_nouveau_code_retour text;
  v_token_retour uuid;
begin
  select * into v_profil from public.profil_de(v_acteur);
  if v_profil.id_utilisateur is null or not v_profil.actif then
    raise exception 'Acteur inconnu ou inactif.';
  end if;

  select * into v_colis from public.colis c where c.id_colis = p_id_colis for update;
  if v_colis.id_colis is null then
    raise exception 'Colis introuvable.';
  end if;

  if v_colis.id_entreprise is distinct from v_profil.id_entreprise
     and v_profil.role <> 'super_admin' then
    raise exception 'Colis hors de votre entreprise.';
  end if;

  select * into v_commande from public.commandes cmd where cmd.id_commande = v_colis.id_commande;

  select * into v_transition from public.transitions_colis t
  where t.statut_depart = v_colis.statut and t.evenement = p_evenement;
  if v_transition.evenement is null then
    raise exception 'Transition interdite : % depuis %.', p_evenement, v_colis.statut;
  end if;

  v_role_ok := v_profil.role = any(v_transition.roles_autorises)
            or v_profil.role in ('admin','super_admin');
  if not v_role_ok then
    raise exception 'Role % non autorise pour %.', v_profil.role, p_evenement;
  end if;

  -- Conditions specifiques par evenement -------------------------------------
  if p_evenement = 'VALIDER_RAMASSAGE' then
    if v_commande.id_livreur_ramassage is distinct from v_acteur
       and v_profil.role = 'livreur' then
      raise exception 'Ce ramassage ne vous est pas assigne.';
    end if;
    if upper(coalesce(p_code, '')) <> upper(v_commande.code_ramassage) then
      raise exception 'Code ramassage incorrect.';
    end if;
  end if;

  if p_evenement = 'DEMANDER_RECUPERATION' then
    if v_colis.id_lot is null then
      raise exception 'Colis hors lot.';
    end if;
    if not exists (select 1 from public.lots_livraison l
                   where l.id_lot = v_colis.id_lot and l.id_livreur = v_acteur) then
      raise exception 'Ce lot ne vous est pas assigne.';
    end if;
  end if;

  -- NOUVEAU : meme principe que la recuperation de lot, mais pour un retour
  -- individuel assigne a un livreur precis.
  if p_evenement = 'DEMANDER_RECUPERATION_RETOUR' then
    if v_colis.id_livreur_retour is distinct from v_acteur then
      raise exception 'Ce retour ne vous est pas assigne.';
    end if;
  end if;

  if p_evenement = 'VALIDER_LIVRAISON' then
    if upper(coalesce(p_code, '')) <> upper(v_colis.code_livraison) then
      raise exception 'Code livraison incorrect.';
    end if;
    if v_commande.mode_paiement = 'A_LA_LIVRAISON'
       and not exists (select 1 from public.paiements p
                       where p.id_colis = v_colis.id_colis and p.statut = 'PAYE') then
      raise exception 'Paiement requis avant la remise du colis.';
    end if;
  end if;

  if p_evenement = 'SIGNALER_ECHEC' then
    if coalesce(p_motif, '') not in
       ('DESTINATAIRE_ABSENT','INJOIGNABLE','ADRESSE_INTROUVABLE','ANNULATION_CLIENT','REFUS_COLIS','AUTRE') then
      raise exception 'Motif d''echec invalide ou manquant.';
    end if;
  end if;

  -- CORRIGE : ce n'est plus le code de ramassage (que le livreur connait deja)
  -- mais un code_retour distinct, genere fraichement a la decision de retour
  -- et communique a l'expediteur par un nouveau lien de partage (voir plus
  -- bas). Si aucun code_retour n'a ete genere (etat incoherent), on bloque.
  if p_evenement = 'VALIDER_REMISE_EXPEDITEUR' then
    if v_colis.code_retour is null then
      raise exception 'Aucun code de retour genere pour ce colis. Contacte un agent.';
    end if;
    if upper(coalesce(p_code, '')) <> upper(v_colis.code_retour) then
      raise exception 'Code de retour incorrect.';
    end if;
    -- NOUVEAU : le destinataire n'a pas paye (colis jamais livre) -- c'est
    -- desormais a l'expediteur de regler avant que la remise soit validee,
    -- sur les memes modes de paiement que la livraison normale.
    if v_commande.mode_paiement in ('A_LA_LIVRAISON','PAR_EXPEDITEUR')
       and not exists (select 1 from public.paiements p
                       where p.id_colis = v_colis.id_colis and p.statut = 'PAYE'
                         and p.payeur = 'EXPEDITEUR') then
      raise exception 'Paiement (expediteur) requis avant la remise finale.';
    end if;
  end if;

  -- Application ----------------------------------------------------------------

  -- NOUVEAU : a la decision "retour a l'expediteur", on genere un code de
  -- retour frais et un lien de partage pour le communiquer -- jamais le
  -- meme code que le ramassage initial (faille corrigee).
  if p_evenement = 'VALIDER_RETOUR_EXPEDITEUR' then
    v_nouveau_code_retour := public.generer_code();
  end if;

  update public.colis c set
    statut = v_transition.statut_arrivee,
    motif_retour = case when p_evenement = 'SIGNALER_ECHEC' then p_motif else c.motif_retour end,
    id_lot = case when p_evenement = 'RETIRER_DU_LOT' then null else c.id_lot end,
    code_retour = case when p_evenement = 'VALIDER_RETOUR_EXPEDITEUR' then v_nouveau_code_retour else c.code_retour end,
    id_livreur_retour = case
      when p_evenement = 'ASSIGNER_RETOUR' then nullif(p_details->>'id_livreur','')::uuid
      else c.id_livreur_retour
    end
  where c.id_colis = p_id_colis;

  if p_evenement = 'VALIDER_RETOUR_EXPEDITEUR' then
    insert into public.liens_partage (id_entreprise, type, id_colis)
    values (v_colis.id_entreprise, 'CODE_RETOUR', p_id_colis)
    returning token into v_token_retour;
  end if;

  insert into public.evenements_colis
    (id_entreprise, id_colis, evenement, statut_avant, statut_apres, acteur, role_acteur, motif, details)
  values
    (v_colis.id_entreprise, p_id_colis, p_evenement, v_colis.statut,
     v_transition.statut_arrivee, v_acteur, v_profil.role, p_motif, coalesce(p_details, '{}'::jsonb));

  return query select p_id_colis, v_transition.statut_arrivee;
end;
$$;

-- 5) rpc_lire_lien : gere le nouveau type CODE_RETOUR (affiche code_retour).
drop function if exists public.rpc_lire_lien(uuid);
create or replace function public.rpc_lire_lien(p_token uuid)
returns table (type text, id_commande text, id_colis text,
               expediteur_nom text, destinataire_nom text, gps jsonb, code text)
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  select l.*, cmd.expediteur_nom as exp_nom, cmd.gps_expediteur, cmd.code_ramassage,
         co.destinataire_nom as dest_nom, co.gps_destinataire, co.code_livraison, co.code_retour
  into v
  from public.liens_partage l
  left join public.commandes cmd on cmd.id_commande = l.id_commande
  left join public.colis co on co.id_colis = l.id_colis
  where l.token = p_token and not l.revoque
    and (l.expire_le is null or l.expire_le > now());
  if v.token is null then raise exception 'Lien invalide ou expire.'; end if;
  return query select v.type, v.id_commande, v.id_colis,
    v.exp_nom, v.dest_nom,
    coalesce(v.gps_expediteur, v.gps_destinataire),
    case
      when v.type = 'POSITION_EXPEDITEUR' then v.code_ramassage
      when v.type = 'CODE_RETOUR' then v.code_retour
      else v.code_livraison
    end;
end;
$$;
grant execute on function public.rpc_lire_lien to anon, authenticated;

-- 6) Encaissement especes cote EXPEDITEUR (retours), meme principe que
--    rpc_encaisser_especes mais payeur EXPEDITEUR et reserve aux colis en retour.
create or replace function public.rpc_encaisser_especes_retour(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis record; v_id uuid;
begin
  select * into v_colis from public.colis where id_colis = p_id_colis;
  if v_colis.id_colis is null then raise exception 'Colis introuvable.'; end if;
  if v_colis.statut not in ('EN_RETOUR') then
    raise exception 'Ce colis n''est pas en cours de retour.';
  end if;
  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut, encaisse_par)
  values (v_colis.id_entreprise, p_id_colis, 'EXPEDITEUR', 'ESPECES',
          v_colis.montant_livraison, 'PAYE', v_acteur)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.rpc_encaisser_especes_retour to authenticated;

-- 7) v_missions_livreur : nouvel onglet "AU_HUB" (recuperation, lot ou
--    retour), "A_LIVRER" recentre sur les colis reellement en main (en
--    tournee), et nouvel onglet "RETOURS" avec le mode de resolution du
--    livreur qui inclut desormais les retours assignes.
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
where c.statut not in ('CREE','AU_HUB','A_RETOURNER','LIVRE','RETOURNE','ANNULE');

grant select on public.v_missions_livreur to authenticated;

commit;

select 'fix_22_ok' as status;
