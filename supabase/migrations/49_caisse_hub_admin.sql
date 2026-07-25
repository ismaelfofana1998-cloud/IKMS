-- ============================================================================
-- 49 - Caisse par hub geree par l'admin : versements rattaches au hub,
--      validation reservee aux admins, historique complet
-- A executer apres 48_notifications_internes.sql.
--
-- Deux problemes trouves en repensant la caisse avec le client :
--   1. Un versement n'etait rattache a AUCUN hub -- impossible de savoir
--      pour quel hub un depot avait ete fait des qu'il y en a plusieurs.
--   2. rpc_valider_versement n'avait AUCUNE verification de role -- un
--      livreur (ou n'importe qui) pouvait valider LUI-MEME son propre
--      versement, sans jamais avoir physiquement remis l'argent a
--      personne. Vrai trou de securite, corrige ici.
--
-- Solution retenue, volontairement simple : pas de nouveau systeme, juste
-- deux ajouts sur ce qui existe deja -- le hub est capture automatiquement
-- a la creation du versement (celui de la personne qui depose), et seul un
-- admin/super_admin peut desormais valider.
-- ============================================================================

begin;

alter table public.versements_livreur add column if not exists id_hub uuid references public.hubs(id_hub);

-- ----------------------------------------------------------------------------
-- rpc_verser_caisse : capture automatiquement le hub de la personne qui
-- depose (agent ou livreur) -- jamais a saisir manuellement, deja connu.
-- ----------------------------------------------------------------------------
create or replace function public.rpc_verser_caisse(
  p_montant numeric, p_acteur uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_entreprise uuid := public.entreprise_de(v_acteur);
  v_hub uuid;
  v_id uuid;
begin
  select id_hub_affecte into v_hub from public.utilisateurs where id_utilisateur = v_acteur;
  insert into public.versements_livreur (id_entreprise, id_livreur, montant, id_hub)
  values (v_entreprise, v_acteur, p_montant, v_hub) returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- rpc_valider_versement : reserve a un admin/super_admin -- corrige le trou
-- de securite (avant : aucune verification, n'importe qui pouvait
-- s'auto-valider).
-- ----------------------------------------------------------------------------
create or replace function public.rpc_valider_versement(
  p_id uuid, p_acteur uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_role text;
begin
  select role into v_role from public.utilisateurs where id_utilisateur = v_acteur;
  if coalesce(v_role, '') not in ('admin', 'super_admin') then
    raise exception 'Seul un administrateur peut valider la reception d''un versement.';
  end if;
  update public.versements_livreur set valide_par = v_acteur
  where id = p_id and valide_par is null;
end;
$$;

-- Historique complet (valides ET en attente), pour affichage par hub.
create or replace view public.v_historique_versements
with (security_invoker = true) as
select
  v.id, v.id_entreprise, v.montant, v.cree_le,
  v.id_livreur, u.nom as nom_personne, u.role as role_personne,
  v.id_hub, h.nom as nom_hub,
  v.valide_par, va.nom as nom_validateur
from public.versements_livreur v
join public.utilisateurs u on u.id_utilisateur = v.id_livreur
left join public.hubs h on h.id_hub = v.id_hub
left join public.utilisateurs va on va.id_utilisateur = v.valide_par;

grant select on public.v_historique_versements to authenticated;

commit;

select 'fix_49_ok' as status;
