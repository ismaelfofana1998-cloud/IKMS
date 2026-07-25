-- ============================================================================
-- 30 - Décision de retour atomique (transition + lien de code en un seul appel)
-- A executer apres 29_nom_entreprise_public.sql.
-- ============================================================================
--
-- Signale a deux reprises comme ne fonctionnant "toujours pas" : le lien de
-- partage du code de retour, recupere par une requete SEPAREE juste apres la
-- transition (validerRetour() puis obtenirLienCodeRetour()). Le token existe
-- bien en base et est visible sous RLS une fois teste directement en SQL --
-- impossible de reproduire un bug precis cote donnees. Plutot que de
-- continuer a deviner, cette fonction rend l'operation ATOMIQUE : la
-- transition et la lecture du lien se font dans le MEME appel, la MEME
-- transaction -- supprime toute la classe de bugs possibles lies a un
-- eventuel decalage entre les deux etapes (session, timing, RLS).
-- ============================================================================

begin;

create or replace function public.rpc_decider_retour(
  p_id_colis text, p_decision text, p_acteur uuid default null
) returns table (id_colis text, statut text, token_code_retour uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_evenement text := case when p_decision = 'REPROGRAMMER' then 'VALIDER_RETOUR_REPROGRAMMER' else 'VALIDER_RETOUR_EXPEDITEUR' end;
  v_resultat record;
  v_token uuid;
begin
  select * into v_resultat from public.avancer_colis(p_id_colis, v_evenement, null, null, '{}'::jsonb, p_acteur);

  if v_evenement = 'VALIDER_RETOUR_EXPEDITEUR' then
    select l.token into v_token
    from public.liens_partage l
    where l.id_colis = p_id_colis and l.type = 'CODE_RETOUR'
    order by l.cree_le desc
    limit 1;
  end if;

  id_colis := v_resultat.id_colis;
  statut := v_resultat.statut;
  token_code_retour := v_token;
  return next;
end;
$$;

grant execute on function public.rpc_decider_retour to authenticated;

commit;

select 'fix_30_ok' as status;
