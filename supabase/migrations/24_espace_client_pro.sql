-- ============================================================================
-- 24 - Espace client pro en libre-service (compte, connexion, auto-debit)
-- A executer apres 23_paiements_retour_ramassage_clients_pro.sql.
-- ============================================================================
--
-- Distinction importante (a bien garder en tete) :
--   - "entreprises clientes du SaaS" (plateforme.html, inscription.html) :
--     des societes qui utilisent IKIGAI Livraison comme plateforme.
--   - "clients pro" (ce patch) : les clients D'UNE entreprise cliente (par
--     exemple, une boutique qui expedie regulierement via IKIGAI Livraison).
--     Rien a voir avec le SaaS -- ce sont des clients du metier logistique.
--
-- Ce patch ajoute une vraie authentification aux clients_pro (avant : un
-- simple enregistrement metier, sans connexion possible), pour qu'ils
-- puissent se creer un compte, se connecter, passer commande eux-memes
-- (auto-debitee, sans etape de paiement), et consulter leur historique.
-- ============================================================================

begin;

alter table public.clients_pro add column if not exists id_auth uuid references auth.users(id);
create unique index if not exists idx_clients_pro_id_auth on public.clients_pro(id_auth) where id_auth is not null;

-- Nouveau canal de creation de commande : CLIENT_PRO (auto-service, auto-
-- debite). La contrainte d'origine ne connaissait que DIRECT/INTERNE.
alter table public.commandes drop constraint if exists commandes_canal_creation_check;
alter table public.commandes add constraint commandes_canal_creation_check
  check (canal_creation in ('DIRECT','INTERNE','CLIENT_PRO'));

-- mouvements_portefeuille.cree_par doit pouvoir rester vide : un client pro
-- qui passe commande lui-meme n'est pas dans la table utilisateurs (reservee
-- au personnel de l'entreprise), donc rien a y referencer pour ce cas.
-- (la colonne est deja nullable, aucun changement necessaire ici)

create or replace function public.client_pro_de(p_id uuid default auth.uid()) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id_client from public.clients_pro c where c.id_auth = p_id and c.actif;
$$;

-- Un client pro voit son propre compte, et ses propres commandes/colis --
-- politiques ADDITIONNELLES (combinees en OU avec les politiques existantes
-- basees sur l'entreprise), rien retire ni modifie de l'existant.
create policy sel_clients_pro_self on public.clients_pro for select using (id_auth = auth.uid());
create policy sel_commandes_client_pro on public.commandes for select using (
  id_client_pro is not null and id_client_pro = public.client_pro_de());
create policy sel_colis_client_pro on public.colis for select using (
  id_commande in (select c.id_commande from public.commandes c where c.id_client_pro = public.client_pro_de()));

-- ----------------------------------------------------------------------------
-- rpc_creer_commande : nouveau canal CLIENT_PRO. Le client authentifie n'a
-- pas d'etape de paiement -- sa commande est directement debitee de son
-- portefeuille (facturation differee, voir clients-pro.js pour le reglement).
-- ----------------------------------------------------------------------------
drop function if exists public.rpc_creer_commande(text, text, text, text, jsonb, text, jsonb, text, uuid, text);

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
  p_zone_depart text default null
) returns table (id_commande text, code_ramassage text, token_expediteur uuid,
                 id_colis text, code_livraison text, token_destinataire uuid,
                 montant_livraison numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_entreprise uuid;
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_id_client_pro uuid;
  v_mode_paiement text := p_mode_paiement;
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

  -- NOUVEAU : un client pro authentifie ne peut creer une commande CLIENT_PRO
  -- que pour LUI-MEME, jamais pour un autre -- pas d'etape de paiement,
  -- debit automatique du portefeuille a la place.
  if p_canal = 'CLIENT_PRO' then
    v_id_client_pro := public.client_pro_de(v_acteur);
    if v_id_client_pro is null then
      raise exception 'Compte client pro introuvable ou inactif.';
    end if;
    if not exists (select 1 from public.clients_pro c
                   where c.id_client = v_id_client_pro and c.id_entreprise = v_entreprise) then
      raise exception 'Ce compte client n''appartient pas a cette entreprise.';
    end if;
    v_mode_paiement := 'SANS_PAIEMENT'; -- le paiement passe par le portefeuille, pas par le flux normal
  end if;

  if jsonb_array_length(coalesce(p_colis, '[]'::jsonb)) = 0 then
    raise exception 'Au moins un colis est requis.';
  end if;

  if p_zone_depart is null or trim(p_zone_depart) = '' then
    raise exception 'La zone de ramassage (zone de depart) est obligatoire.';
  end if;
  if not exists (select 1 from public.zones_tarification z
                 where z.id_entreprise = v_entreprise and z.actif
                   and z.code_zone = upper(p_zone_depart)) then
    raise exception 'Zone de ramassage invalide : %.', p_zone_depart;
  end if;

  v_id_commande := public.generer_id(v_entreprise, 'commande', 'CMD');

  insert into public.commandes
    (id_commande, id_entreprise, canal_creation, cree_par, id_client_pro, expediteur_nom, expediteur_tel,
     expediteur_adresse, gps_expediteur, code_ramassage, mode_paiement)
  values
    (v_id_commande, v_entreprise, p_canal,
     case when p_canal = 'INTERNE' then v_acteur else null end,
     v_id_client_pro,
     trim(p_expediteur_nom), trim(p_expediteur_tel), p_expediteur_adresse,
     p_gps_expediteur, v_code_ramassage,
     coalesce(nullif(v_mode_paiement, ''), 'A_LA_LIVRAISON'));

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

  -- Debit automatique du portefeuille (canal CLIENT_PRO uniquement). cree_par
  -- reste vide : le client n'est pas dans la table utilisateurs (reservee au
  -- personnel), la tracabilite passe par id_commande/id_client sur la ligne.
  if p_canal = 'CLIENT_PRO' and v_total_client_pro > 0 then
    update public.clients_pro set solde_portefeuille = solde_portefeuille - v_total_client_pro
    where id_client = v_id_client_pro;
    insert into public.mouvements_portefeuille (id_entreprise, id_client, type, montant, id_commande, note)
    values (v_entreprise, v_id_client_pro, 'DEBIT_COMMANDE', -v_total_client_pro, v_id_commande, 'Commande auto-débitée');
  end if;
end;
$$;

grant execute on function public.rpc_creer_commande(
  text, text, text, text, jsonb, text, jsonb, text, uuid, text
) to anon, authenticated;

commit;

select 'fix_24_ok' as status;
