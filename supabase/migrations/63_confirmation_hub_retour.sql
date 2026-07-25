-- Justification et confirmation du hub de retour

begin;

alter table public.colis
  add column if not exists motif_choix_hub_retour text,
  add column if not exists hub_retour_confirme_le timestamptz,
  add column if not exists hub_retour_confirme_par uuid;

create or replace function public.rpc_demander_depot_retour(
  p_id_colis text,
  p_id_hub_reel uuid,
  p_motif_choix_hub text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_motif text := trim(coalesce(p_motif_choix_hub, ''));
begin
  if p_id_hub_reel is null then
    raise exception 'Choisis le hub où le retour sera réellement déposé.';
  end if;

  if length(v_motif) < 5 then
    raise exception 'Explique pourquoi ce hub a été choisi.';
  end if;

  if length(v_motif) > 240 then
    raise exception 'Le motif du choix du hub est limité à 240 caractères.';
  end if;

  perform public.avancer_colis(
    p_id_colis := p_id_colis,
    p_evenement := 'DEMANDER_RETOUR_HUB',
    p_details := jsonb_build_object('id_hub_reel', p_id_hub_reel)
  );

  update public.colis
  set motif_choix_hub_retour = v_motif,
      hub_retour_confirme_le = null,
      hub_retour_confirme_par = null
  where id_colis = p_id_colis;

  if not found then
    raise exception 'Colis introuvable.';
  end if;
end;
$$;

create or replace function public.rpc_confirmer_hub_retour(
  p_id_colis text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acteur uuid := public.acteur_effectif(null);
  v_motif text;
begin
  select motif_choix_hub_retour
  into v_motif
  from public.colis
  where id_colis = p_id_colis;

  if coalesce(trim(v_motif), '') = '' then
    raise exception 'Le livreur doit justifier le choix du hub avant confirmation.';
  end if;

  perform public.avancer_colis(
    p_id_colis := p_id_colis,
    p_evenement := 'VALIDER_RETOUR_RECU'
  );

  update public.colis
  set hub_retour_confirme_le = now(),
      hub_retour_confirme_par = v_acteur
  where id_colis = p_id_colis;
end;
$$;

revoke all on function public.rpc_demander_depot_retour(text, uuid, text) from public;
revoke all on function public.rpc_confirmer_hub_retour(text) from public;
grant execute on function public.rpc_demander_depot_retour(text, uuid, text) to authenticated;
grant execute on function public.rpc_confirmer_hub_retour(text) to authenticated;

commit;

select 'confirmation_hub_retour_ok' as status;
