-- ============================================================================
-- IKIGAI LIVRAISON V3 - INSTALLATION (base Supabase NEUVE)
-- ============================================================================
-- Principes :
--   1. Le COLIS est l'unique source de verite : un seul champ statut,
--      transitions declarees dans une table, appliquees par avancer_colis().
--   2. Les statuts de commande et de lot sont CALCULES (vues), jamais stockes.
--   3. Chaque transition est journalisee (evenements_colis) : historique,
--      tracabilite et performance deviennent de simples lectures.
--   4. Le front n'ecrit JAMAIS dans les tables : lecture via vues + RLS,
--      ecriture via RPC security definer exclusivement.
--   5. Multi-tenant : id_entreprise partout, tenant lu dans le JWT,
--      aucun tenant par defaut.
--   6. Paiements : module a part, couple au flux par un seul verrou
--      (VALIDER_LIVRAISON exige un paiement regle si la commande l'impose).
--   7. Toutes les vues sont creees avec security_invoker = true : sans ce
--      reglage, une vue Postgres s'execute par defaut avec les droits de son
--      PROPRIETAIRE (le role de migration), ce qui contourne silencieusement
--      la RLS des tables sous-jacentes pour quiconque interroge la vue.
--      Verifie empiriquement (fuite confirmee sans le reglage, close avec).
-- ============================================================================

begin;

-- ============================================================================
-- 1. TABLES
-- ============================================================================

create table if not exists public.entreprises (
  id_entreprise uuid primary key default gen_random_uuid(),
  code_entreprise text not null unique check (code_entreprise = upper(code_entreprise)),
  nom text not null,
  actif boolean not null default true,
  cree_le timestamptz not null default now()
);

create table if not exists public.vehicules (
  id_vehicule uuid primary key default gen_random_uuid(),
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  type text not null check (type in ('VELO','MOTO','TRICYCLE','VOITURE','CAMION','AUTRE')),
  immatriculation text,
  statut text not null default 'ACTIF' check (statut in ('ACTIF','EN_REPARATION','HORS_SERVICE')),
  charges_jour numeric(12,2) not null default 0,
  cree_le timestamptz not null default now()
);
create unique index if not exists uq_vehicule_immat
  on public.vehicules(id_entreprise, immatriculation) where immatriculation is not null;

-- id_utilisateur = auth.users.id, TOUJOURS. C'est l'invariant central.
create table if not exists public.utilisateurs (
  id_utilisateur uuid primary key,
  id_entreprise uuid references public.entreprises(id_entreprise),
  nom text not null,
  telephone text,
  email text,
  role text not null check (role in ('super_admin','admin','agent','livreur','expediteur','destinataire')),
  actif boolean not null default true,
  salaire_jour numeric(12,2) not null default 0,
  charges_jour numeric(12,2) not null default 0,
  id_vehicule uuid references public.vehicules(id_vehicule),
  photo_url text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists idx_utilisateurs_entreprise on public.utilisateurs(id_entreprise);

create table if not exists public.zones_tarification (
  id bigint generated always as identity primary key,
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  code_zone text not null,
  description text,
  montant numeric(12,2) not null,
  actif boolean not null default true,
  unique (id_entreprise, code_zone)
);

create table if not exists public.compteurs (
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  type text not null,
  valeur bigint not null default 0,
  primary key (id_entreprise, type)
);

create table if not exists public.commandes (
  id_commande text primary key,
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  canal_creation text not null default 'DIRECT' check (canal_creation in ('DIRECT','INTERNE')),
  cree_par uuid references public.utilisateurs(id_utilisateur),
  expediteur_nom text not null,
  expediteur_tel text not null,
  expediteur_adresse text,
  gps_expediteur jsonb,
  code_ramassage text not null,
  mode_paiement text not null default 'A_LA_LIVRAISON'
    check (mode_paiement in ('A_LA_LIVRAISON','PAR_EXPEDITEUR','SANS_PAIEMENT')),
  id_livreur_ramassage uuid references public.utilisateurs(id_utilisateur),
  cree_le timestamptz not null default now()
);
create index if not exists idx_commandes_entreprise on public.commandes(id_entreprise, cree_le desc);

create table if not exists public.lots_livraison (
  id_lot text primary key,
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  id_livreur uuid references public.utilisateurs(id_utilisateur),
  cree_par uuid references public.utilisateurs(id_utilisateur),
  note text,
  cree_le timestamptz not null default now()
);

create table if not exists public.colis (
  id_colis text primary key,
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  id_commande text not null references public.commandes(id_commande) on delete cascade,
  id_lot text references public.lots_livraison(id_lot),
  destinataire_nom text not null,
  destinataire_tel text not null,
  destinataire_adresse text,
  gps_destinataire jsonb,
  code_livraison text not null,
  code_zone text,
  montant_livraison numeric(12,2) not null default 0,
  statut text not null default 'CREE',
  motif_retour text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists idx_colis_commande on public.colis(id_commande);
create index if not exists idx_colis_lot on public.colis(id_lot);
create index if not exists idx_colis_statut on public.colis(id_entreprise, statut);

-- La machine a etats : source de verite declarative des transitions.
create table if not exists public.transitions_colis (
  statut_depart text not null,
  evenement text not null,
  statut_arrivee text not null,
  roles_autorises text[] not null,
  primary key (statut_depart, evenement)
);

-- Le journal : chaque transition, avec acteur, motif, details.
create table if not exists public.evenements_colis (
  id bigint generated always as identity primary key,
  id_entreprise uuid not null,
  id_colis text not null references public.colis(id_colis) on delete cascade,
  evenement text not null,
  statut_avant text,
  statut_apres text,
  acteur uuid,
  role_acteur text,
  motif text,
  details jsonb not null default '{}'::jsonb,
  cree_le timestamptz not null default now()
);
create index if not exists idx_evenements_colis on public.evenements_colis(id_colis, cree_le);
create index if not exists idx_evenements_acteur_jour
  on public.evenements_colis(id_entreprise, acteur, evenement, cree_le);

-- Les liens partages : un lien = une ligne. Renvoyer = relire. Revoquer = expirer.
create table if not exists public.liens_partage (
  token uuid primary key default gen_random_uuid(),
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  type text not null check (type in ('POSITION_EXPEDITEUR','POSITION_DESTINATAIRE','SUIVI')),
  id_commande text references public.commandes(id_commande) on delete cascade,
  id_colis text references public.colis(id_colis) on delete cascade,
  expire_le timestamptz,
  utilise_le timestamptz,
  revoque boolean not null default false,
  cree_le timestamptz not null default now()
);
create index if not exists idx_liens_commande on public.liens_partage(id_commande);
create index if not exists idx_liens_colis on public.liens_partage(id_colis);

-- Module paiement : cycle de vie independant, couple au flux par UN verrou.
create table if not exists public.paiements (
  id uuid primary key default gen_random_uuid(),
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  id_colis text not null references public.colis(id_colis) on delete cascade,
  payeur text not null default 'DESTINATAIRE' check (payeur in ('EXPEDITEUR','DESTINATAIRE')),
  methode text not null check (methode in ('ESPECES','WAVE','AUTRE')),
  montant numeric(12,2) not null check (montant >= 0),
  statut text not null default 'EN_ATTENTE'
    check (statut in ('EN_ATTENTE','INITIE','PAYE','ECHOUE','ANNULE')),
  reference_externe text,
  id_event_externe text unique,
  encaisse_par uuid references public.utilisateurs(id_utilisateur),
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists idx_paiements_colis on public.paiements(id_colis);
create index if not exists idx_paiements_caisse on public.paiements(id_entreprise, encaisse_par, methode, statut);

-- Caisse : versements des especes collectees par les livreurs, valides au hub.
create table if not exists public.versements_livreur (
  id uuid primary key default gen_random_uuid(),
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  id_livreur uuid not null references public.utilisateurs(id_utilisateur),
  montant numeric(12,2) not null check (montant > 0),
  valide_par uuid references public.utilisateurs(id_utilisateur),
  cree_le timestamptz not null default now()
);

-- ============================================================================
-- 2. MACHINE A ETATS : les transitions autorisees
-- ============================================================================
insert into public.transitions_colis (statut_depart, evenement, statut_arrivee, roles_autorises) values
  ('CREE',            'ASSIGNER_RAMASSAGE',        'A_RAMASSER',      '{agent}'),
  ('A_RAMASSER',      'VALIDER_RAMASSAGE',         'RAMASSE',         '{livreur}'),
  ('RAMASSE',         'DEMANDER_DEPOT',            'DEPOT_DEMANDE',   '{livreur}'),
  ('DEPOT_DEMANDE',   'VALIDER_DEPOT',             'AU_HUB',          '{agent}'),
  ('AU_HUB',          'METTRE_EN_LOT',             'EN_LOT',          '{agent}'),
  ('EN_LOT',          'RETIRER_DU_LOT',            'AU_HUB',          '{agent}'),
  ('EN_LOT',          'DEMANDER_RECUPERATION',     'RECUP_DEMANDEE',  '{livreur}'),
  ('RECUP_DEMANDEE',  'VALIDER_RECUPERATION',      'EN_TOURNEE',      '{agent}'),
  ('EN_TOURNEE',      'VALIDER_LIVRAISON',         'LIVRE',           '{livreur}'),
  ('EN_TOURNEE',      'SIGNALER_ECHEC',            'RETOUR_EN_COURS', '{livreur}'),
  ('RETOUR_EN_COURS', 'DEMANDER_RETOUR_HUB',       'RETOUR_DEMANDE',  '{livreur}'),
  ('RETOUR_DEMANDE',  'VALIDER_RETOUR_REPROGRAMMER','AU_HUB',         '{agent}'),
  ('RETOUR_DEMANDE',  'VALIDER_RETOUR_EXPEDITEUR', 'A_RETOURNER',     '{agent}'),
  ('A_RETOURNER',     'ASSIGNER_RETOUR',           'EN_RETOUR',       '{agent}'),
  ('EN_RETOUR',       'VALIDER_REMISE_EXPEDITEUR', 'RETOURNE',        '{livreur}'),
  ('CREE',            'ANNULER',                   'ANNULE',          '{agent}'),
  ('A_RAMASSER',      'ANNULER',                   'ANNULE',          '{agent}'),
  ('AU_HUB',          'ANNULER',                   'ANNULE',          '{agent}')
on conflict (statut_depart, evenement) do update
  set statut_arrivee = excluded.statut_arrivee, roles_autorises = excluded.roles_autorises;

-- ============================================================================
-- 3. FONCTIONS UTILITAIRES
-- ============================================================================

create or replace function public.jwt_role() returns text
language sql stable as $$
  select nullif(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', ''), '');
$$;

create or replace function public.jwt_entreprise_id() returns uuid
language sql stable as $$
  select nullif(coalesce(auth.jwt() -> 'app_metadata' ->> 'id_entreprise', ''), '')::uuid;
$$;

-- Acteur effectif : auth.uid() en priorite ; p_acteur n'est honore que hors
-- session (SQL Editor, tests, service_role) pour rester non falsifiable en API.
create or replace function public.acteur_effectif(p_acteur uuid default null) returns uuid
language sql stable as $$
  select coalesce(auth.uid(), p_acteur);
$$;

create or replace function public.profil_de(p_id uuid)
returns table (id_utilisateur uuid, id_entreprise uuid, role text, actif boolean)
language sql stable security definer set search_path = public as $$
  select u.id_utilisateur, u.id_entreprise, u.role, u.actif
  from public.utilisateurs u where u.id_utilisateur = p_id;
$$;

create or replace function public.entreprise_de(p_id uuid default auth.uid()) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    case when p_id = auth.uid() then public.jwt_entreprise_id() end,
    (select u.id_entreprise from public.utilisateurs u where u.id_utilisateur = p_id)
  );
$$;

create or replace function public.est_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.jwt_role() = 'super_admin'
      or exists (select 1 from public.utilisateurs u
                 where u.id_utilisateur = auth.uid() and u.role = 'super_admin' and u.actif);
$$;

create or replace function public.generer_id(p_entreprise uuid, p_type text, p_prefixe text)
returns text language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.compteurs (id_entreprise, type, valeur) values (p_entreprise, p_type, 1)
  on conflict (id_entreprise, type) do update set valeur = public.compteurs.valeur + 1
  returning valeur into v;
  return p_prefixe || '-' || lpad(v::text, 6, '0');
end;
$$;

create or replace function public.generer_code(p_longueur int default 6)
returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
    1 + floor(random() * 31)::int, 1), '') from generate_series(1, p_longueur);
$$;

create or replace function public.maj_horodatage() returns trigger
language plpgsql as $$
begin new.maj_le := now(); return new; end;
$$;
drop trigger if exists trg_maj_colis on public.colis;
create trigger trg_maj_colis before update on public.colis
for each row execute function public.maj_horodatage();
drop trigger if exists trg_maj_paiements on public.paiements;
create trigger trg_maj_paiements before update on public.paiements
for each row execute function public.maj_horodatage();

-- Synchronisation utilisateurs -> JWT (app_metadata), comme en V2 fix 14.
create or replace function public.sync_app_metadata() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', new.role, 'id_entreprise', new.id_entreprise::text)
    where id = new.id_utilisateur;
  exception when undefined_table or insufficient_privilege then null;
  end;
  return new;
end;
$$;
drop trigger if exists trg_sync_jwt on public.utilisateurs;
create trigger trg_sync_jwt after insert or update of role, id_entreprise on public.utilisateurs
for each row execute function public.sync_app_metadata();

-- Anti-escalade : role, entreprise et remuneration proteges.
create or replace function public.proteger_privileges() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_claims text := current_setting('request.jwt.claims', true);
begin
  if new.role is not distinct from old.role
     and new.id_entreprise is not distinct from old.id_entreprise
     and new.salaire_jour is not distinct from old.salaire_jour
     and new.charges_jour is not distinct from old.charges_jour then
    return new;
  end if;
  if v_claims is null or v_claims = '' then return new; end if;
  if coalesce(v_claims::jsonb ->> 'role', '') = 'service_role' then return new; end if;
  if public.est_super_admin() then return new; end if;
  if exists (select 1 from public.utilisateurs u
             where u.id_utilisateur = auth.uid() and u.role in ('admin','agent') and u.actif
               and u.id_entreprise = old.id_entreprise) then
    return new;
  end if;
  raise exception 'Modification refusee : droits insuffisants.';
end;
$$;
drop trigger if exists trg_privileges on public.utilisateurs;
create trigger trg_privileges before update on public.utilisateurs
for each row execute function public.proteger_privileges();

-- ============================================================================
-- 4. LE COEUR : avancer_colis()
-- ============================================================================
-- Unique porte d'ecriture du flux metier. Verifie la transition, le role,
-- les conditions specifiques (codes, assignation de lot, verrou paiement),
-- applique le nouveau statut et journalise.

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
begin
  select * into v_profil from public.profil_de(v_acteur);
  if v_profil.id_utilisateur is null or not v_profil.actif then
    raise exception 'Acteur inconnu ou inactif.';
  end if;

  select * into v_colis from public.colis c where c.id_colis = p_id_colis for update;
  if v_colis.id_colis is null then
    raise exception 'Colis introuvable.';
  end if;

  -- Isolation multi-tenant stricte (le super_admin peut tout voir mais pas
  -- operer le terrain d'une autre entreprise sans y avoir un profil).
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

  if p_evenement = 'VALIDER_LIVRAISON' then
    if upper(coalesce(p_code, '')) <> upper(v_colis.code_livraison) then
      raise exception 'Code livraison incorrect.';
    end if;
    -- LE verrou paiement : seul point de couplage flux <-> paiements.
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
    if upper(coalesce(p_code, '')) <> upper(v_commande.code_ramassage) then
      raise exception 'Code ramassage (preuve expediteur) incorrect.';
    end if;
  end if;

  if p_evenement in ('METTRE_EN_LOT','RETIRER_DU_LOT','ASSIGNER_RETOUR')
     and p_evenement = 'RETIRER_DU_LOT' then
    null; -- le detachement du lot est fait ci-dessous
  end if;

  -- Application ----------------------------------------------------------------
  update public.colis c set
    statut = v_transition.statut_arrivee,
    motif_retour = case when p_evenement = 'SIGNALER_ECHEC' then p_motif else c.motif_retour end,
    id_lot = case when p_evenement = 'RETIRER_DU_LOT' then null else c.id_lot end
  where c.id_colis = p_id_colis;

  insert into public.evenements_colis
    (id_entreprise, id_colis, evenement, statut_avant, statut_apres, acteur, role_acteur, motif, details)
  values
    (v_colis.id_entreprise, p_id_colis, p_evenement, v_colis.statut,
     v_transition.statut_arrivee, v_acteur, v_profil.role, p_motif, coalesce(p_details, '{}'::jsonb));

  return query select p_id_colis, v_transition.statut_arrivee;
end;
$$;

-- ============================================================================
-- 5. RPC METIER (le front n'appelle QUE ces fonctions pour ecrire)
-- ============================================================================

-- 5.1 Creation de commande : formulaire UNIQUE, canal DIRECT ou INTERNE.
create or replace function public.rpc_creer_commande(
  p_code_entreprise text,
  p_expediteur_nom text,
  p_expediteur_tel text,
  p_expediteur_adresse text,
  p_gps_expediteur jsonb,
  p_mode_paiement text,
  p_colis jsonb,               -- [{destinataire_nom, destinataire_tel, destinataire_adresse, code_zone}]
  p_canal text default 'DIRECT',
  p_acteur uuid default null
) returns table (id_commande text, code_ramassage text, token_expediteur uuid,
                 id_colis text, code_livraison text, token_destinataire uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_entreprise uuid;
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_id_commande text;
  v_code_ramassage text := public.generer_code();
  v_token_exp uuid;
  v_item jsonb;
  v_id_colis text;
  v_code_livraison text;
  v_montant numeric;
  v_token_dest uuid;
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
  end if;

  if jsonb_array_length(coalesce(p_colis, '[]'::jsonb)) = 0 then
    raise exception 'Au moins un colis est requis.';
  end if;

  v_id_commande := public.generer_id(v_entreprise, 'commande', 'CMD');

  insert into public.commandes
    (id_commande, id_entreprise, canal_creation, cree_par, expediteur_nom, expediteur_tel,
     expediteur_adresse, gps_expediteur, code_ramassage, mode_paiement)
  values
    (v_id_commande, v_entreprise, p_canal,
     case when p_canal = 'INTERNE' then v_acteur else null end,
     trim(p_expediteur_nom), trim(p_expediteur_tel), p_expediteur_adresse,
     p_gps_expediteur, v_code_ramassage,
     coalesce(nullif(p_mode_paiement, ''), 'A_LA_LIVRAISON'));

  insert into public.liens_partage (id_entreprise, type, id_commande)
  values (v_entreprise, 'POSITION_EXPEDITEUR', v_id_commande)
  returning token into v_token_exp;

  for v_item in select * from jsonb_array_elements(p_colis) loop
    v_id_colis := public.generer_id(v_entreprise, 'colis', 'COL');
    v_code_livraison := public.generer_code();
    select z.montant into v_montant from public.zones_tarification z
    where z.id_entreprise = v_entreprise
      and z.code_zone = upper(coalesce(v_item->>'code_zone', '')) and z.actif;

    insert into public.colis
      (id_colis, id_entreprise, id_commande, destinataire_nom, destinataire_tel,
       destinataire_adresse, code_livraison, code_zone, montant_livraison)
    values
      (v_id_colis, v_entreprise, v_id_commande,
       trim(v_item->>'destinataire_nom'), trim(v_item->>'destinataire_tel'),
       v_item->>'destinataire_adresse', v_code_livraison,
       upper(coalesce(v_item->>'code_zone', '')), coalesce(v_montant, 0));

    insert into public.evenements_colis
      (id_entreprise, id_colis, evenement, statut_avant, statut_apres, acteur, role_acteur)
    values (v_entreprise, v_id_colis, 'CREATION', null, 'CREE', v_acteur, p_canal);

    insert into public.liens_partage (id_entreprise, type, id_colis)
    values (v_entreprise, 'POSITION_DESTINATAIRE', v_id_colis)
    returning token into v_token_dest;

    id_commande := v_id_commande; code_ramassage := v_code_ramassage;
    token_expediteur := v_token_exp; id_colis := v_id_colis;
    code_livraison := v_code_livraison; token_destinataire := v_token_dest;
    return next;
  end loop;
end;
$$;

-- 5.2 Assignation du ramassage (niveau commande, propage aux colis CREE).
create or replace function public.rpc_assigner_ramassage(
  p_id_commande text, p_id_livreur uuid, p_acteur uuid default null
) returns setof text
language plpgsql security definer set search_path = public as $$
declare v_c record; r record;
begin
  update public.commandes set id_livreur_ramassage = p_id_livreur
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

-- 5.3 Validation groupee du ramassage par code (tous les colis de la commande).
create or replace function public.rpc_valider_ramassage(
  p_id_commande text, p_code text, p_acteur uuid default null
) returns setof text
language plpgsql security definer set search_path = public as $$
declare v_c record; r record;
begin
  for v_c in select c.id_colis from public.colis c
             where c.id_commande = p_id_commande and c.statut = 'A_RAMASSER' loop
    for r in select * from public.avancer_colis(v_c.id_colis, 'VALIDER_RAMASSAGE',
                        p_code, null, '{}'::jsonb, p_acteur) loop
      return next r.id_colis;
    end loop;
  end loop;
  if not found then raise exception 'Aucun colis a ramasser sur cette commande.'; end if;
end;
$$;

-- 5.4 Lots : creation, modification (tant que non fige), assignation.
create or replace function public.lot_est_fige(p_id_lot text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.colis c where c.id_lot = p_id_lot
                 and c.statut not in ('EN_LOT'));
$$;

create or replace function public.rpc_creer_lot(
  p_colis text[], p_note text default null, p_acteur uuid default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_entreprise uuid := public.entreprise_de(v_acteur);
  v_id_lot text;
  v_id text;
begin
  if array_length(p_colis, 1) is null then raise exception 'Lot vide.'; end if;
  v_id_lot := public.generer_id(v_entreprise, 'lot', 'LOT');
  insert into public.lots_livraison (id_lot, id_entreprise, cree_par, note)
  values (v_id_lot, v_entreprise, v_acteur, p_note);
  foreach v_id in array p_colis loop
    update public.colis set id_lot = v_id_lot where id_colis = v_id;
    perform public.avancer_colis(v_id, 'METTRE_EN_LOT', null, null,
      jsonb_build_object('id_lot', v_id_lot), p_acteur);
  end loop;
  return v_id_lot;
end;
$$;

create or replace function public.rpc_modifier_lot(
  p_id_lot text, p_ajouter text[] default '{}', p_retirer text[] default '{}',
  p_acteur uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if public.lot_est_fige(p_id_lot) then
    raise exception 'Lot fige : une recuperation a deja demarre.';
  end if;
  foreach v_id in array coalesce(p_retirer, '{}') loop
    perform public.avancer_colis(v_id, 'RETIRER_DU_LOT', null, null, '{}'::jsonb, p_acteur);
  end loop;
  foreach v_id in array coalesce(p_ajouter, '{}') loop
    update public.colis set id_lot = p_id_lot where id_colis = v_id;
    perform public.avancer_colis(v_id, 'METTRE_EN_LOT', null, null,
      jsonb_build_object('id_lot', p_id_lot), p_acteur);
  end loop;
end;
$$;

create or replace function public.rpc_assigner_lot(
  p_id_lot text, p_id_livreur uuid, p_acteur uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_acteur uuid := public.acteur_effectif(p_acteur); v_c record;
begin
  update public.lots_livraison set id_livreur = p_id_livreur where id_lot = p_id_lot;
  for v_c in select c.id_colis, c.id_entreprise, c.statut from public.colis c
             where c.id_lot = p_id_lot loop
    insert into public.evenements_colis
      (id_entreprise, id_colis, evenement, statut_avant, statut_apres, acteur, role_acteur, details)
    values (v_c.id_entreprise, v_c.id_colis, 'ASSIGNER_LOT', v_c.statut, v_c.statut,
            v_acteur, 'agent', jsonb_build_object('id_livreur', p_id_livreur));
  end loop;
end;
$$;

-- 5.5 Retour : assignation du livreur de retour (reutilise le circuit livraison).
create or replace function public.rpc_assigner_retour(
  p_id_colis text, p_id_livreur uuid, p_acteur uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.avancer_colis(p_id_colis, 'ASSIGNER_RETOUR', null, null,
    jsonb_build_object('id_livreur', p_id_livreur), p_acteur);
  -- Le livreur du retour est memorise dans le journal ; pour la lecture on
  -- le pose aussi sur le colis via details -> vue. Simple : commandes n'est pas
  -- touche, le lot n'existe pas pour un retour unitaire.
end;
$$;

-- 5.6 Paiements.
create or replace function public.rpc_encaisser_especes(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis record; v_id uuid;
begin
  select * into v_colis from public.colis where id_colis = p_id_colis;
  if v_colis.id_colis is null then raise exception 'Colis introuvable.'; end if;
  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut, encaisse_par)
  values (v_colis.id_entreprise, p_id_colis, 'DESTINATAIRE', 'ESPECES',
          v_colis.montant_livraison, 'PAYE', v_acteur)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rpc_initier_paiement_wave(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_colis record; v_id uuid;
begin
  select * into v_colis from public.colis where id_colis = p_id_colis;
  if v_colis.id_colis is null then raise exception 'Colis introuvable.'; end if;
  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut)
  values (v_colis.id_entreprise, p_id_colis, 'DESTINATAIRE', 'WAVE',
          v_colis.montant_livraison, 'INITIE')
  returning id into v_id;
  -- La fonction Edge cree la session Wave avec cet id en reference client,
  -- stocke reference_externe, et le webhook confirmera via rpc_confirmer_paiement.
  return v_id;
end;
$$;

-- Appelee UNIQUEMENT par la fonction Edge webhook (service_role). Idempotente.
create or replace function public.rpc_confirmer_paiement(
  p_id_paiement uuid, p_reference_externe text, p_id_event_externe text, p_succes boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.paiements where id_event_externe = p_id_event_externe) then
    return; -- webhook deja traite (idempotence)
  end if;
  update public.paiements set
    statut = case when p_succes then 'PAYE' else 'ECHOUE' end,
    reference_externe = p_reference_externe,
    id_event_externe = p_id_event_externe
  where id = p_id_paiement and statut in ('EN_ATTENTE','INITIE');
end;
$$;

create or replace function public.rpc_verser_caisse(
  p_montant numeric, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_entreprise uuid := public.entreprise_de(v_acteur);
  v_id uuid;
begin
  insert into public.versements_livreur (id_entreprise, id_livreur, montant)
  values (v_entreprise, v_acteur, p_montant) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rpc_valider_versement(
  p_id uuid, p_acteur uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.versements_livreur set valide_par = public.acteur_effectif(p_acteur)
  where id = p_id and valide_par is null;
end;
$$;

-- 5.7 Liens publics (pages expediteur / destinataire, acces par token).
create or replace function public.rpc_lire_lien(p_token uuid)
returns table (type text, id_commande text, id_colis text,
               expediteur_nom text, destinataire_nom text, gps jsonb)
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  select l.*, cmd.expediteur_nom as exp_nom, cmd.gps_expediteur,
         co.destinataire_nom as dest_nom, co.gps_destinataire
  into v
  from public.liens_partage l
  left join public.commandes cmd on cmd.id_commande = l.id_commande
  left join public.colis co on co.id_colis = l.id_colis
  where l.token = p_token and not l.revoque
    and (l.expire_le is null or l.expire_le > now());
  if v.token is null then raise exception 'Lien invalide ou expire.'; end if;
  return query select v.type, v.id_commande, v.id_colis,
    v.exp_nom, v.dest_nom,
    coalesce(v.gps_expediteur, v.gps_destinataire);
end;
$$;

create or replace function public.rpc_enregistrer_position(
  p_token uuid, p_lat double precision, p_lng double precision
) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from public.liens_partage
  where token = p_token and not revoque
    and (expire_le is null or expire_le > now());
  if v.token is null then raise exception 'Lien invalide ou expire.'; end if;
  if v.type = 'POSITION_EXPEDITEUR' then
    update public.commandes set gps_expediteur = jsonb_build_object('lat', p_lat, 'lng', p_lng)
    where id_commande = v.id_commande;
  elsif v.type = 'POSITION_DESTINATAIRE' then
    update public.colis set gps_destinataire = jsonb_build_object('lat', p_lat, 'lng', p_lng)
    where id_colis = v.id_colis;
  end if;
  update public.liens_partage set utilise_le = now() where token = p_token;
end;
$$;

-- ============================================================================
-- 6. VUES (le front ne lit QUE des vues)
-- ============================================================================

-- Statut de commande CALCULE depuis les colis : plus jamais de desynchronisation.
create or replace view public.v_statut_commande
with (security_invoker = true) as
select
  cmd.id_commande, cmd.id_entreprise,
  case
    when bool_and(c.statut in ('LIVRE','RETOURNE','ANNULE')) then 'TERMINEE'
    when bool_and(c.statut = 'CREE') then 'EN_ATTENTE'
    when bool_and(c.statut in ('CREE','A_RAMASSER')) then 'RAMASSAGE_EN_COURS'
    when bool_and(c.statut in ('RAMASSE','DEPOT_DEMANDE','CREE','A_RAMASSER')) then 'RAMASSEE'
    else 'EN_TRAITEMENT'
  end as statut,
  count(*) as nb_colis,
  count(*) filter (where c.statut = 'LIVRE') as nb_livres,
  count(*) filter (where c.statut = 'RETOURNE') as nb_retournes
from public.commandes cmd
join public.colis c on c.id_commande = cmd.id_commande
group by cmd.id_commande, cmd.id_entreprise;

create or replace view public.v_statut_lot
with (security_invoker = true) as
select
  l.id_lot, l.id_entreprise, l.id_livreur,
  case
    when bool_and(c.statut in ('LIVRE','RETOURNE')) then 'TERMINE'
    when bool_or(c.statut = 'EN_TOURNEE') then 'EN_TOURNEE'
    when bool_or(c.statut = 'RECUP_DEMANDEE') then 'RECUPERATION'
    else 'PREPARE'
  end as statut,
  public.lot_est_fige(l.id_lot) as fige,
  count(*) as nb_colis
from public.lots_livraison l
join public.colis c on c.id_lot = l.id_lot
group by l.id_lot, l.id_entreprise, l.id_livreur;

-- Missions du livreur : ses 3 onglets (a ramasser / a deposer / a livrer).
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
    when c.statut in ('EN_LOT','RECUP_DEMANDEE','EN_TOURNEE','EN_RETOUR') then 'A_LIVRER'
  end as onglet,
  coalesce(l.id_livreur, cmd.id_livreur_ramassage) as id_livreur,
  exists (select 1 from public.paiements p
          where p.id_colis = c.id_colis and p.statut = 'PAYE') as paye
from public.colis c
join public.commandes cmd on cmd.id_commande = c.id_commande
left join public.lots_livraison l on l.id_lot = c.id_lot
where c.statut not in ('CREE','AU_HUB','A_RETOURNER','LIVRE','RETOURNE','ANNULE');

-- Performance : lecture pure du journal. Les deux "types" de livreurs sont
-- mesures par l'activite, pas par une etiquette.
create or replace view public.v_performance_livreur_jour
with (security_invoker = true) as
with activite as (
  select
    e.id_entreprise, e.acteur as id_livreur, e.cree_le::date as jour,
    count(*) filter (where e.evenement = 'VALIDER_RAMASSAGE') as nb_ramassages,
    count(*) filter (where e.evenement = 'VALIDER_LIVRAISON') as nb_livraisons,
    coalesce(sum(c.montant_livraison) filter (where e.evenement = 'VALIDER_LIVRAISON'), 0) as ca_livre
  from public.evenements_colis e
  join public.colis c on c.id_colis = e.id_colis
  where e.evenement in ('VALIDER_RAMASSAGE','VALIDER_LIVRAISON')
  group by e.id_entreprise, e.acteur, e.cree_le::date
)
select
  a.id_entreprise, a.id_livreur, u.nom, a.jour,
  a.nb_ramassages, a.nb_livraisons, a.ca_livre,
  u.salaire_jour, u.charges_jour as charges_livreur,
  coalesce(v.charges_jour, 0) as charges_vehicule,
  v.type as type_vehicule,
  a.ca_livre - u.salaire_jour - u.charges_jour - coalesce(v.charges_jour, 0) as marge_jour
from activite a
join public.utilisateurs u on u.id_utilisateur = a.id_livreur
left join public.vehicules v on v.id_vehicule = u.id_vehicule;

create or replace view public.v_performance_entreprise_jour
with (security_invoker = true) as
select id_entreprise, jour,
  sum(nb_ramassages) as ramassages, sum(nb_livraisons) as livraisons,
  sum(ca_livre) as ca, sum(salaire_jour + charges_livreur + charges_vehicule) as charges,
  sum(marge_jour) as marge
from public.v_performance_livreur_jour
group by id_entreprise, jour;

-- Caisse : solde especes de chaque livreur.
create or replace view public.v_caisse_livreur
with (security_invoker = true) as
select
  u.id_entreprise, u.id_utilisateur as id_livreur, u.nom,
  coalesce((select sum(p.montant) from public.paiements p
            where p.encaisse_par = u.id_utilisateur and p.methode = 'ESPECES' and p.statut = 'PAYE'), 0)
  - coalesce((select sum(vl.montant) from public.versements_livreur vl
              where vl.id_livreur = u.id_utilisateur and vl.valide_par is not null), 0)
  as solde_especes
from public.utilisateurs u
where u.role = 'livreur' and u.actif;

-- ============================================================================
-- 7. RLS : lecture par tenant, ecriture verrouillee (RPC uniquement)
-- ============================================================================

alter table public.entreprises enable row level security;
alter table public.utilisateurs enable row level security;
alter table public.vehicules enable row level security;
alter table public.zones_tarification enable row level security;
alter table public.commandes enable row level security;
alter table public.colis enable row level security;
alter table public.lots_livraison enable row level security;
alter table public.evenements_colis enable row level security;
alter table public.liens_partage enable row level security;
alter table public.paiements enable row level security;
alter table public.versements_livreur enable row level security;
alter table public.compteurs enable row level security;
alter table public.transitions_colis enable row level security;

-- Lecture : sa propre entreprise (super_admin : tout).
create policy sel_entreprises on public.entreprises for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy sel_utilisateurs on public.utilisateurs for select using (
  id_utilisateur = auth.uid() or id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy sel_vehicules on public.vehicules for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy sel_zones on public.zones_tarification for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy sel_commandes on public.commandes for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy sel_colis on public.colis for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy sel_lots on public.lots_livraison for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy sel_evenements on public.evenements_colis for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy sel_liens on public.liens_partage for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy sel_paiements on public.paiements for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy sel_versements on public.versements_livreur for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy sel_transitions on public.transitions_colis for select using (true);

-- Ecritures directes autorisees UNIQUEMENT pour l'administration courante
-- (vehicules, zones, fiches utilisateurs) ; tout le flux metier passe par RPC.
create policy ins_vehicules on public.vehicules for insert with check (
  id_entreprise = public.entreprise_de() and public.jwt_role() in ('agent','admin')
  or public.est_super_admin());
create policy upd_vehicules on public.vehicules for update using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy ins_zones on public.zones_tarification for insert with check (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy upd_zones on public.zones_tarification for update using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy ins_utilisateurs_self on public.utilisateurs for insert with check (
  (id_utilisateur = auth.uid() or auth.uid() is null)
  and role in ('expediteur','destinataire'));
create policy upd_utilisateurs on public.utilisateurs for update using (
  id_utilisateur = auth.uid() or id_entreprise = public.entreprise_de() or public.est_super_admin())
with check (
  id_utilisateur = auth.uid() or id_entreprise = public.entreprise_de() or public.est_super_admin());

-- ============================================================================
-- 8. DROITS D'EXECUTION
-- ============================================================================
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update on public.vehicules, public.zones_tarification to authenticated;
grant insert, update on public.utilisateurs to authenticated, anon;
grant select on public.v_statut_commande, public.v_statut_lot, public.v_missions_livreur,
  public.v_performance_livreur_jour, public.v_performance_entreprise_jour,
  public.v_caisse_livreur to authenticated;

-- RPC publiques (pages sans compte)
grant execute on function public.rpc_creer_commande to anon, authenticated;
grant execute on function public.rpc_lire_lien to anon, authenticated;
grant execute on function public.rpc_enregistrer_position to anon, authenticated;

-- RPC internes (utilisateurs connectes ; les roles sont verifies DANS les fonctions)
grant execute on function public.avancer_colis to authenticated;
grant execute on function public.rpc_assigner_ramassage to authenticated;
grant execute on function public.rpc_valider_ramassage to authenticated;
grant execute on function public.rpc_creer_lot to authenticated;
grant execute on function public.rpc_modifier_lot to authenticated;
grant execute on function public.rpc_assigner_lot to authenticated;
grant execute on function public.rpc_assigner_retour to authenticated;
grant execute on function public.rpc_encaisser_especes to authenticated;
grant execute on function public.rpc_initier_paiement_wave to authenticated;
grant execute on function public.rpc_verser_caisse to authenticated;
grant execute on function public.rpc_valider_versement to authenticated;

-- Webhook : service_role uniquement (jamais expose au navigateur).
revoke execute on function public.rpc_confirmer_paiement from anon, authenticated;

commit;

select 'install_v3_ok' as status,
  (select count(*) from public.transitions_colis) as transitions;
