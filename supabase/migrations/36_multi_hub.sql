-- ============================================================================
-- 36 - Multi-hub par entreprise
-- A executer apres 35_textes_personnalises.sql.
-- ============================================================================
--
-- Absent de la cartographie initiale : une entreprise peut avoir plusieurs
-- hubs. Un livreur est normalement affecte a un hub, mais peut faire un
-- depot dans un hub different (point relais, depannage) -- auquel cas une
-- raison est exigee.
--
-- Choix de conception :
--   - Le hub est optionnel partout (colonnes nullables, parametres avec
--     valeur par defaut null) : une entreprise qui n'a jamais cree de hub
--     continue de fonctionner exactement comme avant, sans rien configurer.
--   - Le hub PREVU est choisi au moment de l'assignation du ramassage
--     (rpc_assigner_ramassage), au niveau de la COMMANDE (un ramassage
--     regroupe potentiellement plusieurs colis, tous vers le meme hub prevu).
--   - Le hub REEL est enregistre au moment du depot (avancer_colis,
--     evenement DEMANDER_DEPOT), au niveau du COLIS -- un livreur pourrait
--     en theorie deposer les colis d'une meme commande a des endroits
--     differents, meme si ce sera rare en pratique.
--   - Un motif est OBLIGATOIRE uniquement si le hub reel differe du hub
--     prevu -- jamais impose sinon, pour ne pas alourdir le geste courant.
-- ============================================================================

begin;

create table if not exists public.hubs (
  id_hub uuid primary key default gen_random_uuid(),
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  nom text not null,
  adresse text,
  actif boolean not null default true,
  cree_le timestamptz not null default now()
);
create index if not exists idx_hubs_entreprise on public.hubs(id_entreprise);

alter table public.hubs enable row level security;

create policy sel_hubs on public.hubs for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());
create policy ins_hubs on public.hubs for insert with check (
  id_entreprise = public.entreprise_de() and public.jwt_role() in ('agent','admin')
  or public.est_super_admin());
create policy upd_hubs on public.hubs for update using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());

grant select, insert, update on public.hubs to authenticated;

-- Livreur affecte a un hub (son hub "habituel", modifiable a tout moment
-- par un admin -- ne bloque jamais un depot ailleurs, voir plus bas).
alter table public.utilisateurs
  add column if not exists id_hub_affecte uuid references public.hubs(id_hub);

-- Hub prevu, choisi a l'assignation du ramassage (niveau commande).
alter table public.commandes
  add column if not exists id_hub_prevu uuid references public.hubs(id_hub);

-- Hub reel utilise au depot + motif si different du hub prevu (niveau colis).
alter table public.colis
  add column if not exists id_hub_reel uuid references public.hubs(id_hub),
  add column if not exists motif_hub_different text;

-- ----------------------------------------------------------------------------
-- rpc_assigner_ramassage : ajoute le choix du hub prevu (optionnel, retro-
-- compatible -- les appels existants sans ce parametre continuent de marcher).
-- ----------------------------------------------------------------------------
drop function if exists public.rpc_assigner_ramassage(text, uuid, uuid);
create or replace function public.rpc_assigner_ramassage(
  p_id_commande text, p_id_livreur uuid, p_acteur uuid default null, p_id_hub uuid default null
) returns setof text
language plpgsql security definer set search_path = public as $$
declare v_c record; r record; v_entreprise uuid;
begin
  select id_entreprise into v_entreprise from public.commandes where id_commande = p_id_commande;

  if p_id_hub is not null and not exists (
    select 1 from public.hubs h where h.id_hub = p_id_hub and h.id_entreprise = v_entreprise and h.actif
  ) then
    raise exception 'Hub invalide pour cette entreprise.';
  end if;

  update public.commandes set id_livreur_ramassage = p_id_livreur, id_hub_prevu = coalesce(p_id_hub, id_hub_prevu)
  where id_commande = p_id_commande;

  for v_c in select c.id_colis from public.colis c
             where c.id_commande = p_id_commande and c.statut = 'CREE' loop
    for r in select * from public.avancer_colis(v_c.id_colis, 'ASSIGNER_RAMASSAGE',
                        null, null, jsonb_build_object('id_livreur', p_id_livreur), p_acteur) loop
      return next r.id_colis;
    end loop;
  end loop;
end;
$$;
grant execute on function public.rpc_assigner_ramassage to authenticated;

-- ----------------------------------------------------------------------------
-- avancer_colis : gestion du hub reel + motif a l'evenement DEMANDER_DEPOT.
-- Le hub reel est transmis via p_details->>'id_hub_reel' (meme mecanisme que
-- p_details->>'id_livreur' pour ASSIGNER_RAMASSAGE) ; le motif via p_motif
-- (deja utilise pour SIGNALER_ECHEC, meme parametre reutilise ici).
--
-- IMPORTANT : cette fonction est reprise de sa version la plus recente
-- (patch 23, PAS la version originale du patch 00) pour ne perdre aucune des
-- verifications ajoutees depuis (paiement PAR_EXPEDITEUR au ramassage,
-- DEMANDER_RECUPERATION_RETOUR, code_retour, id_livreur_retour...). Une
-- premiere version de ce patch etait repartie par erreur de la version
-- d'origine et a ete corrigee avant livraison (testee, l'erreur aurait ccasse
-- la verification d'assignation des retours).
-- ----------------------------------------------------------------------------
create or replace function public.avancer_colis(
  p_id_colis text,
  p_evenement text,
  p_code text default null,
  p_motif text default null,
  p_details jsonb default '{}'::jsonb,
  p_acteur uuid default null
) returns table (id_colis text, statut text)
language plpgsql security definer set search_path = public as $$
declare
  v_acteur uuid := public.acteur_effectif(p_acteur);
  v_profil record;
  v_colis record;
  v_commande record;
  v_transition record;
  v_role_ok boolean;
  v_nouveau_code_retour text;
  v_token_retour uuid;
  v_id_hub_reel uuid;
begin
  select * into v_profil from public.profil_de(v_acteur);
  if v_profil.id_utilisateur is null or not v_profil.actif then
    raise exception 'Acteur inconnu ou inactif.';
  end if;

  select * into v_colis from public.colis c where c.id_colis = p_id_colis for update;
  if v_colis.id_colis is null then
    raise exception 'Colis introuvable.';
  end if;

  if v_colis.id_entreprise is distinct from v_profil.id_entreprise
     and v_profil.role <> 'super_admin' then
    raise exception 'Colis hors de votre entreprise.';
  end if;

  select * into v_commande from public.commandes cmd where cmd.id_commande = v_colis.id_commande;

  select * into v_transition from public.transitions_colis t
  where t.statut_depart = v_colis.statut and t.evenement = p_evenement;
  if v_transition.evenement is null then
    raise exception 'Transition interdite : % depuis %.', p_evenement, v_colis.statut;
  end if;

  v_role_ok := v_profil.role = any(v_transition.roles_autorises)
            or v_profil.role in ('admin','super_admin');
  if not v_role_ok then
    raise exception 'Role % non autorise pour %.', v_profil.role, p_evenement;
  end if;

  -- Conditions specifiques par evenement -------------------------------------
  if p_evenement = 'VALIDER_RAMASSAGE' then
    if v_commande.id_livreur_ramassage is distinct from v_acteur
       and v_profil.role = 'livreur' then
      raise exception 'Ce ramassage ne vous est pas assigne.';
    end if;
    if upper(coalesce(p_code, '')) <> upper(v_commande.code_ramassage) then
      raise exception 'Code ramassage incorrect.';
    end if;
    if v_commande.mode_paiement = 'PAR_EXPEDITEUR'
       and not exists (select 1 from public.paiements p
                       where p.id_colis = v_colis.id_colis and p.statut = 'PAYE'
                         and p.payeur = 'EXPEDITEUR') then
      raise exception 'Paiement (expediteur) requis avant de valider le ramassage.';
    end if;
  end if;

  if p_evenement = 'DEMANDER_DEPOT' then
    v_id_hub_reel := nullif(p_details->>'id_hub_reel', '')::uuid;
    if v_id_hub_reel is not null and not exists (
      select 1 from public.hubs h where h.id_hub = v_id_hub_reel and h.id_entreprise = v_colis.id_entreprise and h.actif
    ) then
      raise exception 'Hub invalide pour cette entreprise.';
    end if;
    -- Motif exige UNIQUEMENT si un hub reel est precise ET qu'il differe du
    -- hub prevu -- jamais impose pour le cas courant (depot au bon hub, ou
    -- entreprise qui n'utilise pas encore la fonctionnalite multi-hub).
    if v_id_hub_reel is not null and v_commande.id_hub_prevu is not null
       and v_id_hub_reel <> v_commande.id_hub_prevu and coalesce(trim(p_motif), '') = '' then
      raise exception 'Precise la raison du depot dans un autre hub.';
    end if;
  end if;

  if p_evenement = 'DEMANDER_RECUPERATION' then
    if v_colis.id_lot is null then
      raise exception 'Colis hors lot.';
    end if;
    if not exists (select 1 from public.lots_livraison l
                   where l.id_lot = v_colis.id_lot and l.id_livreur = v_acteur) then
      raise exception 'Ce lot ne vous est pas assigne.';
    end if;
  end if;

  if p_evenement = 'DEMANDER_RECUPERATION_RETOUR' then
    if v_colis.id_livreur_retour is distinct from v_acteur then
      raise exception 'Ce retour ne vous est pas assigne.';
    end if;
  end if;

  if p_evenement = 'VALIDER_LIVRAISON' then
    if upper(coalesce(p_code, '')) <> upper(v_colis.code_livraison) then
      raise exception 'Code livraison incorrect.';
    end if;
    if v_commande.mode_paiement = 'A_LA_LIVRAISON'
       and not exists (select 1 from public.paiements p
                       where p.id_colis = v_colis.id_colis and p.statut = 'PAYE') then
      raise exception 'Paiement requis avant la remise du colis.';
    end if;
  end if;

  if p_evenement = 'SIGNALER_ECHEC' then
    if coalesce(p_motif, '') not in
       ('DESTINATAIRE_ABSENT','INJOIGNABLE','ADRESSE_INTROUVABLE','ANNULATION_CLIENT','REFUS_COLIS','AUTRE') then
      raise exception 'Motif d''echec invalide ou manquant.';
    end if;
  end if;

  if p_evenement = 'VALIDER_REMISE_EXPEDITEUR' then
    if v_colis.code_retour is null then
      raise exception 'Aucun code de retour genere pour ce colis. Contacte un agent.';
    end if;
    if upper(coalesce(p_code, '')) <> upper(v_colis.code_retour) then
      raise exception 'Code de retour incorrect.';
    end if;
    if v_commande.mode_paiement in ('A_LA_LIVRAISON','PAR_EXPEDITEUR')
       and not exists (select 1 from public.paiements p
                       where p.id_colis = v_colis.id_colis and p.statut = 'PAYE'
                         and p.payeur = 'EXPEDITEUR') then
      raise exception 'Paiement (expediteur) requis avant la remise finale.';
    end if;
  end if;

  -- Application ----------------------------------------------------------------
  if p_evenement = 'VALIDER_RETOUR_EXPEDITEUR' then
    v_nouveau_code_retour := public.generer_code();
  end if;

  update public.colis c set
    statut = v_transition.statut_arrivee,
    motif_retour = case when p_evenement = 'SIGNALER_ECHEC' then p_motif else c.motif_retour end,
    id_lot = case when p_evenement = 'RETIRER_DU_LOT' then null else c.id_lot end,
    code_retour = case when p_evenement = 'VALIDER_RETOUR_EXPEDITEUR' then v_nouveau_code_retour else c.code_retour end,
    id_livreur_retour = case
      when p_evenement = 'ASSIGNER_RETOUR' then nullif(p_details->>'id_livreur','')::uuid
      else c.id_livreur_retour
    end,
    id_hub_reel = case when p_evenement = 'DEMANDER_DEPOT' then coalesce(v_id_hub_reel, c.id_hub_reel) else c.id_hub_reel end,
    motif_hub_different = case
      when p_evenement = 'DEMANDER_DEPOT' and v_id_hub_reel is not null
           and v_commande.id_hub_prevu is not null and v_id_hub_reel <> v_commande.id_hub_prevu
        then p_motif
      when p_evenement = 'DEMANDER_DEPOT' then null
      else c.motif_hub_different
    end
  where c.id_colis = p_id_colis;

  if p_evenement = 'VALIDER_RETOUR_EXPEDITEUR' then
    insert into public.liens_partage (id_entreprise, type, id_colis)
    values (v_colis.id_entreprise, 'CODE_RETOUR', p_id_colis)
    returning token into v_token_retour;
  end if;

  insert into public.evenements_colis
    (id_entreprise, id_colis, evenement, statut_avant, statut_apres, acteur, role_acteur, motif, details)
  values
    (v_colis.id_entreprise, p_id_colis, p_evenement, v_colis.statut,
     v_transition.statut_arrivee, v_acteur, v_profil.role, p_motif, coalesce(p_details, '{}'::jsonb));

  return query select p_id_colis, v_transition.statut_arrivee;
end;
$$;
grant execute on function public.avancer_colis to authenticated;

-- ----------------------------------------------------------------------------
-- v_missions_livreur : ajoute le hub prevu (repris de sa version la plus
-- recente, patch 28 -- meme precaution que pour avancer_colis).
-- ----------------------------------------------------------------------------
create or replace view public.v_missions_livreur
with (security_invoker = true) as
select
  c.id_colis, c.id_entreprise, c.statut, c.id_commande, c.id_lot,
  cmd.expediteur_nom, cmd.expediteur_tel, cmd.expediteur_adresse, cmd.gps_expediteur,
  cmd.mode_paiement,
  c.destinataire_nom, c.destinataire_tel, c.destinataire_adresse, c.gps_destinataire,
  c.code_zone, c.montant_livraison, c.motif_retour,
  case
    when c.statut in ('A_RAMASSER') then 'A_RAMASSER'
    when c.statut in ('RAMASSE','DEPOT_DEMANDE','RETOUR_EN_COURS','RETOUR_DEMANDE') then 'A_DEPOSER'
    when c.statut in ('EN_LOT','RECUP_DEMANDEE','RETOUR_ASSIGNE','RETOUR_RECUP_DEMANDEE') then 'AU_HUB'
    when c.statut in ('EN_TOURNEE') then 'A_LIVRER'
    when c.statut in ('EN_RETOUR') then 'RETOURS'
  end as onglet,
  coalesce(l.id_livreur, c.id_livreur_retour, cmd.id_livreur_ramassage) as id_livreur,
  exists (select 1 from public.paiements p
          where p.id_colis = c.id_colis and p.statut = 'PAYE') as paye,
  exists (select 1 from public.paiements p
          where p.id_colis = c.id_colis and p.statut = 'PAYE' and p.payeur = 'EXPEDITEUR') as paye_par_expediteur,
  cmd.id_hub_prevu
from public.colis c
join public.commandes cmd on cmd.id_commande = c.id_commande
left join public.lots_livraison l on l.id_lot = c.id_lot
where c.statut not in ('CREE','AU_HUB','A_RETOURNER','RETOUR_RECU','LIVRE','RETOURNE','ANNULE');

grant select on public.v_missions_livreur to authenticated;

-- Le livreur a besoin de voir la liste des hubs de son entreprise pour
-- choisir celui du depot -- select seul, deja couvert par sel_hubs plus haut.

commit;

select 'fix_36_ok' as status;
