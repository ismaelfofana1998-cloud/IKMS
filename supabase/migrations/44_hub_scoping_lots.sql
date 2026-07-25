-- ============================================================================
-- 44 - Portee hub pour la creation/modification des lots
-- A executer apres 43_lien_utile_expediteur.sql.
--
-- Signale a juste titre : n'importe quel agent, de n'importe quel hub,
-- pouvait regrouper en lot des colis physiquement a un AUTRE hub. Un agent
-- de Yopougon n'a rien a faire avec des colis reellement a Cocody -- ni
-- pour les regrouper, ni pour en ajouter a un lot existant. Meme logique
-- que ramassage/reception/retours, juste oubliee sur les lots.
-- ============================================================================

begin;

-- Le hub du lot se deduit du (des) colis qu'il contient -- fixe des la
-- creation, sert a verifier la coherence des ajouts ulterieurs.
alter table public.lots_livraison add column if not exists id_hub uuid references public.hubs(id_hub);

-- ----------------------------------------------------------------------------
-- rpc_creer_lot : verifie que tous les colis appartiennent au MEME hub, et
-- que l'agent (s'il en a un) est bien rattache a ce hub.
-- ----------------------------------------------------------------------------
create or replace function public.rpc_creer_lot(
  p_colis text[], p_note text default null, p_acteur uuid default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_entreprise uuid := public.entreprise_de(v_acteur);
  v_id_lot text;
  v_id text;
  v_hub_agent uuid;
  v_role_agent text;
  v_hub_lot uuid;
  v_hub_colis uuid;
begin
  if array_length(p_colis, 1) is null then raise exception 'Lot vide.'; end if;

  select u.role, u.id_hub_affecte into v_role_agent, v_hub_agent
  from public.utilisateurs u where u.id_utilisateur = v_acteur;

  foreach v_id in array p_colis loop
    select c.id_hub_reel into v_hub_colis from public.colis c where c.id_colis = v_id;
    if v_hub_lot is null then
      v_hub_lot := v_hub_colis;
    elsif v_hub_colis is distinct from v_hub_lot then
      raise exception 'Un lot ne peut regrouper que des colis d''un même hub (colis % à un autre hub).', v_id;
    end if;
  end loop;

  if v_role_agent = 'agent' and v_hub_agent is not null
     and v_hub_lot is not null and v_hub_agent <> v_hub_lot then
    raise exception 'Ces colis sont à un autre hub que le vôtre.';
  end if;

  v_id_lot := public.generer_id(v_entreprise, 'lot', 'LOT');
  insert into public.lots_livraison (id_lot, id_entreprise, cree_par, note, id_hub)
  values (v_id_lot, v_entreprise, v_acteur, p_note, v_hub_lot);
  foreach v_id in array p_colis loop
    update public.colis set id_lot = v_id_lot where id_colis = v_id;
    perform public.avancer_colis(v_id, 'METTRE_EN_LOT', null, null,
      jsonb_build_object('id_lot', v_id_lot), p_acteur);
  end loop;
  return v_id_lot;
end;
$$;

-- ----------------------------------------------------------------------------
-- rpc_modifier_lot : un ajout doit respecter le hub deja etabli du lot
-- (et, pour un agent avec un hub, son propre hub).
-- ----------------------------------------------------------------------------
create or replace function public.rpc_modifier_lot(
  p_id_lot text, p_ajouter text[] default '{}', p_retirer text[] default '{}',
  p_acteur uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_id text;
  v_hub_agent uuid;
  v_role_agent text;
  v_hub_lot uuid;
  v_hub_colis uuid;
begin
  if public.lot_est_fige(p_id_lot) then
    raise exception 'Lot fige : une recuperation a deja demarre.';
  end if;

  select u.role, u.id_hub_affecte into v_role_agent, v_hub_agent
  from public.utilisateurs u where u.id_utilisateur = v_acteur;
  select id_hub into v_hub_lot from public.lots_livraison where id_lot = p_id_lot;

  foreach v_id in array coalesce(p_retirer, '{}') loop
    perform public.avancer_colis(v_id, 'RETIRER_DU_LOT', null, null, '{}'::jsonb, p_acteur);
  end loop;

  foreach v_id in array coalesce(p_ajouter, '{}') loop
    select c.id_hub_reel into v_hub_colis from public.colis c where c.id_colis = v_id;
    if v_hub_lot is not null and v_hub_colis is distinct from v_hub_lot then
      raise exception 'Ce colis est à un autre hub que celui de ce lot.';
    end if;
    if v_role_agent = 'agent' and v_hub_agent is not null
       and v_hub_lot is not null and v_hub_agent <> v_hub_lot then
      raise exception 'Ce lot est à un autre hub que le vôtre.';
    end if;
    update public.colis set id_lot = p_id_lot where id_colis = v_id;
    perform public.avancer_colis(v_id, 'METTRE_EN_LOT', null, null,
      jsonb_build_object('id_lot', p_id_lot), p_acteur);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- avancer_colis : le garde-fou hub d'un agent doit aussi couvrir
-- METTRE_EN_LOT -- rpc_creer_lot/rpc_modifier_lot verifient deja la
-- coherence, mais avancer_colis reste appelable directement (accorde a
-- authenticated) : sans ce garde-fou ici aussi, un agent pourrait
-- contourner ces RPC et mettre en lot un colis d'un autre hub quand meme.
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

  if v_profil.role = 'agent' and p_evenement in ('VALIDER_DEPOT','VALIDER_RETOUR_RECU','RETIRER_POINT_RELAIS','METTRE_EN_LOT') then
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
    if v_commande.mode_paiement = 'PAR_EXPEDITEUR' and public.montant_du(v_colis.id_colis) > 0 then
      raise exception 'Paiement (expediteur) requis avant de valider le ramassage.';
    end if;
  end if;

  if p_evenement in ('DEMANDER_DEPOT', 'DEMANDER_RETOUR_HUB') then
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
    if v_commande.mode_paiement <> 'SANS_PAIEMENT' and public.montant_du(v_colis.id_colis) > 0 then
      raise exception 'Paiement requis avant la remise du colis (solde restant : % FCFA).', public.montant_du(v_colis.id_colis);
    end if;
  end if;

  if p_evenement = 'SIGNALER_ECHEC' then
    if coalesce(p_motif, '') not in
       ('DESTINATAIRE_ABSENT','INJOIGNABLE','ADRESSE_INTROUVABLE','ANNULATION_CLIENT','REFUS_COLIS','AUTRE') then
      raise exception 'Motif d''echec invalide ou manquant.';
    end if;
  end if;

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

commit;

select 'fix_44_ok' as status;
