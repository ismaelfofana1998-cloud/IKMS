-- ============================================================================
-- 37 - Agent rattaché à un hub + point relais pour livraison échouée
-- A executer apres 36_multi_hub.sql.
-- ============================================================================
--
-- Deux volets :
--   A) Un agent peut desormais etre rattache a un hub (meme colonne que les
--      livreurs, id_hub_affecte, deja creee au patch 36). Un agent avec un
--      hub affecte ne peut assigner un ramassage que vers SON hub, et ne peut
--      valider un depot/retour que pour des colis reellement a SON hub.
--      Retrocompatible : un agent sans hub affecte (id_hub_affecte null)
--      continue de tout voir/faire, comme avant.
--   B) Point relais : en cas d'echec de livraison (destinataire absent), le
--      livreur peut deposer le colis au hub le plus proche (deja possible
--      via DEMANDER_RETOUR_HUB, etendu ici pour accepter un hub comme pour
--      un depot normal). Un agent peut alors, en plus de "reprogrammer" et
--      "retour expediteur", choisir "point relais" : le colis attend d'etre
--      retire par le destinataire a ce hub precis, qui recoit un SMS. Un
--      nouvel evenement valide le retrait (meme verification de code que la
--      livraison normale, meme regle de paiement).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- A) Nouvelles transitions pour le point relais.
-- ----------------------------------------------------------------------------
insert into public.transitions_colis (statut_depart, evenement, statut_arrivee, roles_autorises) values
  ('RETOUR_RECU', 'VALIDER_POINT_RELAIS', 'POINT_RELAIS', '{agent}'),
  ('POINT_RELAIS', 'RETIRER_POINT_RELAIS', 'LIVRE', '{agent}')
on conflict (statut_depart, evenement) do nothing;

-- ----------------------------------------------------------------------------
-- rpc_assigner_ramassage : un agent rattache a un hub ne peut assigner que
-- vers SON hub -- le parametre p_id_hub est force silencieusement (l'agent
-- n'a de toute facon pas d'autre choix propose cote interface).
-- ----------------------------------------------------------------------------
create or replace function public.rpc_assigner_ramassage(
  p_id_commande text, p_id_livreur uuid, p_acteur uuid default null, p_id_hub uuid default null
) returns setof text
language plpgsql security definer set search_path = public as $$
declare
  v_c record; r record; v_entreprise uuid;
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_hub_agent uuid;
  v_role_acteur text;
begin
  select id_entreprise into v_entreprise from public.commandes where id_commande = p_id_commande;

  select u.role, u.id_hub_affecte into v_role_acteur, v_hub_agent
  from public.utilisateurs u where u.id_utilisateur = v_acteur;

  if v_role_acteur = 'agent' and v_hub_agent is not null then
    p_id_hub := v_hub_agent;
  end if;

  if p_id_hub is not null and not exists (
    select 1 from public.hubs h where h.id_hub = p_id_hub and h.id_entreprise = v_entreprise and h.actif
  ) then
    raise exception 'Hub invalide pour cette entreprise.';
  end if;

  update public.commandes set id_livreur_ramassage = p_id_livreur, id_hub_prevu = coalesce(p_id_hub, id_hub_prevu)
  where id_commande = p_id_commande;

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
-- avancer_colis : ajoute la portee hub des agents (VALIDER_DEPOT,
-- VALIDER_RETOUR_RECU) + hub reel sur DEMANDER_RETOUR_HUB + point relais
-- (VALIDER_POINT_RELAIS, RETIRER_POINT_RELAIS). Repris de sa version la
-- plus recente (patch 36), pas de sa version d'origine -- meme precaution
-- que la fois precedente, dont l'erreur a servi de lecon.
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

  -- Portee hub d'un agent : ne peut valider un depot/retour/retrait que
  -- pour un colis reellement a SON hub -- jamais applique si l'agent n'a
  -- pas de hub affecte (retrocompatibilite entreprise mono-hub). profil_de()
  -- ne renvoie pas id_hub_affecte (signature figee, utilisee ailleurs) :
  -- lecture directe et ciblee ici plutot que d'y toucher.
  if v_profil.role = 'agent' and p_evenement in ('VALIDER_DEPOT','VALIDER_RETOUR_RECU','RETIRER_POINT_RELAIS') then
    select u.id_hub_affecte into v_hub_agent from public.utilisateurs u where u.id_utilisateur = v_acteur;
    if v_hub_agent is not null and v_colis.id_hub_reel is distinct from v_hub_agent then
      raise exception 'Ce colis est a un autre hub que le votre.';
    end if;
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
    if v_commande.mode_paiement = 'PAR_EXPEDITEUR'
       and not exists (select 1 from public.paiements p
                       where p.id_colis = v_colis.id_colis and p.statut = 'PAYE'
                         and p.payeur = 'EXPEDITEUR') then
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
    -- Motif exige UNIQUEMENT pour un depot normal different du hub prevu --
    -- un retour n'a pas de hub "prevu" a proprement parler (point relais
    -- assume), jamais de motif impose ici.
    if p_evenement = 'DEMANDER_DEPOT' and v_id_hub_reel is not null and v_commande.id_hub_prevu is not null
       and v_id_hub_reel <> v_commande.id_hub_prevu and coalesce(trim(p_motif), '') = '' then
      raise exception 'Precise la raison du depot dans un autre hub.';
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
    id_hub_reel = case when p_evenement in ('DEMANDER_DEPOT','DEMANDER_RETOUR_HUB') then coalesce(v_id_hub_reel, c.id_hub_reel) else c.id_hub_reel end,
    motif_hub_different = case
      when p_evenement = 'DEMANDER_DEPOT' and v_id_hub_reel is not null
           and v_commande.id_hub_prevu is not null and v_id_hub_reel <> v_commande.id_hub_prevu
        then p_motif
      when p_evenement = 'DEMANDER_DEPOT' then null
      else c.motif_hub_different
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

select 'fix_37_ok' as status;
