-- ============================================================================
-- 33 - Gestion de l'abonnement/essai par le super-admin
-- A executer apres 32_nettoyage_ancienne_table_compteurs.sql.
-- ============================================================================

begin;

create or replace view public.v_entreprises_apercu
with (security_invoker = true) as
select
  e.id_entreprise, e.code_entreprise, e.nom, e.actif, e.cree_le,
  (select count(*) from public.utilisateurs u where u.id_entreprise = e.id_entreprise and u.actif) as nb_utilisateurs,
  (select count(*) from public.commandes c where c.id_entreprise = e.id_entreprise) as nb_commandes,
  e.essai_expire_le
from public.entreprises e;

grant select on public.v_entreprises_apercu to authenticated;

-- Reserve au super-admin (seul a pouvoir decider des abonnements) : fixe ou
-- prolonge l'essai d'une entreprise, ou le supprime (p_jours null = plan
-- payant actif, plus de limite d'essai a surveiller).
create or replace function public.rpc_definir_essai(p_id_entreprise uuid, p_jours integer default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- est_super_admin() peut renvoyer NULL (pas seulement false) quand les
  -- claims JWT ne sont pas encore renseignes -- "if not null" ne se
  -- declenche jamais en PL/pgSQL (NULL n'est ni vrai ni faux), d'ou le
  -- coalesce explicite pour ne jamais laisser passer ce cas par erreur.
  if not coalesce(public.est_super_admin(), false) then
    raise exception 'Reserve au super-admin.';
  end if;
  update public.entreprises
  set essai_expire_le = case when p_jours is null then null else now() + make_interval(days => p_jours) end
  where id_entreprise = p_id_entreprise;
end;
$$;
grant execute on function public.rpc_definir_essai to authenticated;

commit;

select 'fix_33_ok' as status;
