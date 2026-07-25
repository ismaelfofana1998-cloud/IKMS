-- ============================================================================
-- 38 - Hub automatique par zone, dépôt simplifié, reprogrammation avec surcoût
-- A executer apres 37_agent_hub_et_point_relais.sql.
-- ============================================================================
--
-- Decisions actees avec le client, alignees sur les grandes societes de
-- logistique (La Poste, DHL, Amazon) : le hub d'une commande se deduit
-- TOUJOURS de la zone de RAMASSAGE (jamais de la destination -- une commande
-- peut avoir plusieurs destinataires dans des zones differentes, seul le
-- ramassage est un point unique). Le choix se fait une fois pour toutes en
-- configurant quel hub couvre quelle zone -- jamais recalcule au cas par cas.
--
-- Consequences :
--   - Chaque zone peut etre rattachee a un hub (zones_tarification.id_hub).
--   - A la creation d'une commande, le hub prevu se deduit automatiquement
--     de la zone de ramassage -- rpc_assigner_ramassage n'a plus besoin de
--     choisir un hub, il ne fait plus que verifier que l'agent qui assigne
--     appartient bien a ce hub.
--   - Le depot normal (DEMANDER_DEPOT) n'est PLUS un choix : le livreur
--     depose toujours au hub prevu, silencieusement, sans selection ni
--     motif. Seul le depot APRES ECHEC DE LIVRAISON (DEMANDER_RETOUR_HUB)
--     garde la liberte de choisir un hub different (point relais).
--   - Un hub doit avoir une adresse (mais les hubs deja crees sans adresse
--     ne sont pas retroactivement bloques -- a completer par l'entreprise).
--   - La reprogrammation d'une livraison en echec peut inclure un surcout,
--     ajoute au montant du colis.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Hub rattache a une zone (configuration une fois pour toutes, comme les
-- tarifs). Nullable : une zone sans hub assigne se comporte comme avant
-- (aucun hub prevu, retrocompatible pour les entreprises mono-hub qui n'ont
-- pas encore configure cette correspondance).
-- ----------------------------------------------------------------------------
alter table public.zones_tarification
  add column if not exists id_hub uuid references public.hubs(id_hub);

-- Adresse obligatoire pour un NOUVEAU hub -- les hubs deja crees sans
-- adresse ne sont pas bloques retroactivement (pas de sens de casser des
-- donnees existantes pour une regle qui n'existait pas encore).
alter table public.hubs alter column adresse drop not null;
create or replace function public.verifier_adresse_hub() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'INSERT' and coalesce(trim(new.adresse), '') = '' then
    raise exception 'L''adresse est obligatoire a la creation d''un hub.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_verifier_adresse_hub on public.hubs;
create trigger trg_verifier_adresse_hub before insert on public.hubs
  for each row execute function public.verifier_adresse_hub();

-- ----------------------------------------------------------------------------
-- rpc_creer_commande : deduit automatiquement le hub prevu depuis la zone de
-- ramassage. Repris de sa version la plus recente (patch 27), pas de
-- l'origine -- meme precaution que d'habitude.
-- ----------------------------------------------------------------------------
create or replace function public.rpc_creer_commande(
  p_code_entreprise text,
  p_expediteur_nom text,
  p_expediteur_tel text,
  p_expediteur_adresse text,
  p_gps_expediteur jsonb,
  p_mode_paiement text,
  p_colis jsonb,
  p_canal text default 'DIRECT',
  p_acteur uuid default null,
  p_zone_depart text default null,
  p_id_client_pro uuid default null
) returns table (id_commande text, code_ramassage text, token_expediteur uuid,
                 id_colis text, code_livraison text, token_destinataire uuid,
                 montant_livraison numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_entreprise uuid;
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_id_client_pro uuid;
  v_mode_paiement text := coalesce(nullif(p_mode_paiement, ''), 'A_LA_LIVRAISON');
  v_id_commande text;
  v_code_ramassage text := public.generer_code();
  v_token_exp uuid;
  v_item jsonb;
  v_code_zone text;
  v_id_colis text;
  v_code_livraison text;
  v_montant numeric;
  v_total_client_pro numeric := 0;
  v_token_dest uuid;
  v_id_hub_prevu uuid;
begin
  select e.id_entreprise into v_entreprise
  from public.entreprises e
  where e.code_entreprise = upper(trim(p_code_entreprise)) and e.actif;
  if v_entreprise is null then
    raise exception 'Entreprise inconnue : %.', p_code_entreprise;
  end if;

  if p_canal = 'INTERNE' then
    if not exists (select 1 from public.utilisateurs u
                   where u.id_utilisateur = v_acteur and u.actif
                     and u.role in ('agent','admin','super_admin')
                     and (u.id_entreprise = v_entreprise or u.role = 'super_admin')) then
      raise exception 'Canal INTERNE reserve aux agents de l''entreprise.';
    end if;
    if p_id_client_pro is not null then
      if not exists (select 1 from public.clients_pro c
                     where c.id_client = p_id_client_pro and c.id_entreprise = v_entreprise and c.actif) then
        raise exception 'Client pro introuvable pour cette entreprise.';
      end if;
      v_id_client_pro := p_id_client_pro;
    end if;
  end if;

  if p_canal = 'CLIENT_PRO' then
    v_id_client_pro := public.client_pro_de(v_acteur);
    if v_id_client_pro is null then
      raise exception 'Compte client pro introuvable ou inactif.';
    end if;
    if not exists (select 1 from public.clients_pro c
                   where c.id_client = v_id_client_pro and c.id_entreprise = v_entreprise) then
      raise exception 'Ce compte client n''appartient pas a cette entreprise.';
    end if;
  end if;

  if jsonb_array_length(coalesce(p_colis, '[]'::jsonb)) = 0 then
    raise exception 'Au moins un colis est requis.';
  end if;

  if p_zone_depart is null or trim(p_zone_depart) = '' then
    raise exception 'La zone de ramassage (zone de depart) est obligatoire.';
  end if;

  select z.id_hub into v_id_hub_prevu
  from public.zones_tarification z
  where z.id_entreprise = v_entreprise and z.actif and z.code_zone = upper(p_zone_depart);

  if not found then
    raise exception 'Zone de ramassage invalide : %.', p_zone_depart;
  end if;

  v_id_commande := public.generer_id(v_entreprise, 'commande', 'CMD');

  insert into public.commandes
    (id_commande, id_entreprise, canal_creation, cree_par, id_client_pro, expediteur_nom, expediteur_tel,
     expediteur_adresse, gps_expediteur, code_ramassage, mode_paiement, id_hub_prevu)
  values
    (v_id_commande, v_entreprise, p_canal,
     case when p_canal = 'INTERNE' then v_acteur else null end,
     v_id_client_pro,
     trim(p_expediteur_nom), trim(p_expediteur_tel), p_expediteur_adresse,
     p_gps_expediteur, v_code_ramassage, v_mode_paiement, v_id_hub_prevu);

  insert into public.liens_partage (id_entreprise, type, id_commande)
  values (v_entreprise, 'POSITION_EXPEDITEUR', v_id_commande)
  returning token into v_token_exp;

  for v_item in select * from jsonb_array_elements(p_colis) loop
    v_code_zone := upper(coalesce(v_item->>'code_zone', ''));

    if v_code_zone = '' or not exists (
      select 1 from public.zones_tarification z
      where z.id_entreprise = v_entreprise and z.actif and z.code_zone = v_code_zone
    ) then
      raise exception 'Zone de livraison invalide ou manquante pour le destinataire "%".',
        coalesce(v_item->>'destinataire_nom', '?');
    end if;

    v_id_colis := public.generer_id(v_entreprise, 'colis', 'COL');
    v_code_livraison := public.generer_code();
    v_montant := public.tarif_zone_zone(v_entreprise, p_zone_depart, v_code_zone);

    if v_montant is null then
      raise exception
        'Aucun tarif configure entre les zones % et %. Ajoute-le dans Zones et tarifs avant de reessayer.',
        upper(p_zone_depart), v_code_zone;
    end if;
    v_total_client_pro := v_total_client_pro + v_montant;

    insert into public.colis
      (id_colis, id_entreprise, id_commande, destinataire_nom, destinataire_tel,
       destinataire_adresse, code_livraison, code_zone, montant_livraison)
    values
      (v_id_colis, v_entreprise, v_id_commande,
       trim(v_item->>'destinataire_nom'), trim(v_item->>'destinataire_tel'),
       v_item->>'destinataire_adresse', v_code_livraison,
       v_code_zone, v_montant);

    insert into public.evenements_colis
      (id_entreprise, id_colis, evenement, statut_avant, statut_apres, acteur, role_acteur)
    values (v_entreprise, v_id_colis, 'CREATION', null, 'CREE', v_acteur, p_canal);

    insert into public.liens_partage (id_entreprise, type, id_colis)
    values (v_entreprise, 'POSITION_DESTINATAIRE', v_id_colis)
    returning token into v_token_dest;

    id_commande := v_id_commande; code_ramassage := v_code_ramassage;
    token_expediteur := v_token_exp; id_colis := v_id_colis;
    code_livraison := v_code_livraison; token_destinataire := v_token_dest;
    montant_livraison := v_montant;
    return next;
  end loop;

  if v_id_client_pro is not null and v_mode_paiement = 'SANS_PAIEMENT' and v_total_client_pro > 0 then
    update public.clients_pro set solde_portefeuille = solde_portefeuille - v_total_client_pro
    where id_client = v_id_client_pro;

    insert into public.mouvements_portefeuille (id_entreprise, id_client, type, montant, id_commande, note, cree_par)
    values (v_entreprise, v_id_client_pro, 'DEBIT_COMMANDE', -v_total_client_pro, v_id_commande,
            'Commande facturée', case when p_canal = 'INTERNE' then v_acteur else null end);
  end if;
end;
$$;
grant execute on function public.rpc_creer_commande to authenticated, anon;

-- ----------------------------------------------------------------------------
-- rpc_assigner_ramassage : simplifie -- ne choisit plus de hub (deja fixe a
-- la creation de la commande). Verifie a la place qu'un agent (pas admin)
-- appartient bien au hub prevu de cette commande.
-- ----------------------------------------------------------------------------
drop function if exists public.rpc_assigner_ramassage(text, uuid, uuid, uuid);
create or replace function public.rpc_assigner_ramassage(
  p_id_commande text, p_id_livreur uuid, p_acteur uuid default null
) returns setof text
language plpgsql security definer set search_path = public as $$
declare
  v_c record; r record;
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_role_acteur text;
  v_hub_agent uuid;
  v_hub_commande uuid;
begin
  select u.role, u.id_hub_affecte into v_role_acteur, v_hub_agent
  from public.utilisateurs u where u.id_utilisateur = v_acteur;

  select id_hub_prevu into v_hub_commande from public.commandes where id_commande = p_id_commande;

  if v_role_acteur = 'agent' and v_hub_agent is not null
     and v_hub_commande is not null and v_hub_agent <> v_hub_commande then
    raise exception 'Cette commande appartient a un autre hub que le votre.';
  end if;

  update public.commandes set id_livreur_ramassage = p_id_livreur where id_commande = p_id_commande;

  for v_c in select c.id_colis from public.colis c
             where c.id_commande = p_id_commande and c.statut = 'CREE' loop
    for r in select * from public.avancer_colis(v_c.id_colis, 'ASSIGNER_RAMASSAGE',
                        null, null, jsonb_build_object('id_livreur', p_id_livreur), p_acteur) loop
      return next r.id_colis;
    end loop;
  end loop;
end;
$$;
grant execute on function public.rpc_assigner_ramassage to authenticated;

-- ----------------------------------------------------------------------------
-- avancer_colis : depot normal simplifie (plus de choix de hub, jamais de
-- motif), reprogrammation avec surcout optionnel. Repris de sa version la
-- plus recente (patch 37).
-- ----------------------------------------------------------------------------
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
  v_id_hub_reel uuid;
  v_hub_agent uuid;
  v_supplement numeric;
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

  if v_profil.role = 'agent' and p_evenement in ('VALIDER_DEPOT','VALIDER_RETOUR_RECU','RETIRER_POINT_RELAIS') then
    select u.id_hub_affecte into v_hub_agent from public.utilisateurs u where u.id_utilisateur = v_acteur;
    if v_hub_agent is not null and v_colis.id_hub_reel is distinct from v_hub_agent then
      raise exception 'Ce colis est a un autre hub que le votre.';
    end if;
  end if;

  if p_evenement = 'VALIDER_RAMASSAGE' then
    if v_commande.id_livreur_ramassage is distinct from v_acteur
       and v_profil.role = 'livreur' then
      raise exception 'Ce ramassage ne vous est pas assigne.';
    end if;
    if upper(coalesce(p_code, '')) <> upper(v_commande.code_ramassage) then
      raise exception 'Code ramassage incorrect.';
    end if;
    if v_commande.mode_paiement = 'PAR_EXPEDITEUR'
       and not exists (select 1 from public.paiements p
                       where p.id_colis = v_colis.id_colis and p.statut = 'PAYE'
                         and p.payeur = 'EXPEDITEUR') then
      raise exception 'Paiement (expediteur) requis avant de valider le ramassage.';
    end if;
  end if;

  -- DEMANDER_DEPOT (depot normal apres ramassage) : simplifie, plus de choix
  -- -- toujours le hub prevu de la commande, silencieusement, jamais de
  -- motif a saisir. Seul DEMANDER_RETOUR_HUB (echec de livraison) garde la
  -- liberte de choisir un hub different (point relais), comme avant.
  if p_evenement = 'DEMANDER_RETOUR_HUB' then
    v_id_hub_reel := nullif(p_details->>'id_hub_reel', '')::uuid;
    if v_id_hub_reel is not null and not exists (
      select 1 from public.hubs h where h.id_hub = v_id_hub_reel and h.id_entreprise = v_colis.id_entreprise and h.actif
    ) then
      raise exception 'Hub invalide pour cette entreprise.';
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

  if p_evenement = 'DEMANDER_RECUPERATION_RETOUR' then
    if v_colis.id_livreur_retour is distinct from v_acteur then
      raise exception 'Ce retour ne vous est pas assigne.';
    end if;
  end if;

  if p_evenement in ('VALIDER_LIVRAISON', 'RETIRER_POINT_RELAIS') then
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

  -- Reprogrammation avec surcout optionnel (appel au destinataire pour lui
  -- proposer, le montant est celui convenu par telephone).
  if p_evenement = 'VALIDER_RETOUR_REPROGRAMMER' then
    v_supplement := nullif(p_details->>'supplement', '')::numeric;
    if v_supplement is not null and v_supplement < 0 then
      raise exception 'Le supplement ne peut pas etre negatif.';
    end if;
  end if;

  if p_evenement = 'VALIDER_REMISE_EXPEDITEUR' then
    if v_colis.code_retour is null then
      raise exception 'Aucun code de retour genere pour ce colis. Contacte un agent.';
    end if;
    if upper(coalesce(p_code, '')) <> upper(v_colis.code_retour) then
      raise exception 'Code de retour incorrect.';
    end if;
    if v_commande.mode_paiement in ('A_LA_LIVRAISON','PAR_EXPEDITEUR')
       and not exists (select 1 from public.paiements p
                       where p.id_colis = v_colis.id_colis and p.statut = 'PAYE'
                         and p.payeur = 'EXPEDITEUR') then
      raise exception 'Paiement (expediteur) requis avant la remise finale.';
    end if;
  end if;

  -- Application ----------------------------------------------------------------
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
    end,
    id_hub_reel = case
      when p_evenement = 'DEMANDER_DEPOT' then v_commande.id_hub_prevu
      when p_evenement = 'DEMANDER_RETOUR_HUB' then coalesce(v_id_hub_reel, c.id_hub_reel)
      else c.id_hub_reel
    end,
    montant_livraison = case
      when p_evenement = 'VALIDER_RETOUR_REPROGRAMMER' and v_supplement is not null
        then c.montant_livraison + v_supplement
      else c.montant_livraison
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
grant execute on function public.avancer_colis to authenticated;

-- ----------------------------------------------------------------------------
-- rpc_decider_retour : ajoute un supplement optionnel, transmis a
-- avancer_colis pour la reprogrammation (voir plus haut). Ajoute un
-- parametre a la fin (retrocompatible avec les appels existants).
-- ----------------------------------------------------------------------------
drop function if exists public.rpc_decider_retour(text, text, uuid);
create or replace function public.rpc_decider_retour(
  p_id_colis text, p_decision text, p_acteur uuid default null, p_supplement numeric default null
) returns table (id_colis text, statut text, token_code_retour uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_evenement text := case when p_decision = 'REPROGRAMMER' then 'VALIDER_RETOUR_REPROGRAMMER' else 'VALIDER_RETOUR_EXPEDITEUR' end;
  v_resultat record;
  v_token uuid;
  v_details jsonb := case when p_supplement is not null then jsonb_build_object('supplement', p_supplement) else '{}'::jsonb end;
begin
  select * into v_resultat from public.avancer_colis(p_id_colis, v_evenement, null, null, v_details, p_acteur);

  if v_evenement = 'VALIDER_RETOUR_EXPEDITEUR' then
    select l.token into v_token
    from public.liens_partage l
    where l.id_colis = p_id_colis and l.type = 'CODE_RETOUR'
    order by l.cree_le desc
    limit 1;
  end if;

  id_colis := v_resultat.id_colis;
  statut := v_resultat.statut;
  token_code_retour := v_token;
  return next;
end;
$$;
grant execute on function public.rpc_decider_retour to authenticated;

commit;

select 'fix_38_ok' as status;
