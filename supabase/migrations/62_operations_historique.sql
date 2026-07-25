-- Operations unifiees et historique des commandes

begin;

create or replace function public.rpc_historique_commandes(
  p_recherche text default null,
  p_statut text default null,
  p_date_debut date default null,
  p_date_fin date default null,
  p_limite integer default 50,
  p_offset integer default 0
) returns table (
  id_commande text,
  id_ramassage text,
  statut_commande text,
  id_colis text,
  id_lot text,
  statut_colis text,
  expediteur_nom text,
  expediteur_tel text,
  destinataire_nom text,
  destinataire_tel text,
  code_zone text,
  hub_nom text,
  livreur_ramassage_nom text,
  livreur_livraison_nom text,
  mode_paiement text,
  montant_livraison numeric,
  cree_le timestamptz,
  maj_le timestamptz,
  total_lignes bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acteur uuid := public.acteur_effectif(null);
  v_entreprise uuid := public.entreprise_de(v_acteur);
  v_role text;
  v_hub uuid;
  v_recherche text := lower(trim(coalesce(p_recherche, '')));
begin
  select u.role, u.id_hub_affecte
  into v_role, v_hub
  from public.utilisateurs u
  where u.id_utilisateur = v_acteur;

  if v_entreprise is null then
    raise exception 'Entreprise utilisateur introuvable.';
  end if;

  return query
  select
    cmd.id_commande,
    cmd.id_ramassage,
    coalesce(sc.statut, 'EN_ATTENTE') as statut_commande,
    c.id_colis,
    c.id_lot,
    c.statut as statut_colis,
    cmd.expediteur_nom,
    cmd.expediteur_tel,
    c.destinataire_nom,
    c.destinataire_tel,
    c.code_zone,
    h.nom as hub_nom,
    ur.nom as livreur_ramassage_nom,
    ul.nom as livreur_livraison_nom,
    cmd.mode_paiement,
    c.montant_livraison,
    cmd.cree_le,
    c.maj_le,
    count(*) over() as total_lignes
  from public.commandes cmd
  join public.colis c on c.id_commande = cmd.id_commande
  left join public.v_statut_commande sc on sc.id_commande = cmd.id_commande
  left join public.hubs h on h.id_hub = coalesce(c.id_hub_reel, cmd.id_hub_prevu)
  left join public.utilisateurs ur on ur.id_utilisateur = cmd.id_livreur_ramassage
  left join public.lots_livraison lot on lot.id_lot = c.id_lot
  left join public.utilisateurs ul on ul.id_utilisateur = lot.id_livreur
  where cmd.id_entreprise = v_entreprise
    and (
      v_role <> 'agent'
      or v_hub is null
      or cmd.id_hub_prevu = v_hub
      or c.id_hub_reel = v_hub
      or lot.id_hub = v_hub
    )
    and (
      v_recherche = ''
      or lower(concat_ws(
        ' ',
        cmd.id_commande,
        cmd.id_ramassage,
        c.id_colis,
        c.id_lot,
        cmd.expediteur_nom,
        cmd.expediteur_tel,
        c.destinataire_nom,
        c.destinataire_tel,
        c.code_zone,
        h.nom,
        ur.nom,
        ul.nom
      )) like '%' || v_recherche || '%'
    )
    and (
      coalesce(trim(p_statut), '') = ''
      or c.statut = p_statut
      or sc.statut = p_statut
    )
    and (p_date_debut is null or cmd.cree_le >= p_date_debut::timestamptz)
    and (p_date_fin is null or cmd.cree_le < (p_date_fin + 1)::timestamptz)
  order by cmd.cree_le desc, c.id_colis
  limit greatest(1, least(coalesce(p_limite, 50), 1000))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.rpc_historique_commandes(text, text, date, date, integer, integer) from public;
grant execute on function public.rpc_historique_commandes(text, text, date, date, integer, integer) to authenticated;

commit;

select 'operations_historique_ok' as status;
