-- ============================================================================
-- 18 - Validation de la récupération d'un lot au hub
-- A executer apres 17_zones_paires_et_obligatoires.sql.
-- ============================================================================
--
-- PROBLEME CORRIGE : quand un livreur, depuis l'app mobile, demande a
-- recuperer un lot pour partir en tournee de livraison (evenement
-- DEMANDER_RECUPERATION, statut colis -> RECUP_DEMANDEE), aucune action
-- cote centrale ne permettait de valider cette remise et de faire passer
-- les colis a EN_TOURNEE (evenement VALIDER_RECUPERATION, reserve au role
-- agent dans transitions_colis). Le panneau "Lots & livraison" n'affichait
-- ce cas nulle part : le lot restait bloque en statut RECUPERATION sans
-- action possible pour l'agent.
--
-- Cette fonction reprend exactement le patron de rpc_valider_ramassage :
-- validation groupee de TOUS les colis du lot d'un coup (l'agent remet
-- physiquement les colis en main propre au livreur, ca n'a pas de sens de
-- valider colis par colis).
-- ============================================================================

begin;

create or replace function public.rpc_valider_recuperation(
  p_id_lot text, p_acteur uuid default null
) returns setof text
language plpgsql security definer set search_path = public as $$
declare v_c record; r record;
begin
  for v_c in select c.id_colis from public.colis c
             where c.id_lot = p_id_lot and c.statut = 'RECUP_DEMANDEE' loop
    for r in select * from public.avancer_colis(v_c.id_colis, 'VALIDER_RECUPERATION',
                        null, null, '{}'::jsonb, p_acteur) loop
      return next r.id_colis;
    end loop;
  end loop;
  if not found then raise exception 'Aucun colis en recuperation demandee sur ce lot.'; end if;
end;
$$;

grant execute on function public.rpc_valider_recuperation to authenticated;

commit;

select 'fix_18_ok' as status;
