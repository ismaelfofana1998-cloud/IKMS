-- ============================================================================
-- 54 - Grille tarifaire exposee en lecture seule via api-v1 (synergie
-- Marketplace : calcul du prix de livraison au checkout, sans dupliquer les
-- tables de zones/tarifs ni les synchroniser).
-- A executer apres 53_durcissement_privileges_data_api.sql.
--
-- Conception : une seule fonction, reservee a service_role -- jamais a
-- anon/authenticated directement, meme si le contenu (des tarifs par paire
-- de zones) n'est pas sensible en soi. Le filtrage par entreprise se fait
-- via p_id_entreprise, deja resolu et verifie par api-v1 a partir de la cle
-- ik_live_... du client pro (voir interne_verifier_cle_api, patch 46) --
-- jamais un id_entreprise fourni tel quel par l'appelant.
--
-- Reutilise directement la table zones_tarifs_paires (patch 19) -- aucune
-- nouvelle table, aucun nouveau calcul : c'est la meme donnee que celle deja
-- utilisee par tarif_zone_zone() dans rpc_creer_commande, exposee ici en
-- lecture seule et en une seule fois (grille complete plutot qu'une requete
-- par paire) pour permettre un cache court cote appelant.
-- ============================================================================

begin;

create or replace function public.interne_lister_tarifs_entreprise(p_id_entreprise uuid)
returns table (zone_a text, zone_b text, montant numeric)
language sql stable security definer set search_path = public as $$
  select p.zone_a, p.zone_b, p.montant
  from public.zones_tarifs_paires p
  where p.id_entreprise = p_id_entreprise and p.actif
  order by p.zone_a, p.zone_b;
$$;

revoke all on function public.interne_lister_tarifs_entreprise(uuid) from public, anon, authenticated;
grant execute on function public.interne_lister_tarifs_entreprise(uuid) to service_role;

commit;

select 'fix_54_ok' as status;
