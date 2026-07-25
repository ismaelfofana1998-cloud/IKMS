-- ============================================================================
-- 52 - Alerte de zone incoherente : persistee, visible cote hub
-- A executer apres 51_pgcrypto_schema_extensions.sql.
--
-- L'avertissement de zone (page publique) etait jusqu'ici uniquement un
-- message ephemere montre a l'expediteur -- jamais transmis ni visible cote
-- interne. Ajoute une colonne texte (null = pas d'alerte) sur les colis et
-- sur la commande (pour l'expediteur), remplie a partir du MEME calcul deja
-- fait cote client au moment de la creation -- jamais recalculee ni
-- verifiee a nouveau cote serveur (le comparateur reste approximatif par
-- nature, ca reste une alerte informative, jamais bloquante).
-- ============================================================================

begin;

alter table public.colis add column if not exists alerte_zone text;
alter table public.commandes add column if not exists alerte_zone_expediteur text;

drop function if exists public.rpc_creer_commande(
  text, text, text, text, jsonb, text, jsonb, text, uuid, text, uuid
);

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
  p_id_client_pro uuid default null,
  p_alerte_zone_expediteur text default null
) returns table (id_commande text, code_ramassage text, token_expediteur uuid,
                 id_colis text, code_livraison text, token_destinataire uuid,
                 montant_livraison numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_entreprise uuid;
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_id_client_pro uuid;
  v_facturation_activee boolean;
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
      select facturation_activee into v_facturation_activee
      from public.clients_pro c
      where c.id_client = p_id_client_pro and c.id_entreprise = v_entreprise and c.actif;
      if not found then
        raise exception 'Client pro introuvable pour cette entreprise.';
      end if;
      v_id_client_pro := p_id_client_pro;
    end if;
  end if;

  if p_canal = 'CLIENT_PRO' then
    v_id_client_pro := public.client_pro_de(v_acteur);
    if v_id_client_pro is null then
      raise exception 'Compte client introuvable ou inactif.';
    end if;
    select facturation_activee into v_facturation_activee
    from public.clients_pro c where c.id_client = v_id_client_pro and c.id_entreprise = v_entreprise;
    if not found then
      raise exception 'Ce compte client n''appartient pas a cette entreprise.';
    end if;
  end if;

  if p_canal = 'API' then
    v_claims := current_setting('request.jwt.claims', true);
    if v_claims is null or v_claims = '' or coalesce(v_claims::jsonb ->> 'role', '') <> 'service_role' then
      raise exception 'Canal API reserve a l''appel via cle API verifiee.';
    end if;
    select facturation_activee into v_facturation_activee
    from public.clients_pro c
    where c.id_client = p_id_client_pro and c.id_entreprise = v_entreprise and c.actif;
    if not found then
      raise exception 'Client pro introuvable pour cette entreprise.';
    end if;
    v_id_client_pro := p_id_client_pro;
  end if;

  if v_mode_paiement = 'SANS_PAIEMENT' and v_id_client_pro is not null and not coalesce(v_facturation_activee, false) then
    raise exception 'La facturation différée n''est pas encore activée pour ce client. Choisis un autre mode de paiement, ou demande à un administrateur de l''activer.';
  end if;
  if v_mode_paiement = 'SANS_PAIEMENT' and v_id_client_pro is null then
    raise exception 'La facturation différée nécessite un compte client avec la facturation activée.';
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
     expediteur_adresse, gps_expediteur, code_ramassage, mode_paiement, id_hub_prevu, alerte_zone_expediteur)
  values
    (v_id_commande, v_entreprise, p_canal,
     case when p_canal = 'INTERNE' then v_acteur else null end,
     v_id_client_pro,
     trim(p_expediteur_nom), trim(p_expediteur_tel), p_expediteur_adresse,
     p_gps_expediteur, v_code_ramassage, v_mode_paiement, v_id_hub_prevu,
     nullif(trim(coalesce(p_alerte_zone_expediteur, '')), ''));

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
       destinataire_adresse, code_livraison, code_zone, montant_livraison, alerte_zone)
    values
      (v_id_colis, v_entreprise, v_id_commande,
       trim(v_item->>'destinataire_nom'), trim(v_item->>'destinataire_tel'),
       v_item->>'destinataire_adresse', v_code_livraison,
       v_code_zone, v_montant, nullif(trim(coalesce(v_item->>'alerte_zone', '')), ''));

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

select 'fix_52_ok' as status;
