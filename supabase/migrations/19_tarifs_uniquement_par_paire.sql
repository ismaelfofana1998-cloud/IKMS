-- ============================================================================
-- 19 - Tarification EXCLUSIVEMENT par paire de zones
-- A executer apres 18_valider_recuperation_lot.sql.
-- ============================================================================
--
-- CHANGEMENT DE LOGIQUE DEMANDE : la table des zones (zones_tarification)
-- devient une simple LISTE DE REFERENCE (code + description), elle ne porte
-- plus de prix du tout. Le prix n'existe plus que dans zones_tarifs_paires,
-- une ligne par PAIRE de zones (zone_x, zone_y) -- le sens n'a pas
-- d'importance (Yopougon-Cocody et Cocody-Yopougon = la meme ligne, le meme
-- tarif), y compris la paire d'une zone avec elle-meme (livraison locale,
-- ex. Yopougon-Yopougon).
--
-- CE QUI DISPARAIT : le tarif "par defaut" de repli sur la seule zone
-- d'arrivee (l'ancien systeme). Il n'y a plus de repli du tout : si aucune
-- paire n'est configuree pour un couple de zones donne, la commande est
-- refusee avec un message explicite -- jamais facturee 0 en silence, jamais
-- facturee sur une hypothese approximative.
--
-- CONSEQUENCE POUR TOI : avant de pouvoir prendre des commandes, il faut que
-- CHAQUE combinaison de zones reellement utilisee (y compris chaque zone
-- vers elle-meme, pour les livraisons locales) ait une ligne dans le nouveau
-- tableau "Tarifs" du panneau Zones et tarifs. Avec N zones actives, ca fait
-- au plus N*(N+1)/2 lignes a saisir une fois (pour 6 zones : 21 lignes max).
-- ============================================================================

begin;

-- 1) La table des zones devient une liste de reference pure : plus de prix.
alter table public.zones_tarification drop column if exists montant;

-- 2) tarif_zone_zone : plus AUCUN repli. NULL si la paire n'existe pas.
create or replace function public.tarif_zone_zone(
  p_entreprise uuid, p_zone_depart text, p_zone_arrivee text
) returns numeric
language sql stable security definer set search_path = public as $$
  select p.montant from public.zones_tarifs_paires p
  where p.id_entreprise = p_entreprise and p.actif
    and p.zone_a = least(upper(coalesce(p_zone_depart, '')), upper(coalesce(p_zone_arrivee, '')))
    and p.zone_b = greatest(upper(coalesce(p_zone_depart, '')), upper(coalesce(p_zone_arrivee, '')))
    and p_zone_depart is not null and p_zone_depart <> ''
    and p_zone_arrivee is not null and p_zone_arrivee <> '';
$$;

-- 3) rpc_lister_zones_publiques ne renvoie plus de montant (la colonne n'existe
--    plus). Signature de retour changee -> DROP necessaire avant recreation.
drop function if exists public.rpc_lister_zones_publiques(text);

create or replace function public.rpc_lister_zones_publiques(p_code_entreprise text)
returns table (code_zone text, description text)
language sql stable security definer set search_path = public as $$
  select z.code_zone, z.description
  from public.zones_tarification z
  join public.entreprises e on e.id_entreprise = z.id_entreprise
  where e.code_entreprise = upper(trim(p_code_entreprise)) and e.actif and z.actif
  order by z.code_zone;
$$;
grant execute on function public.rpc_lister_zones_publiques to anon, authenticated;

-- 4) rpc_creer_commande : la zone de depart devient elle-meme obligatoire
--    (avant elle etait facultative -- elle est desormais indispensable au
--    calcul du prix), et toute paire sans tarif configure bloque la commande
--    avec un message explicite au lieu de facturer 0.
drop function if exists public.rpc_creer_commande(text, text, text, text, jsonb, text, jsonb, text, uuid, text);

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

  -- Zone de depart desormais OBLIGATOIRE : indispensable au calcul du tarif
  -- par paire, il n'y a plus de tarif "par defaut" a defaut de mieux.
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

    -- Zone de livraison OBLIGATOIRE et VERIFIEE.
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

    -- PLUS DE REPLI : si aucun tarif n'est configure pour cette paire de
    -- zones precise, on bloque -- jamais de facturation a 0 en silence.
    if v_montant is null then
      raise exception
        'Aucun tarif configure entre les zones % et %. Ajoute-le dans Zones et tarifs avant de reessayer.',
        upper(p_zone_depart), v_code_zone;
    end if;

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
end;
$$;

grant execute on function public.rpc_creer_commande(
  text, text, text, text, jsonb, text, jsonb, text, uuid, text
) to anon, authenticated;

commit;

select 'fix_19_ok' as status;
