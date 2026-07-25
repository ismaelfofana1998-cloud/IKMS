-- ============================================================================
-- 17 - Tarification par paire de zones (depart -> arrivee) + zone obligatoire
-- A executer apres 16_phase4_securiser_paiements_et_publics.sql.
-- ============================================================================
--
-- PROBLEMES CORRIGES (retour terrain) :
--
--  1) "La selection de la zone tarifaire n'est pas imposee (j'ai reussi a
--     saisir une commande sans zone)." -> zones_tarification.montant valait
--     alors 0 en silence (aucune contrainte ne l'empechait). rpc_creer_commande
--     rejette desormais tout colis dont la zone n'est pas une zone active
--     connue de l'entreprise. Cote front, le champ passe aussi en <select
--     required> (voir expediteur.js / commande.js).
--
--  2) Tarification par paire de zones plutot qu'un tarif fixe par zone
--     d'arrivee seule. Nouvelle table zones_tarifs_paires : une ligne par
--     paire (zone_a, zone_b) ou zone_a <= zone_b alphabetiquement, donc
--     zone1->zone2 et zone2->zone1 partagent la MEME ligne (comme demande).
--     C'est une table minuscule (quelques dizaines a quelques centaines de
--     lignes meme pour une grande ville decoupee finement) : le cout de
--     stockage/lecture est negligeable, largement dans le palier gratuit
--     Supabase. Compatibilite ascendante : si aucune paire n'est definie
--     pour un couple de zones, on retombe sur l'ancien tarif fixe par zone
--     d'arrivee (zones_tarification.montant), donc rien ne casse pour les
--     entreprises qui n'auront pas encore configure de paires.
-- ============================================================================

begin;

create table if not exists public.zones_tarifs_paires (
  id bigint generated always as identity primary key,
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  zone_a text not null,
  zone_b text not null,
  montant numeric(12,2) not null,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  constraint zones_paires_ordre check (zone_a <= zone_b),
  unique (id_entreprise, zone_a, zone_b)
);
create index if not exists idx_zones_paires_entreprise on public.zones_tarifs_paires(id_entreprise);

alter table public.zones_tarifs_paires enable row level security;

create policy sel_zones_paires on public.zones_tarifs_paires for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy ins_zones_paires on public.zones_tarifs_paires for insert with check (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy upd_zones_paires on public.zones_tarifs_paires for update using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());

grant select on public.zones_tarifs_paires to authenticated;
grant insert, update on public.zones_tarifs_paires to authenticated;

-- ---------------------------------------------------------------------------
-- tarif_zone_zone : calcule le montant a facturer pour une livraison entre
-- une zone de depart et une zone d'arrivee. Cherche d'abord la paire
-- specifique (symetrique), sinon retombe sur l'ancien tarif fixe par zone
-- d'arrivee, sinon 0.
-- ---------------------------------------------------------------------------
create or replace function public.tarif_zone_zone(
  p_entreprise uuid, p_zone_depart text, p_zone_arrivee text
) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.montant from public.zones_tarifs_paires p
     where p.id_entreprise = p_entreprise and p.actif
       and p.zone_a = least(upper(coalesce(p_zone_depart, '')), upper(coalesce(p_zone_arrivee, '')))
       and p.zone_b = greatest(upper(coalesce(p_zone_depart, '')), upper(coalesce(p_zone_arrivee, '')))
       and p_zone_depart is not null and p_zone_depart <> ''),
    (select z.montant from public.zones_tarification z
     where z.id_entreprise = p_entreprise and z.actif
       and z.code_zone = upper(coalesce(p_zone_arrivee, ''))),
    0
  );
$$;

-- RPC publique : estimation de prix affichee AVANT l'envoi du formulaire
-- (esprit "prix affiche d'avance" façon Uber/Yango), pour chaque ligne de
-- colis, des que les 2 zones sont choisies.
create or replace function public.rpc_estimer_tarif(
  p_code_entreprise text, p_zone_depart text, p_zone_arrivee text
) returns numeric
language sql stable security definer set search_path = public as $$
  select public.tarif_zone_zone(e.id_entreprise, p_zone_depart, p_zone_arrivee)
  from public.entreprises e
  where e.code_entreprise = upper(trim(p_code_entreprise)) and e.actif;
$$;
grant execute on function public.rpc_estimer_tarif to anon, authenticated;

-- ---------------------------------------------------------------------------
-- rpc_creer_commande : ajout de p_zone_depart (optionnel, retro-compatible),
-- utilisation de tarif_zone_zone(), zone d'arrivee desormais OBLIGATOIRE et
-- VERIFIEE (existence dans zones_tarification), et le montant calcule est
-- maintenant renvoye (montant_livraison) pour que le front affiche le total
-- au recapitulatif.
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_creer_commande(text, text, text, text, jsonb, text, jsonb, text, uuid);

create or replace function public.rpc_creer_commande(
  p_code_entreprise text,
  p_expediteur_nom text,
  p_expediteur_tel text,
  p_expediteur_adresse text,
  p_gps_expediteur jsonb,
  p_mode_paiement text,
  p_colis jsonb,               -- [{destinataire_nom, destinataire_tel, destinataire_adresse, code_zone}]
  p_canal text default 'DIRECT',
  p_acteur uuid default null,
  p_zone_depart text default null
) returns table (id_commande text, code_ramassage text, token_expediteur uuid,
                 id_colis text, code_livraison text, token_destinataire uuid,
                 montant_livraison numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_entreprise uuid;
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_id_commande text;
  v_code_ramassage text := public.generer_code();
  v_token_exp uuid;
  v_item jsonb;
  v_code_zone text;
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

  -- Zone de depart optionnelle mais, si fournie, doit etre une zone connue
  -- (canal DIRECT public : le formulaire l'impose desormais).
  if p_zone_depart is not null and p_zone_depart <> '' then
    if not exists (select 1 from public.zones_tarification z
                   where z.id_entreprise = v_entreprise and z.actif
                     and z.code_zone = upper(p_zone_depart)) then
      raise exception 'Zone de ramassage invalide : %.', p_zone_depart;
    end if;
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
    v_code_zone := upper(coalesce(v_item->>'code_zone', ''));

    -- Zone de livraison OBLIGATOIRE et VERIFIEE : corrige le bug qui
    -- permettait de creer une commande sans zone (montant silencieusement a 0).
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

    insert into public.colis
      (id_colis, id_entreprise, id_commande, destinataire_nom, destinataire_tel,
       destinataire_adresse, code_livraison, code_zone, montant_livraison)
    values
      (v_id_colis, v_entreprise, v_id_commande,
       trim(v_item->>'destinataire_nom'), trim(v_item->>'destinataire_tel'),
       v_item->>'destinataire_adresse', v_code_livraison,
       v_code_zone, coalesce(v_montant, 0));

    insert into public.evenements_colis
      (id_entreprise, id_colis, evenement, statut_avant, statut_apres, acteur, role_acteur)
    values (v_entreprise, v_id_colis, 'CREATION', null, 'CREE', v_acteur, p_canal);

    insert into public.liens_partage (id_entreprise, type, id_colis)
    values (v_entreprise, 'POSITION_DESTINATAIRE', v_id_colis)
    returning token into v_token_dest;

    id_commande := v_id_commande; code_ramassage := v_code_ramassage;
    token_expediteur := v_token_exp; id_colis := v_id_colis;
    code_livraison := v_code_livraison; token_destinataire := v_token_dest;
    montant_livraison := coalesce(v_montant, 0);
    return next;
  end loop;
end;
$$;

grant execute on function public.rpc_creer_commande(
  text, text, text, text, jsonb, text, jsonb, text, uuid, text
) to anon, authenticated;

commit;

select 'fix_17_ok' as status;
