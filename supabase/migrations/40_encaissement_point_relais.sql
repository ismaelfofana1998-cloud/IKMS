-- ============================================================================
-- 40 - Encaissement au retrait en point relais (manquant jusqu'ici)
-- A executer apres 39_solde_du_et_wave_commande.sql.
--
-- Trouve lors d'un audit de bout en bout (100 commandes, tous les
-- scenarios) : rien ne permettait d'encaisser un solde du au retrait en
-- point relais. rpc_encaisser_especes exige le statut EN_TOURNEE et le
-- role livreur -- un colis en attente de retrait point relais est au
-- statut POINT_RELAIS et c'est un AGENT (pas un livreur) qui valide le
-- retrait. Toute tentative de paiement a ce stade echouait purement et
-- simplement (erreur technique, jamais teste avant cet audit).
-- ============================================================================

begin;

create or replace function public.rpc_encaisser_especes_point_relais(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis public.colis;
  v_profil record;
  v_hub_agent uuid;
  v_id uuid;
  v_solde numeric;
begin
  select * into v_profil from public.profil_de(v_acteur);
  if v_profil.id_utilisateur is null or not v_profil.actif or v_profil.role not in ('agent','admin','super_admin') then
    raise exception 'Seul un agent peut encaisser un paiement de point relais.';
  end if;

  select * into v_colis from public.colis c where c.id_colis = p_id_colis;
  if v_colis.id_colis is null then raise exception 'Colis introuvable.'; end if;
  if v_colis.statut <> 'POINT_RELAIS' then
    raise exception 'Ce colis n''est pas en attente de retrait point relais (statut actuel : %).', v_colis.statut;
  end if;

  if v_profil.role = 'agent' then
    select u.id_hub_affecte into v_hub_agent from public.utilisateurs u where u.id_utilisateur = v_acteur;
    if v_hub_agent is not null and v_colis.id_hub_reel is distinct from v_hub_agent then
      raise exception 'Ce colis est a un autre hub que le votre.';
    end if;
  end if;

  v_solde := public.montant_du(p_id_colis);
  if v_solde <= 0 then raise exception 'Ce colis est deja entierement paye.'; end if;

  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut, encaisse_par)
  values (v_colis.id_entreprise, p_id_colis, 'DESTINATAIRE', 'ESPECES', v_solde, 'PAYE', v_acteur)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.rpc_encaisser_especes_point_relais to authenticated;

create or replace function public.rpc_initier_paiement_wave_point_relais(
  p_id_colis text, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_colis public.colis;
  v_profil record;
  v_hub_agent uuid;
  v_id uuid;
  v_solde numeric;
begin
  select * into v_profil from public.profil_de(v_acteur);
  if v_profil.id_utilisateur is null or not v_profil.actif or v_profil.role not in ('agent','admin','super_admin') then
    raise exception 'Seul un agent peut encaisser un paiement de point relais.';
  end if;

  select * into v_colis from public.colis c where c.id_colis = p_id_colis;
  if v_colis.id_colis is null then raise exception 'Colis introuvable.'; end if;
  if v_colis.statut <> 'POINT_RELAIS' then
    raise exception 'Ce colis n''est pas en attente de retrait point relais (statut actuel : %).', v_colis.statut;
  end if;

  if v_profil.role = 'agent' then
    select u.id_hub_affecte into v_hub_agent from public.utilisateurs u where u.id_utilisateur = v_acteur;
    if v_hub_agent is not null and v_colis.id_hub_reel is distinct from v_hub_agent then
      raise exception 'Ce colis est a un autre hub que le votre.';
    end if;
  end if;

  v_solde := public.montant_du(p_id_colis);
  if v_solde <= 0 then raise exception 'Ce colis est deja entierement paye.'; end if;

  insert into public.paiements (id_entreprise, id_colis, payeur, methode, montant, statut)
  values (v_colis.id_entreprise, p_id_colis, 'DESTINATAIRE', 'WAVE', v_solde, 'INITIE')
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.rpc_initier_paiement_wave_point_relais to authenticated;

commit;

select 'fix_40_ok' as status;
