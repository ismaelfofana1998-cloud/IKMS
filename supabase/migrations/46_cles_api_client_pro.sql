-- ============================================================================
-- 46 - Cles API pour clients pro / partenaires
-- A executer apres 45_hub_scoping_assigner_lot.sql.
--
-- Permet a un client pro de generer sa propre cle API, pour que son propre
-- systeme (ERP, site e-commerce...) puisse creer des commandes et
-- consulter leur statut sans passer par l'interface web.
--
-- Conception (meme esprit que Wave par entreprise, patch 42) :
--   - La cle n'est JAMAIS stockee en clair -- seul son hachage SHA-256 est
--     conserve. Une cle API a assez d'entropie (192 bits generes
--     aleatoirement) pour qu'un hachage rapide soit suffisant ici
--     (contrairement a un mot de passe humain, la force brute est
--     infaisable independamment de la vitesse de hachage).
--   - La cle en clair n'est montree qu'UNE SEULE FOIS, a sa creation --
--     ensuite, seul un prefixe (les premiers caracteres) reste visible
--     pour que le client puisse reconnaitre laquelle est laquelle.
--   - Une cle est TOUJOURS rattachee a un seul client pro precis, jamais
--     a toute une entreprise -- une fuite ne compromet qu'un seul client,
--     pas toute la plateforme.
--   - La verification (recherche par hachage, mise a jour de la date de
--     dernier appel) est reservee a service_role -- jamais accessible
--     directement a un utilisateur normal, meme le client pro proprietaire
--     de la cle.
--   - Le canal 'API' de rpc_creer_commande n'est utilisable que par
--     service_role (la fonction Edge, apres avoir deja verifie la cle) --
--     un client authentifie normal ne peut pas s'auto-attribuer ce canal.
-- ============================================================================

begin;

-- La contrainte ne connaissait que DIRECT/INTERNE/CLIENT_PRO -- ajoute API.
alter table public.commandes drop constraint if exists commandes_canal_creation_check;
alter table public.commandes add constraint commandes_canal_creation_check
  check (canal_creation in ('DIRECT','INTERNE','CLIENT_PRO','API'));

create table if not exists public.cles_api (
  id uuid primary key default gen_random_uuid(),
  id_client uuid not null references public.clients_pro(id_client),
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  cle_hachee text not null,
  prefixe text not null,
  nom text,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  dernier_appel_le timestamptz,
  revoque_le timestamptz
);
create unique index if not exists idx_cles_api_hachee on public.cles_api(cle_hachee);
create index if not exists idx_cles_api_client on public.cles_api(id_client);

alter table public.cles_api enable row level security;

-- Un client pro voit la liste de ses propres cles (prefixe, nom, dates --
-- jamais le hachage, deja inutile pour un usage direct mais autant ne pas
-- l'exposer) -- pas de policy d'ecriture directe, tout passe par les RPC.
create policy sel_cles_api_self on public.cles_api for select
using (id_client = public.client_pro_de());

grant select on public.cles_api to authenticated;

-- ----------------------------------------------------------------------------
-- Creation (libre-service, cote client pro connecte) : genere une cle
-- aleatoire, la hache, l'enregistre, renvoie le texte en clair -- cette
-- seule fois, jamais recuperable ensuite.
-- ----------------------------------------------------------------------------
create or replace function public.rpc_creer_cle_api(p_nom text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id_client uuid := public.client_pro_de();
  v_entreprise uuid;
  v_cle text;
begin
  if v_id_client is null then
    raise exception 'Compte client pro introuvable ou inactif.';
  end if;
  select id_entreprise into v_entreprise from public.clients_pro where id_client = v_id_client;

  v_cle := 'ik_live_' || encode(gen_random_bytes(24), 'hex');

  insert into public.cles_api (id_client, id_entreprise, cle_hachee, prefixe, nom)
  values (v_id_client, v_entreprise, encode(digest(v_cle, 'sha256'), 'hex'), left(v_cle, 14), nullif(trim(p_nom), ''));

  return v_cle;
end;
$$;
grant execute on function public.rpc_creer_cle_api to authenticated;

create or replace function public.rpc_lister_cles_api()
returns table (id uuid, prefixe text, nom text, actif boolean, cree_le timestamptz, dernier_appel_le timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.prefixe, c.nom, c.actif, c.cree_le, c.dernier_appel_le
  from public.cles_api c
  where c.id_client = public.client_pro_de()
  order by c.cree_le desc;
$$;
grant execute on function public.rpc_lister_cles_api to authenticated;

create or replace function public.rpc_revoquer_cle_api(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.cles_api set actif = false, revoque_le = now()
  where id = p_id and id_client = public.client_pro_de();
  if not found then
    raise exception 'Cle introuvable ou deja revoquee.';
  end if;
end;
$$;
grant execute on function public.rpc_revoquer_cle_api to authenticated;

-- ----------------------------------------------------------------------------
-- Verification : reservee a service_role (fonction Edge uniquement). Met a
-- jour la date de dernier appel au passage (utile pour reperer une cle
-- inutilisee, ou au contraire un usage suspect).
-- ----------------------------------------------------------------------------
create or replace function public.interne_verifier_cle_api(p_cle text)
returns table (id_client uuid, id_entreprise uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_hachee text := encode(digest(p_cle, 'sha256'), 'hex');
  v_ligne record;
begin
  select * into v_ligne from public.cles_api c where c.cle_hachee = v_hachee and c.actif;
  if v_ligne.id is null then
    return;
  end if;
  update public.cles_api set dernier_appel_le = now() where id = v_ligne.id;
  id_client := v_ligne.id_client;
  id_entreprise := v_ligne.id_entreprise;
  return next;
end;
$$;
revoke all on function public.interne_verifier_cle_api from public, authenticated, anon;

-- ----------------------------------------------------------------------------
-- rpc_creer_commande : ajoute le canal 'API', reserve a service_role (la
-- fonction Edge, apres verification de la cle) -- repris de sa version la
-- plus recente (patch 41), pas de l'origine.
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
  v_claims text;
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

  -- Canal API : reserve a service_role -- la fonction Edge a deja verifie
  -- la cle avant d'arriver ici, et passe p_id_client_pro explicitement
  -- (deja resolu et de confiance a ce stade). Un appel direct par un
  -- utilisateur authentifie normal, sans etre service_role, est rejete
  -- meme s'il essaie de se faire passer pour ce canal.
  if p_canal = 'API' then
    v_claims := current_setting('request.jwt.claims', true);
    if v_claims is null or v_claims = '' or coalesce(v_claims::jsonb ->> 'role', '') <> 'service_role' then
      raise exception 'Canal API reserve a l''appel via cle API verifiee.';
    end if;
    if p_id_client_pro is null or not exists (
      select 1 from public.clients_pro c where c.id_client = p_id_client_pro and c.id_entreprise = v_entreprise and c.actif
    ) then
      raise exception 'Client pro introuvable pour cette entreprise.';
    end if;
    v_id_client_pro := p_id_client_pro;
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

commit;

select 'fix_46_ok' as status;
