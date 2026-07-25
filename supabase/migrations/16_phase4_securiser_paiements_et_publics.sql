-- ============================================================================
-- 16 - Securiser les paiements + RPC publiques pour la phase 4
-- A executer apres 14_fix_multitenant_colonnes_et_jwt.sql / 00_install_v3.sql.
-- ============================================================================
--
-- FAILLE CORRIGEE : rpc_encaisser_especes et rpc_initier_paiement_wave
-- n'importe quel compte authentifie (y compris un expediteur ou un destinataire
-- auto-inscrit) pouvait appeler ces fonctions sur N'IMPORTE QUEL id_colis et
-- creer un paiement marque PAYE, ce qui aurait deverrouille frauduleusement
-- VALIDER_LIVRAISON sans paiement reel. Corrige en exigeant : acteur role
-- livreur actif, colis assigne a SON lot, colis au statut EN_TOURNEE, et
-- aucun paiement PAYE deja existant sur ce colis.
-- ============================================================================

begin;

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
  if exists (select 1 from public.paiements p where p.id_colis = p_id_colis and p.statut = 'PAYE') then
    raise exception 'Ce colis est deja marque paye.';
  end if;
  return v_colis;
end;
$$;

create or replace function public.rpc_encaisser_especes(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis public.colis;
  v_id uuid;
begin
  v_colis := public.verifier_livreur_assigne_colis(p_id_colis, v_acteur);
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
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis public.colis;
  v_id uuid;
begin
  v_colis := public.verifier_livreur_assigne_colis(p_id_colis, v_acteur);
  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut, encaisse_par)
  values (v_colis.id_entreprise, p_id_colis, 'DESTINATAIRE', 'WAVE', v_colis.montant_livraison, 'INITIE', v_acteur)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- rpc_lire_lien : ajoute les codes que la personne doit donner au livreur.
-- Cote securite, ce n'est PAS une fuite : le token lui-meme est le secret
-- (un uuid non devinable, connu seulement de son destinataire legitime) ; une
-- fois qu'on detient un token valide, connaitre le code qui va avec est
-- precisement le but de la page de suivi.
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_lire_lien(uuid);
create or replace function public.rpc_lire_lien(p_token uuid)
returns table (type text, id_commande text, id_colis text,
               expediteur_nom text, destinataire_nom text, gps jsonb, code text)
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  select l.*, cmd.expediteur_nom as exp_nom, cmd.gps_expediteur, cmd.code_ramassage,
         co.destinataire_nom as dest_nom, co.gps_destinataire, co.code_livraison
  into v
  from public.liens_partage l
  left join public.commandes cmd on cmd.id_commande = l.id_commande
  left join public.colis co on co.id_colis = l.id_colis
  where l.token = p_token and not l.revoque
    and (l.expire_le is null or l.expire_le > now());
  if v.token is null then raise exception 'Lien invalide ou expire.'; end if;
  return query select v.type, v.id_commande, v.id_colis,
    v.exp_nom, v.dest_nom,
    coalesce(v.gps_expediteur, v.gps_destinataire),
    case when v.type = 'POSITION_EXPEDITEUR' then v.code_ramassage else v.code_livraison end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Zones tarifaires publiques : necessaire pour que la page expediteur publique
-- affiche le tarif de livraison par zone sans exposer le reste de l'entreprise.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_lister_zones_publiques(p_code_entreprise text)
returns table (code_zone text, description text, montant numeric)
language sql stable security definer set search_path = public as $$
  select z.code_zone, z.description, z.montant
  from public.zones_tarification z
  join public.entreprises e on e.id_entreprise = z.id_entreprise
  where e.code_entreprise = upper(trim(p_code_entreprise)) and e.actif and z.actif
  order by z.code_zone;
$$;

grant execute on function public.rpc_lister_zones_publiques to anon, authenticated;

-- ---------------------------------------------------------------------------
-- FAILLE CRITIQUE CORRIGEE : rpc_confirmer_paiement (destinee au seul webhook
-- Wave, via service_role) etait en realite executable par N'IMPORTE QUEL
-- VISITEUR NON CONNECTE. Le "revoke ... from anon, authenticated" du fichier
-- d'installation ne suffit PAS : Postgres accorde EXECUTE a PUBLIC par defaut
-- a la creation d'une fonction, et retirer le droit a des roles nommes ne
-- retire pas celui herite de PUBLIC (chaque role est implicitement membre de
-- PUBLIC). Sans ce correctif, n'importe qui pouvait appeler cette fonction
-- via l'API REST et marquer n'importe quel paiement comme PAYE sans jamais
-- passer par Wave. Corrige en deux temps : on retire le droit a PUBLIC lui
-- meme (le seul revoke qui compte reellement), ET on ajoute une verification
-- interne (defense en profondeur) qui exige explicitement le role service_role.
-- ---------------------------------------------------------------------------
revoke execute on function public.rpc_confirmer_paiement(uuid, text, text, boolean) from public;

create or replace function public.rpc_confirmer_paiement(
  p_id_paiement uuid, p_reference_externe text, p_id_event_externe text, p_succes boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare v_claims text := current_setting('request.jwt.claims', true);
begin
  -- Hors PostgREST (SQL Editor, tests, migrations) : pas de claims => autorise.
  -- Sous PostgREST : exige explicitement le role service_role (jamais anon/authenticated).
  if v_claims is not null and v_claims <> '' then
    if coalesce(v_claims::jsonb ->> 'role', '') <> 'service_role' then
      raise exception 'Seul le webhook de paiement (service_role) peut confirmer un paiement.';
    end if;
  end if;

  if exists (select 1 from public.paiements where id_event_externe = p_id_event_externe) then
    return;
  end if;
  update public.paiements set
    statut = case when p_succes then 'PAYE' else 'ECHOUE' end,
    reference_externe = p_reference_externe,
    id_event_externe = p_id_event_externe
  where id = p_id_paiement and statut in ('EN_ATTENTE', 'INITIE');
end;
$$;
revoke execute on function public.rpc_confirmer_paiement(uuid, text, text, boolean) from public;

commit;

select 'fix_16_ok' as status;
