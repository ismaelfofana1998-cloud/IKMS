-- ============================================================================
-- 23 - Paiements retour + ramassage, comptes clients pro
-- A executer apres 22_securite_retours_et_recuperation.sql.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) rpc_encaisser_especes_retour : durci (role/assignation + anti-doublon).
--    Investigue suite a un signalement de bug -- le chemin heureux testait
--    correctement de bout en bout, mais deux garde-fous presents sur le
--    paiement normal manquaient ici : verification que l'acteur est bien le
--    livreur ASSIGNE a ce retour (comme verifier_livreur_assigne_colis pour
--    la livraison normale), et protection contre un double encaissement.
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
  if exists (select 1 from public.paiements p
             where p.id_colis = p_id_colis and p.statut = 'PAYE' and p.payeur = 'EXPEDITEUR') then
    raise exception 'Ce retour est deja marque paye.';
  end if;
  return v_colis;
end;
$$;

create or replace function public.rpc_encaisser_especes_retour(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis public.colis; v_id uuid;
begin
  v_colis := public.verifier_livreur_assigne_retour(p_id_colis, v_acteur);
  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut, encaisse_par)
  values (v_colis.id_entreprise, p_id_colis, 'EXPEDITEUR', 'ESPECES',
          v_colis.montant_livraison, 'PAYE', v_acteur)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.rpc_encaisser_especes_retour to authenticated;

-- Wave pour les retours : meme principe que rpc_initier_paiement_wave, mais
-- payeur EXPEDITEUR et reserve a un retour en cours assigne au bon livreur.
create or replace function public.rpc_initier_paiement_wave_retour(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis public.colis; v_id uuid;
begin
  v_colis := public.verifier_livreur_assigne_retour(p_id_colis, v_acteur);
  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut)
  values (v_colis.id_entreprise, p_id_colis, 'EXPEDITEUR', 'WAVE', v_colis.montant_livraison, 'INITIE')
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.rpc_initier_paiement_wave_retour to authenticated;

-- ----------------------------------------------------------------------------
-- 2) Paiement PAR_EXPEDITEUR reellement collecte, au ramassage.
--    Avant, "PAR_EXPEDITEUR" n'etait qu'une etiquette : rien ne collectait
--    jamais reellement d'argent nulle part pour ce mode. Desormais, le
--    ramassage lui-meme (VALIDER_RAMASSAGE) exige un paiement EXPEDITEUR
--    prealable quand ce mode est choisi -- espèces ou Wave, comme pour une
--    livraison normale.
-- ----------------------------------------------------------------------------
create or replace function public.rpc_encaisser_especes_ramassage(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis public.colis; v_commande record; v_id uuid;
  v_profil record;
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
  if exists (select 1 from public.paiements p
             where p.id_colis = p_id_colis and p.statut = 'PAYE' and p.payeur = 'EXPEDITEUR') then
    raise exception 'Ce colis est deja marque paye par l''expediteur.';
  end if;
  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut, encaisse_par)
  values (v_colis.id_entreprise, p_id_colis, 'EXPEDITEUR', 'ESPECES',
          v_colis.montant_livraison, 'PAYE', v_acteur)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.rpc_encaisser_especes_ramassage to authenticated;

create or replace function public.rpc_initier_paiement_wave_ramassage(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis public.colis; v_commande record; v_id uuid;
  v_profil record;
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
  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut)
  values (v_colis.id_entreprise, p_id_colis, 'EXPEDITEUR', 'WAVE', v_colis.montant_livraison, 'INITIE')
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.rpc_initier_paiement_wave_ramassage to authenticated;

-- VALIDER_RAMASSAGE exige desormais le paiement expediteur prealable quand
-- le mode choisi est PAR_EXPEDITEUR (espèces ou Wave, peu importe : on ne
-- verifie que le statut PAYE, pas la methode).
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
    -- NOUVEAU : mode PAR_EXPEDITEUR desormais reellement collecte, au
    -- ramassage (avant : simple etiquette, jamais facture nulle part).
    if v_commande.mode_paiement = 'PAR_EXPEDITEUR'
       and not exists (select 1 from public.paiements p
                       where p.id_colis = v_colis.id_colis and p.statut = 'PAYE'
                         and p.payeur = 'EXPEDITEUR') then
      raise exception 'Paiement (expediteur) requis avant de valider le ramassage.';
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

-- ----------------------------------------------------------------------------
-- 3) Comptes clients pro (de l'entreprise cliente du SaaS, pas des entreprises
--    du SaaS elles-memes) : un client recurrent d'IKIGAI Livraison (par
--    exemple) peut avoir un compte, un portefeuille, et etre facture au lieu
--    de payer a chaque commande.
-- ----------------------------------------------------------------------------
create table if not exists public.clients_pro (
  id_client uuid primary key default gen_random_uuid(),
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  nom text not null,
  telephone text not null,
  email text,
  adresse text,
  solde_portefeuille numeric(12,2) not null default 0,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  unique (id_entreprise, telephone)
);
create index if not exists idx_clients_pro_entreprise on public.clients_pro(id_entreprise);

alter table public.commandes add column if not exists id_client_pro uuid references public.clients_pro(id_client);

create table if not exists public.mouvements_portefeuille (
  id bigint generated always as identity primary key,
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  id_client uuid not null references public.clients_pro(id_client),
  type text not null check (type in ('CREDIT','DEBIT_COMMANDE','REGLEMENT_FACTURE')),
  montant numeric(12,2) not null,
  id_commande text references public.commandes(id_commande),
  note text,
  cree_le timestamptz not null default now(),
  cree_par uuid references public.utilisateurs(id_utilisateur)
);
create index if not exists idx_mouvements_client on public.mouvements_portefeuille(id_client);

alter table public.clients_pro enable row level security;
alter table public.mouvements_portefeuille enable row level security;

create policy sel_clients_pro on public.clients_pro for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy ins_clients_pro on public.clients_pro for insert with check (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy upd_clients_pro on public.clients_pro for update using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());

create policy sel_mouvements_portefeuille on public.mouvements_portefeuille for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());

grant select, insert, update on public.clients_pro to authenticated;
grant select on public.mouvements_portefeuille to authenticated;

-- Debite le portefeuille du client pro a chaque commande qui lui est
-- rattachee (facturation differee : la commande elle-meme n'exige alors pas
-- de paiement immediat -- mode SANS_PAIEMENT recommande pour ces commandes,
-- le montant est trace ici pour la facturation).
create or replace function public.rpc_debiter_client_commande(
  p_id_client uuid, p_id_commande text, p_montant numeric, p_acteur uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_acteur uuid := public.acteur_effectif(p_acteur); v_entreprise uuid;
begin
  select id_entreprise into v_entreprise from public.clients_pro where id_client = p_id_client;
  if v_entreprise is null then raise exception 'Client introuvable.'; end if;
  update public.clients_pro set solde_portefeuille = solde_portefeuille - p_montant where id_client = p_id_client;
  insert into public.mouvements_portefeuille (id_entreprise, id_client, type, montant, id_commande, cree_par)
  values (v_entreprise, p_id_client, 'DEBIT_COMMANDE', -p_montant, p_id_commande, v_acteur);
end;
$$;
grant execute on function public.rpc_debiter_client_commande to authenticated;

-- Credite le portefeuille (reglement d'une facture, ou avance).
create or replace function public.rpc_crediter_client(
  p_id_client uuid, p_montant numeric, p_note text default null, p_acteur uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_acteur uuid := public.acteur_effectif(p_acteur); v_entreprise uuid;
begin
  select id_entreprise into v_entreprise from public.clients_pro where id_client = p_id_client;
  if v_entreprise is null then raise exception 'Client introuvable.'; end if;
  update public.clients_pro set solde_portefeuille = solde_portefeuille + p_montant where id_client = p_id_client;
  insert into public.mouvements_portefeuille (id_entreprise, id_client, type, montant, note, cree_par)
  values (v_entreprise, p_id_client, 'REGLEMENT_FACTURE', p_montant, p_note, v_acteur);
end;
$$;
grant execute on function public.rpc_crediter_client to authenticated;

commit;

select 'fix_23_ok' as status;
