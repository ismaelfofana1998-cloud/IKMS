-- ============================================================================
-- 45 - rpc_assigner_lot : portee hub, par coherence
-- A executer apres 44_hub_scoping_lots.sql.
--
-- Complement demande : les colis/lots d'un hub A ne doivent meme plus
-- APPARAITRE chez un agent d'un hub B (deja fait cote listes, cette vague
-- pour le front-end) -- et par coherence/defense en profondeur,
-- rpc_assigner_lot (assigner un livreur a un lot) doit aussi refuser si
-- l'agent appelant n'est pas du meme hub que le lot.
-- ============================================================================

begin;

create or replace function public.rpc_assigner_lot(
  p_id_lot text, p_id_livreur uuid, p_acteur uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_c record;
  v_hub_agent uuid;
  v_role_agent text;
  v_hub_lot uuid;
begin
  select u.role, u.id_hub_affecte into v_role_agent, v_hub_agent
  from public.utilisateurs u where u.id_utilisateur = v_acteur;
  select id_hub into v_hub_lot from public.lots_livraison where id_lot = p_id_lot;

  if v_role_agent = 'agent' and v_hub_agent is not null
     and v_hub_lot is not null and v_hub_agent <> v_hub_lot then
    raise exception 'Ce lot est à un autre hub que le vôtre.';
  end if;

  update public.lots_livraison set id_livreur = p_id_livreur where id_lot = p_id_lot;
  for v_c in select c.id_colis, c.id_entreprise, c.statut from public.colis c
             where c.id_lot = p_id_lot loop
    insert into public.evenements_colis
      (id_entreprise, id_colis, evenement, statut_avant, statut_apres, acteur, role_acteur, details)
    values (v_c.id_entreprise, v_c.id_colis, 'ASSIGNER_LOT', v_c.statut, v_c.statut,
            v_acteur, 'agent', jsonb_build_object('id_livreur', p_id_livreur));
  end loop;
end;
$$;

commit;

select 'fix_45_ok' as status;
