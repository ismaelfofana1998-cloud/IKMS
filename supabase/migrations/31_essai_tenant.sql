-- ============================================================================
-- 31 - Essai d'une semaine à la création d'une entreprise tenant
-- A executer apres 30_decision_retour_atomique.sql.
-- ============================================================================
--
-- "Des la creation de son compte, son espace est cree pour un test d'une
-- semaine." Ajoute une date de fin d'essai, fixee automatiquement a J+7 des
-- la creation -- que ce soit via l'inscription en libre-service ou via le
-- panneau super-admin (les deux passent par une insertion dans entreprises,
-- couverte par la valeur par defaut de la colonne : aucun changement cote
-- fonctions necessaire).
-- ============================================================================

begin;

alter table public.entreprises
  add column if not exists essai_expire_le timestamptz not null default (now() + interval '7 days');

-- Entreprises deja existantes avant ce patch : ne pas leur couper l'acces
-- retroactivement avec un essai deja expire -- on les considere en dehors
-- du systeme d'essai (valeur nulle = pas de limite d'essai a surveiller).
-- IMPORTANT : la contrainte NOT NULL doit etre retiree AVANT d'ecrire des
-- NULL, jamais apres (bug de la premiere version de ce patch, corrige ici).
alter table public.entreprises alter column essai_expire_le drop not null;
update public.entreprises set essai_expire_le = null where cree_le < now() - interval '1 minute';

-- Expose son propre statut d'essai a n'importe quel membre de l'entreprise,
-- sans avoir a elargir l'acces a la table entreprises elle-meme.
create or replace function public.rpc_mon_essai() returns table(essai_expire_le timestamptz, jours_restants integer)
language sql stable security definer set search_path = public as $$
  select e.essai_expire_le,
    case when e.essai_expire_le is null then null
         else greatest(0, ceil(extract(epoch from (e.essai_expire_le - now())) / 86400)::int)
    end
  from public.entreprises e
  where e.id_entreprise = public.entreprise_de();
$$;
grant execute on function public.rpc_mon_essai to authenticated;

commit;

select 'fix_31_ok' as status;
