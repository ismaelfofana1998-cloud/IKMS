-- ============================================================================
-- 43 - rpc_lire_lien : indique si le partage de position reste utile
-- A executer apres 42_wave_par_entreprise.sql.
--
-- Signale : une fois une commande terminee (ramassage deja effectue), le
-- lien de position de l'EXPEDITEUR n'a plus de sens a proposer -- il a
-- deja commande, personne n'a plus besoin de sa position. Le lien du
-- DESTINATAIRE reste pertinent tel quel (pas de changement demande la).
--
-- On garde le lien et son token en base dans tous les cas (rien n'est
-- jamais supprime) -- seule l'INDICATION "encore utile ou non" change,
-- pour que la page publique arrete de proposer "partage ta position" une
-- fois que ca ne sert plus a rien.
-- ============================================================================

begin;

drop function if exists public.rpc_lire_lien(uuid);
create or replace function public.rpc_lire_lien(p_token uuid)
returns table (type text, id_commande text, id_colis text,
               expediteur_nom text, destinataire_nom text, gps jsonb, code text,
               nom_entreprise text, toujours_utile boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v record;
  v_toujours_utile boolean;
begin
  select l.*, cmd.expediteur_nom as exp_nom, cmd.gps_expediteur, cmd.code_ramassage,
         co.destinataire_nom as dest_nom, co.gps_destinataire, co.code_livraison, co.code_retour,
         co.statut as statut_colis, e.nom as nom_entreprise
  into v
  from public.liens_partage l
  join public.entreprises e on e.id_entreprise = l.id_entreprise
  left join public.commandes cmd on cmd.id_commande = l.id_commande
  left join public.colis co on co.id_colis = l.id_colis
  where l.token = p_token and not l.revoque
    and (l.expire_le is null or l.expire_le > now());
  if v.token is null then raise exception 'Lien invalide ou expire.'; end if;

  -- Pour le lien EXPEDITEUR (rattache a la commande) : reste utile tant que
  -- le ramassage n'a pas encore ete valide pour AUCUN colis de la commande
  -- -- une fois que ca a commence, plus personne n'a besoin de sa position.
  if v.type = 'POSITION_EXPEDITEUR' then
    select exists (
      select 1 from public.colis c
      where c.id_commande = v.id_commande and c.statut in ('CREE', 'A_RAMASSER')
    ) into v_toujours_utile;
  else
    v_toujours_utile := true; -- non concerne : le lien destinataire reste toujours propose tel quel
  end if;

  return query select v.type, v.id_commande, v.id_colis,
    v.exp_nom, v.dest_nom,
    coalesce(v.gps_expediteur, v.gps_destinataire),
    case
      when v.type = 'POSITION_EXPEDITEUR' then v.code_ramassage
      when v.type = 'CODE_RETOUR' then v.code_retour
      else v.code_livraison
    end,
    v.nom_entreprise,
    v_toujours_utile;
end;
$$;
grant execute on function public.rpc_lire_lien to anon, authenticated;

commit;

select 'fix_43_ok' as status;
