-- ============================================================================
-- 29 - Nom de l'entreprise tenant, exposé publiquement (marque blanche)
-- A executer apres 28_reception_hub_retours.sql.
-- ============================================================================
--
-- Segmentation de marque demandee par le client :
--   - Pages ou les CLIENTS D'UNE ENTREPRISE TENANT interagissent (envoi de
--     colis, creation/connexion/espace client pro, suivi de position) :
--     affichent le nom de CETTE entreprise (marque blanche) -- ces
--     personnes-la sont clientes de la societe de livraison, pas de la
--     plateforme SaaS, qui doit rester invisible pour elles.
--   - Toutes les autres pages (plateforme, inscription d'entreprise, espaces
--     internes centrale/livreur/hub) : marque IKMS (l'editeur du logiciel).
--
-- Cette fonction expose UNIQUEMENT le nom commercial (aucune autre colonne)
-- a partir du code_entreprise deja present dans l'URL des pages concernees
-- (?entreprise=CODE) -- une information deja implicitement publique (le code
-- figure dans les liens partages), donc sans risque a exposer telle quelle.
-- ============================================================================

begin;

create or replace function public.rpc_nom_entreprise(p_code_entreprise text)
returns text
language sql stable security definer set search_path = public as $$
  select e.nom from public.entreprises e
  where e.code_entreprise = upper(trim(p_code_entreprise)) and e.actif;
$$;

grant execute on function public.rpc_nom_entreprise to anon, authenticated;

-- suivi.html n'a pas le code_entreprise dans son URL (seulement le token) :
-- rpc_lire_lien renvoie desormais aussi le nom de l'entreprise, pour que
-- cette page affiche elle aussi la marque du tenant plutot que IKMS.
drop function if exists public.rpc_lire_lien(uuid);
create or replace function public.rpc_lire_lien(p_token uuid)
returns table (type text, id_commande text, id_colis text,
               expediteur_nom text, destinataire_nom text, gps jsonb, code text,
               nom_entreprise text)
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  select l.*, cmd.expediteur_nom as exp_nom, cmd.gps_expediteur, cmd.code_ramassage,
         co.destinataire_nom as dest_nom, co.gps_destinataire, co.code_livraison, co.code_retour,
         e.nom as nom_entreprise
  into v
  from public.liens_partage l
  join public.entreprises e on e.id_entreprise = l.id_entreprise
  left join public.commandes cmd on cmd.id_commande = l.id_commande
  left join public.colis co on co.id_colis = l.id_colis
  where l.token = p_token and not l.revoque
    and (l.expire_le is null or l.expire_le > now());
  if v.token is null then raise exception 'Lien invalide ou expire.'; end if;
  return query select v.type, v.id_commande, v.id_colis,
    v.exp_nom, v.dest_nom,
    coalesce(v.gps_expediteur, v.gps_destinataire),
    case
      when v.type = 'POSITION_EXPEDITEUR' then v.code_ramassage
      when v.type = 'CODE_RETOUR' then v.code_retour
      else v.code_livraison
    end,
    v.nom_entreprise;
end;
$$;
grant execute on function public.rpc_lire_lien to anon, authenticated;

commit;

select 'fix_29_ok' as status;
