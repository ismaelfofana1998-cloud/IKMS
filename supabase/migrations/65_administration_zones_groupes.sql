-- ============================================================================
-- Administration des zones et groupes
-- A executer apres 64_groupes_tarifaires.sql.
-- ============================================================================

begin;

create or replace function public.est_admin_effectif(p_acteur uuid default null)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.est_super_admin()
    or exists (
      select 1
      from public.utilisateurs u
      where u.id_utilisateur = public.acteur_effectif(p_acteur)
        and u.actif
        and u.role in ('admin', 'super_admin')
    );
$$;

revoke all on function public.est_admin_effectif(uuid) from public, anon;
grant execute on function public.est_admin_effectif(uuid) to authenticated;

alter policy ins_zones on public.zones_tarification with check (
  id_entreprise = (select public.entreprise_de())
  and (select public.est_admin_effectif())
  or (select public.est_super_admin())
);

alter policy upd_zones on public.zones_tarification using (
  id_entreprise = (select public.entreprise_de())
  and (select public.est_admin_effectif())
  or (select public.est_super_admin())
) with check (
  id_entreprise = (select public.entreprise_de())
  and (select public.est_admin_effectif())
  or (select public.est_super_admin())
);

alter policy ins_groupes_tarifaires on public.groupes_tarifaires with check (
  id_entreprise = (select public.entreprise_de())
  and (select public.est_admin_effectif())
  or (select public.est_super_admin())
);

alter policy upd_groupes_tarifaires on public.groupes_tarifaires using (
  id_entreprise = (select public.entreprise_de())
  and (select public.est_admin_effectif())
  or (select public.est_super_admin())
) with check (
  id_entreprise = (select public.entreprise_de())
  and (select public.est_admin_effectif())
  or (select public.est_super_admin())
);

alter policy ins_tarifs_groupes on public.tarifs_groupes with check (
  id_entreprise = (select public.entreprise_de())
  and (select public.est_admin_effectif())
  or (select public.est_super_admin())
);

alter policy upd_tarifs_groupes on public.tarifs_groupes using (
  id_entreprise = (select public.entreprise_de())
  and (select public.est_admin_effectif())
  or (select public.est_super_admin())
) with check (
  id_entreprise = (select public.entreprise_de())
  and (select public.est_admin_effectif())
  or (select public.est_super_admin())
);

alter policy ins_zones_paires on public.zones_tarifs_paires with check (
  id_entreprise = (select public.entreprise_de())
  and (select public.est_admin_effectif())
  or (select public.est_super_admin())
);

alter policy upd_zones_paires on public.zones_tarifs_paires using (
  id_entreprise = (select public.entreprise_de())
  and (select public.est_admin_effectif())
  or (select public.est_super_admin())
) with check (
  id_entreprise = (select public.entreprise_de())
  and (select public.est_admin_effectif())
  or (select public.est_super_admin())
);

create or replace function public.rpc_modifier_groupe_tarifaire(
  p_id_groupe uuid,
  p_code text,
  p_nom text,
  p_acteur uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_entreprise uuid := public.entreprise_de(public.acteur_effectif(p_acteur));
begin
  if not public.est_admin_effectif(p_acteur) then
    raise exception 'Action réservée aux administrateurs.';
  end if;

  if trim(coalesce(p_code, '')) = '' or trim(coalesce(p_nom, '')) = '' then
    raise exception 'Le code et le nom du groupe sont obligatoires.';
  end if;

  update public.groupes_tarifaires
  set code = upper(trim(p_code)),
      nom = trim(p_nom),
      maj_le = now()
  where id_groupe = p_id_groupe
    and id_entreprise = v_entreprise;

  if not found then
    raise exception 'Groupe tarifaire introuvable.';
  end if;
end;
$$;

create or replace function public.rpc_supprimer_groupe_tarifaire(
  p_id_groupe uuid,
  p_acteur uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_entreprise uuid := public.entreprise_de(public.acteur_effectif(p_acteur));
  v_nb_zones integer;
begin
  if not public.est_admin_effectif(p_acteur) then
    raise exception 'Action réservée aux administrateurs.';
  end if;

  if not exists (
    select 1 from public.groupes_tarifaires g
    where g.id_groupe = p_id_groupe and g.id_entreprise = v_entreprise
  ) then
    raise exception 'Groupe tarifaire introuvable.';
  end if;

  select count(*) into v_nb_zones
  from public.zones_tarification z
  where z.id_entreprise = v_entreprise
    and z.id_groupe_tarifaire = p_id_groupe
    and z.actif;

  if v_nb_zones > 0 then
    raise exception 'Ce groupe contient encore % zone(s). Déplacez-les avant de le supprimer.', v_nb_zones;
  end if;

  update public.zones_tarification
  set id_groupe_tarifaire = null
  where id_entreprise = v_entreprise
    and id_groupe_tarifaire = p_id_groupe
    and not actif;

  delete from public.tarifs_groupes
  where id_entreprise = v_entreprise
    and (groupe_a = p_id_groupe or groupe_b = p_id_groupe);

  delete from public.groupes_tarifaires
  where id_groupe = p_id_groupe
    and id_entreprise = v_entreprise;
end;
$$;

create or replace function public.rpc_modifier_zone_tarification(
  p_id_zone bigint,
  p_code_zone text,
  p_secteur text,
  p_nom_commune text,
  p_mots_cles text[],
  p_id_hub uuid,
  p_id_groupe_tarifaire uuid,
  p_tarif_intra_zone numeric,
  p_acteur uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_entreprise uuid := public.entreprise_de(public.acteur_effectif(p_acteur));
  v_ancien_code text;
  v_nouveau_code text := upper(trim(p_code_zone));
  v_paire record;
begin
  if not public.est_admin_effectif(p_acteur) then
    raise exception 'Action réservée aux administrateurs.';
  end if;

  select z.code_zone into v_ancien_code
  from public.zones_tarification z
  where z.id = p_id_zone
    and z.id_entreprise = v_entreprise
  for update;

  if not found then
    raise exception 'Zone introuvable.';
  end if;

  if v_nouveau_code = '' then
    raise exception 'Le code de zone est obligatoire.';
  end if;

  if trim(coalesce(p_nom_commune, '')) = '' then
    raise exception 'La commune est obligatoire.';
  end if;

  if v_nouveau_code <> v_ancien_code and exists (
    select 1 from public.zones_tarification z
    where z.id_entreprise = v_entreprise
      and z.code_zone = v_nouveau_code
      and z.id <> p_id_zone
  ) then
    raise exception 'Le code de zone % existe déjà.', v_nouveau_code;
  end if;

  if p_id_groupe_tarifaire is not null and not exists (
    select 1 from public.groupes_tarifaires g
    where g.id_groupe = p_id_groupe_tarifaire
      and g.id_entreprise = v_entreprise
      and g.actif
  ) then
    raise exception 'Groupe tarifaire invalide.';
  end if;

  if p_id_hub is not null and not exists (
    select 1 from public.hubs h
    where h.id_hub = p_id_hub
      and h.id_entreprise = v_entreprise
      and h.actif
  ) then
    raise exception 'Hub invalide.';
  end if;

  if v_nouveau_code <> v_ancien_code then
    for v_paire in
      select p.zone_a, p.zone_b, p.montant, p.actif
      from public.zones_tarifs_paires p
      where p.id_entreprise = v_entreprise
        and (p.zone_a = v_ancien_code or p.zone_b = v_ancien_code)
    loop
      delete from public.zones_tarifs_paires
      where id_entreprise = v_entreprise
        and zone_a = v_paire.zone_a
        and zone_b = v_paire.zone_b;

      insert into public.zones_tarifs_paires
        (id_entreprise, zone_a, zone_b, montant, actif)
      values (
        v_entreprise,
        least(
          case when v_paire.zone_a = v_ancien_code then v_nouveau_code else v_paire.zone_a end,
          case when v_paire.zone_b = v_ancien_code then v_nouveau_code else v_paire.zone_b end
        ),
        greatest(
          case when v_paire.zone_a = v_ancien_code then v_nouveau_code else v_paire.zone_a end,
          case when v_paire.zone_b = v_ancien_code then v_nouveau_code else v_paire.zone_b end
        ),
        v_paire.montant,
        v_paire.actif
      )
      on conflict (id_entreprise, zone_a, zone_b)
      do update set montant = excluded.montant, actif = excluded.actif;
    end loop;

    update public.colis
    set code_zone = v_nouveau_code
    where id_entreprise = v_entreprise
      and code_zone = v_ancien_code;
  end if;

  update public.zones_tarification
  set code_zone = v_nouveau_code,
      secteur = trim(p_secteur),
      nom_commune = trim(p_nom_commune),
      mots_cles = coalesce(p_mots_cles, '{}'::text[]),
      id_hub = p_id_hub,
      id_groupe_tarifaire = p_id_groupe_tarifaire,
      tarif_intra_zone = p_tarif_intra_zone,
      actif = true
  where id = p_id_zone
    and id_entreprise = v_entreprise;
end;
$$;

create or replace function public.rpc_supprimer_zone_tarification(
  p_id_zone bigint,
  p_acteur uuid default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_entreprise uuid := public.entreprise_de(public.acteur_effectif(p_acteur));
  v_code_zone text;
  v_nb_colis integer;
begin
  if not public.est_admin_effectif(p_acteur) then
    raise exception 'Action réservée aux administrateurs.';
  end if;

  select z.code_zone into v_code_zone
  from public.zones_tarification z
  where z.id = p_id_zone
    and z.id_entreprise = v_entreprise;

  if not found then
    raise exception 'Zone introuvable.';
  end if;

  select count(*) into v_nb_colis
  from public.colis c
  where c.id_entreprise = v_entreprise
    and c.code_zone = v_code_zone;

  if v_nb_colis > 0 then
    update public.zones_tarification
    set actif = false
    where id = p_id_zone
      and id_entreprise = v_entreprise;
    return 'ARCHIVEE';
  end if;

  delete from public.zones_tarifs_paires
  where id_entreprise = v_entreprise
    and (zone_a = v_code_zone or zone_b = v_code_zone);

  delete from public.zones_tarification
  where id = p_id_zone
    and id_entreprise = v_entreprise;

  return 'SUPPRIMEE';
end;
$$;

revoke all on function public.rpc_modifier_groupe_tarifaire(uuid, text, text, uuid) from public, anon;
revoke all on function public.rpc_supprimer_groupe_tarifaire(uuid, uuid) from public, anon;
revoke all on function public.rpc_modifier_zone_tarification(bigint, text, text, text, text[], uuid, uuid, numeric, uuid) from public, anon;
revoke all on function public.rpc_supprimer_zone_tarification(bigint, uuid) from public, anon;

grant execute on function public.rpc_modifier_groupe_tarifaire(uuid, text, text, uuid) to authenticated;
grant execute on function public.rpc_supprimer_groupe_tarifaire(uuid, uuid) to authenticated;
grant execute on function public.rpc_modifier_zone_tarification(bigint, text, text, text, text[], uuid, uuid, numeric, uuid) to authenticated;
grant execute on function public.rpc_supprimer_zone_tarification(bigint, uuid) to authenticated;

commit;

select 'fix_61_ok' as status;
