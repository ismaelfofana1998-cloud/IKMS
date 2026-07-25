-- ============================================================================
-- 39 - Solde dû (montant_du), surcoût de reprogrammation, Wave groupé par commande
-- A executer apres 38_hub_automatique_zone.sql.
-- ============================================================================
--
-- Trois bugs signales, une seule cause profonde : tous les encaissements
-- inseraient aveuglement un paiement pour colis.montant_livraison en entier,
-- sans jamais regarder ce qui avait deja ete paye. Ca marchait tant qu'un
-- colis n'etait paye qu'une seule fois -- des qu'un surcout de
-- reprogrammation s'ajoute APRES un premier paiement (PAR_EXPEDITEUR au
-- ramassage), plus rien ne fonctionne correctement :
--   - le surcout n'etait jamais reclame a personne ;
--   - la livraison finale ne bloquait jamais sur un paiement manquant (le
--     garde-fou ne s'appliquait qu'au mode A_LA_LIVRAISON) ;
--   - un nouvel encaissement aurait factures le montant total une DEUXIEME
--     fois, au lieu de la difference restante.
--
-- Correctif : une fonction "montant_du" (solde restant = montant_livraison
-- moins la somme de ce qui est deja marque PAYE) sert desormais partout --
-- pour bloquer une etape, et pour determiner combien encaisser reellement.
--
-- Egalement : le paiement Wave par l'expediteur peut desormais couvrir toute
-- la commande en une seule fois (plusieurs colis, un seul paiement Wave),
-- alors que le paiement Wave du destinataire reste par colis (chaque
-- destinataire est une livraison distincte). Le paiement espece n'a jamais
-- eu ce probleme (deja fait colis par colis avec une boucle cote client).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Solde restant du sur un colis : ce que la fonction retourne est toujours
-- correct, meme si aucun paiement n'a jamais ete cree, meme apres un
-- surcout de reprogrammation.
-- ----------------------------------------------------------------------------
create or replace function public.montant_du(p_id_colis text) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0,
    coalesce((select c.montant_livraison from public.colis c where c.id_colis = p_id_colis), 0)
    - coalesce((select sum(p.montant) from public.paiements p
                where p.id_colis = p_id_colis and p.statut = 'PAYE'), 0)
  );
$$;
grant execute on function public.montant_du to authenticated;

-- ----------------------------------------------------------------------------
-- verifier_livreur_assigne_colis : le garde-fou "deja paye" verifiait
-- l'existence d'UN paiement PAYE quelconque -- devenu incorrect depuis que
-- plusieurs paiements peuvent exister sur un meme colis (paiement initial +
-- surcout de reprogrammation) : un ancien paiement (ex. ramassage
-- PAR_EXPEDITEUR) bloquait a tort la collecte d'un solde different (le
-- surcout, cote destinataire). Utilise maintenant montant_du(). Trouve en
-- testant le scenario complet avant livraison -- jamais applique en
-- production, corrige avant de rien livrer.
-- ----------------------------------------------------------------------------
create or replace function public.verifier_livreur_assigne_retour(p_id_colis text, p_acteur uuid)
returns public.colis
language plpgsql security definer set search_path = public as $$
declare
  v_colis public.colis;
  v_profil record;
begin
  select * into v_profil from public.profil_de(p_acteur);
  if v_profil.id_utilisateur is null or not v_profil.actif or v_profil.role <> 'livreur' then
    raise exception 'Seul un livreur actif peut encaisser un paiement.';
  end if;

  select * into v_colis from public.colis c where c.id_colis = p_id_colis;
  if v_colis.id_colis is null then raise exception 'Colis introuvable.'; end if;
  if v_colis.statut <> 'EN_RETOUR' then
    raise exception 'Ce colis n''est pas en cours de retour (statut actuel : %).', v_colis.statut;
  end if;
  if v_colis.id_livreur_retour is distinct from p_acteur then
    raise exception 'Ce retour ne vous est pas assigne.';
  end if;
  if public.montant_du(p_id_colis) <= 0 then
    raise exception 'Ce colis est deja entierement paye.';
  end if;
  return v_colis;
end;
$$;

create or replace function public.verifier_livreur_assigne_colis(p_id_colis text, p_acteur uuid)
returns public.colis
language plpgsql security definer set search_path = public as $$
declare
  v_colis public.colis;
  v_profil record;
begin
  select * into v_profil from public.profil_de(p_acteur);
  if v_profil.id_utilisateur is null or not v_profil.actif or v_profil.role <> 'livreur' then
    raise exception 'Seul un livreur actif peut encaisser un paiement.';
  end if;

  select * into v_colis from public.colis c where c.id_colis = p_id_colis;
  if v_colis.id_colis is null then raise exception 'Colis introuvable.'; end if;
  if v_colis.statut <> 'EN_TOURNEE' then
    raise exception 'Ce colis n''est pas en tournee de livraison (statut actuel : %).', v_colis.statut;
  end if;
  if not exists (select 1 from public.lots_livraison l
                 where l.id_lot = v_colis.id_lot and l.id_livreur = p_acteur) then
    raise exception 'Ce colis ne vous est pas assigne.';
  end if;
  if public.montant_du(p_id_colis) <= 0 then
    raise exception 'Ce colis est deja entierement paye.';
  end if;
  return v_colis;
end;
$$;

-- Regroupe plusieurs paiements (colis differents, meme commande) sous un
-- meme identifiant -- utilise pour le paiement Wave "expediteur = toute la
-- commande" : plusieurs lignes de paiement (une par colis, pour garder les
-- montants individuels corrects), mais une seule session Wave, confirmees
-- ensemble par le webhook.
alter table public.paiements add column if not exists groupe_paiement uuid;
create index if not exists idx_paiements_groupe on public.paiements(groupe_paiement);

-- ----------------------------------------------------------------------------
-- rpc_confirmer_paiement : gere maintenant aussi bien un paiement unique
-- (p_id_paiement = id d'une ligne) qu'un groupe (p_id_paiement = groupe_paiement
-- partage par plusieurs lignes). id_event_externe doit rester unique par
-- ligne (contrainte existante) -- suffixe par ligne quand plusieurs lignes
-- partagent le meme evenement Wave.
-- ----------------------------------------------------------------------------
create or replace function public.rpc_confirmer_paiement(
  p_id_paiement uuid, p_reference_externe text, p_id_event_externe text, p_succes boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_ligne record;
  v_rang int := 0;
begin
  if v_claims is not null and v_claims <> '' then
    if coalesce(v_claims::jsonb ->> 'role', '') <> 'service_role' then
      raise exception 'Seul le webhook de paiement (service_role) peut confirmer un paiement.';
    end if;
  end if;

  if exists (select 1 from public.paiements where id_event_externe = p_id_event_externe) then
    return; -- deja traite (idempotence), rien a refaire
  end if;

  for v_ligne in
    select id from public.paiements
    where (id = p_id_paiement or groupe_paiement = p_id_paiement)
      and statut in ('EN_ATTENTE', 'INITIE')
    order by cree_le
  loop
    v_rang := v_rang + 1;
    update public.paiements set
      statut = case when p_succes then 'PAYE' else 'ECHOUE' end,
      reference_externe = p_reference_externe,
      id_event_externe = case when v_rang = 1 then p_id_event_externe else p_id_event_externe || '#' || v_rang end
    where id = v_ligne.id;
  end loop;
end;
$$;
revoke execute on function public.rpc_confirmer_paiement(uuid, text, text, boolean) from public;

-- ----------------------------------------------------------------------------
-- Encaissements existants : chargent desormais le solde restant (montant_du),
-- jamais montant_livraison en entier -- correct que ce soit le premier
-- paiement (solde = montant total) ou un paiement complementaire apres
-- surcout (solde = juste la difference). Bloquent proprement si le solde
-- est deja a zero, plutot que d'accepter un encaissement inutile.
-- ----------------------------------------------------------------------------
create or replace function public.rpc_encaisser_especes(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis public.colis; v_id uuid; v_solde numeric;
begin
  v_colis := public.verifier_livreur_assigne_colis(p_id_colis, v_acteur);
  v_solde := public.montant_du(p_id_colis);
  if v_solde <= 0 then raise exception 'Ce colis est deja entierement paye.'; end if;
  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut, encaisse_par)
  values (v_colis.id_entreprise, p_id_colis, 'DESTINATAIRE', 'ESPECES', v_solde, 'PAYE', v_acteur)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rpc_initier_paiement_wave(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis public.colis; v_id uuid; v_solde numeric;
begin
  v_colis := public.verifier_livreur_assigne_colis(p_id_colis, v_acteur);
  v_solde := public.montant_du(p_id_colis);
  if v_solde <= 0 then raise exception 'Ce colis est deja entierement paye.'; end if;
  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut, encaisse_par)
  values (v_colis.id_entreprise, p_id_colis, 'DESTINATAIRE', 'WAVE', v_solde, 'INITIE', v_acteur)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rpc_encaisser_especes_retour(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis public.colis; v_id uuid; v_solde numeric;
begin
  v_colis := public.verifier_livreur_assigne_retour(p_id_colis, v_acteur);
  v_solde := public.montant_du(p_id_colis);
  if v_solde <= 0 then raise exception 'Ce colis est deja entierement paye.'; end if;
  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut, encaisse_par)
  values (v_colis.id_entreprise, p_id_colis, 'EXPEDITEUR', 'ESPECES', v_solde, 'PAYE', v_acteur)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rpc_initier_paiement_wave_retour(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis public.colis; v_id uuid; v_solde numeric;
begin
  v_colis := public.verifier_livreur_assigne_retour(p_id_colis, v_acteur);
  v_solde := public.montant_du(p_id_colis);
  if v_solde <= 0 then raise exception 'Ce colis est deja entierement paye.'; end if;
  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut)
  values (v_colis.id_entreprise, p_id_colis, 'EXPEDITEUR', 'WAVE', v_solde, 'INITIE')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rpc_encaisser_especes_ramassage(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis public.colis; v_commande record; v_id uuid; v_profil record; v_solde numeric;
begin
  select * into v_profil from public.profil_de(v_acteur);
  if v_profil.id_utilisateur is null or not v_profil.actif or v_profil.role <> 'livreur' then
    raise exception 'Seul un livreur actif peut encaisser un paiement.';
  end if;
  select * into v_colis from public.colis c where c.id_colis = p_id_colis;
  if v_colis.id_colis is null then raise exception 'Colis introuvable.'; end if;
  select * into v_commande from public.commandes where id_commande = v_colis.id_commande;
  if v_commande.id_livreur_ramassage is distinct from v_acteur then
    raise exception 'Ce ramassage ne vous est pas assigne.';
  end if;
  v_solde := public.montant_du(p_id_colis);
  if v_solde <= 0 then raise exception 'Ce colis est deja entierement paye.'; end if;
  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut, encaisse_par)
  values (v_colis.id_entreprise, p_id_colis, 'EXPEDITEUR', 'ESPECES', v_solde, 'PAYE', v_acteur)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rpc_initier_paiement_wave_ramassage(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis public.colis; v_commande record; v_id uuid; v_profil record; v_solde numeric;
begin
  select * into v_profil from public.profil_de(v_acteur);
  if v_profil.id_utilisateur is null or not v_profil.actif or v_profil.role <> 'livreur' then
    raise exception 'Seul un livreur actif peut encaisser un paiement.';
  end if;
  select * into v_colis from public.colis c where c.id_colis = p_id_colis;
  if v_colis.id_colis is null then raise exception 'Colis introuvable.'; end if;
  select * into v_commande from public.commandes where id_commande = v_colis.id_commande;
  if v_commande.id_livreur_ramassage is distinct from v_acteur then
    raise exception 'Ce ramassage ne vous est pas assigne.';
  end if;
  v_solde := public.montant_du(p_id_colis);
  if v_solde <= 0 then raise exception 'Ce colis est deja entierement paye.'; end if;
  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut)
  values (v_colis.id_entreprise, p_id_colis, 'EXPEDITEUR', 'WAVE', v_solde, 'INITIE')
  returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- NOUVEAU : paiement Wave expediteur pour TOUTE la commande en une fois
-- (plusieurs colis, une seule session Wave) -- une ligne de paiement par
-- colis concerne (pour garder des montants individuels corrects et ne pas
-- toucher aux garde-fous existants), toutes partageant le meme
-- groupe_paiement, confirmees ensemble par le webhook.
-- ----------------------------------------------------------------------------
create or replace function public.rpc_initier_paiement_wave_ramassage_commande(
  p_id_commande text, p_acteur uuid default null
) returns table (groupe_paiement uuid, montant_total numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_profil record;
  v_commande record;
  v_groupe uuid := gen_random_uuid();
  v_total numeric := 0;
  v_colis record;
  v_solde numeric;
begin
  select * into v_profil from public.profil_de(v_acteur);
  if v_profil.id_utilisateur is null or not v_profil.actif or v_profil.role <> 'livreur' then
    raise exception 'Seul un livreur actif peut encaisser un paiement.';
  end if;

  select * into v_commande from public.commandes where id_commande = p_id_commande;
  if v_commande.id_commande is null then raise exception 'Commande introuvable.'; end if;
  if v_commande.id_livreur_ramassage is distinct from v_acteur then
    raise exception 'Ce ramassage ne vous est pas assigne.';
  end if;

  for v_colis in select c.id_colis from public.colis c where c.id_commande = p_id_commande loop
    v_solde := public.montant_du(v_colis.id_colis);
    if v_solde > 0 then
      insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut, groupe_paiement)
      values (v_commande.id_entreprise, v_colis.id_colis, 'EXPEDITEUR', 'WAVE', v_solde, 'INITIE', v_groupe);
      v_total := v_total + v_solde;
    end if;
  end loop;

  if v_total <= 0 then raise exception 'Rien a payer pour cette commande.'; end if;

  groupe_paiement := v_groupe;
  montant_total := v_total;
  return next;
end;
$$;
grant execute on function public.rpc_initier_paiement_wave_ramassage_commande to authenticated;

-- ----------------------------------------------------------------------------
-- avancer_colis : les garde-fous de paiement utilisent maintenant
-- montant_du() -- correct pour le cas normal (identique a avant) ET pour le
-- cas d'un surcout ajoute apres un premier paiement (nouveau garde-fou :
-- desormais applique a TOUT mode sauf SANS_PAIEMENT, pas seulement
-- A_LA_LIVRAISON, pour couvrir le surcout PAR_EXPEDITEUR).
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

  -- Garde-fou de paiement etendu : s'applique a tout mode sauf SANS_PAIEMENT
  -- (facture separement, jamais bloquant ici) -- couvre desormais aussi le
  -- surcout de reprogrammation ajoute apres un premier paiement PAR_EXPEDITEUR.
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

-- ----------------------------------------------------------------------------
-- v_missions_livreur : "paye" et "paye_par_expediteur" reflètent maintenant
-- le vrai solde (montant_du = 0), pas juste "un paiement existe" -- sinon un
-- colis avec un surcout de reprogrammation continuerait d'afficher "Payé"
-- alors qu'il reste un solde a encaisser. Repris de sa version la plus
-- recente (patch 36), colonnes inchangees sauf ce calcul.
-- ----------------------------------------------------------------------------
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
  -- L'ordre compte : un colis en retour garde souvent une reference vers
  -- son ANCIEN lot de livraison (jamais nettoyee, ce n'est pas son role) --
  -- si on regardait l.id_livreur en premier, un retour reaffecte a un
  -- NOUVEAU livreur continuerait d'apparaitre chez l'ANCIEN. id_livreur_retour,
  -- des qu'il est renseigne, signifie sans ambiguite qu'on est dans un flux
  -- de retour : il doit toujours l'emporter.
  coalesce(c.id_livreur_retour, l.id_livreur, cmd.id_livreur_ramassage) as id_livreur,
  (public.montant_du(c.id_colis) <= 0) as paye,
  (cmd.mode_paiement = 'PAR_EXPEDITEUR' and public.montant_du(c.id_colis) <= 0) as paye_par_expediteur,
  cmd.id_hub_prevu,
  public.montant_du(c.id_colis) as montant_du
from public.colis c
join public.commandes cmd on cmd.id_commande = c.id_commande
left join public.lots_livraison l on l.id_lot = c.id_lot
where c.statut not in ('CREE','AU_HUB','A_RETOURNER','RETOUR_RECU','LIVRE','RETOURNE','ANNULE');

grant select on public.v_missions_livreur to authenticated;

-- ----------------------------------------------------------------------------
-- Un vehicule ne peut plus etre affecte qu'a un seul utilisateur actif a la
-- fois -- avant, rien n'empechait de l'affecter en double, y compris a un
-- livreur qui l'avait deja. Contrainte au niveau base (pas seulement cote
-- interface) : bloque quel que soit le chemin de code qui tenterait
-- l'affectation, aujourd'hui ou plus tard.
-- ----------------------------------------------------------------------------
-- ----------------------------------------------------------------------------
-- Nettoyage prealable : si un vehicule est deja affecte a plusieurs
-- utilisateurs actifs (exactement le bug corrige ici), la contrainte ne
-- peut pas se creer tant que ce doublon existe. On garde l'affectation
-- pour l'utilisateur le plus recemment modifie (cree_le en absence de
-- colonne de mise a jour dediee) et on retire le vehicule aux autres --
-- un choix par defaut raisonnable, mais VERIFIE APRES COUP qui a ete
-- desaffecte (requete juste en dessous) et reaffecte manuellement si ce
-- n'est pas le bon choix pour ton equipe.
-- ----------------------------------------------------------------------------
with doublons as (
  select id_utilisateur, id_vehicule,
         row_number() over (partition by id_vehicule order by cree_le desc) as rang
  from public.utilisateurs
  where id_vehicule is not null and actif
)
update public.utilisateurs u set id_vehicule = null
from doublons d
where u.id_utilisateur = d.id_utilisateur and d.rang > 1;

create unique index if not exists idx_utilisateurs_vehicule_unique
  on public.utilisateurs(id_vehicule) where id_vehicule is not null and actif;

commit;

select 'fix_39_ok' as status;
