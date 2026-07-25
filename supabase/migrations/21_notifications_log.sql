-- ============================================================================
-- 21 - Notifications automatiques (SMS) : table de log + garde-fous
-- A executer apres 20_onboarding_entreprises.sql.
-- ============================================================================
--
-- Cette table sert de journal ET de verrou anti-doublon/anti-abus : la
-- fonction Edge "notifier-sms" (voir phase4-pages-publiques/supabase/functions)
-- insere une ligne ICI avant d'envoyer, avec une contrainte unique sur
-- (id_reference, evenement). Consequence :
--   - un meme evenement ne peut jamais etre envoye deux fois pour la meme
--     commande/le meme colis (protection contre un double-clic ou un appel
--     reseau reessaye) ;
--   - un exploitant malveillant qui devinerait des id_commande valides ne
--     pourrait jamais spammer un client avec la MEME notification en boucle,
--     puisque la deuxieme tentative echoue simplement sur la contrainte.
-- ============================================================================

begin;

create table if not exists public.notifications_log (
  id bigint generated always as identity primary key,
  id_entreprise uuid not null references public.entreprises(id_entreprise),
  id_reference text not null,             -- id_commande ou id_colis concerne
  evenement text not null check (evenement in (
    'COMMANDE_CREEE','COLIS_RAMASSE','COLIS_EN_TOURNEE','COLIS_LIVRE','COLIS_RETOUR'
  )),
  telephone text not null,
  statut text not null default 'ENVOYE' check (statut in ('ENVOYE','ECHEC')),
  fournisseur text,
  erreur text,
  cree_le timestamptz not null default now(),
  unique (id_reference, evenement)
);
create index if not exists idx_notifications_entreprise on public.notifications_log(id_entreprise);

alter table public.notifications_log enable row level security;

-- Lecture seule pour l'entreprise concernee (historique/support) ; l'ecriture
-- se fait exclusivement via la fonction Edge avec la cle service_role, qui
-- contourne la RLS -- aucune policy d'ecriture n'est donc necessaire ni
-- souhaitable ici (empeche un client d'inserer directement une fausse ligne
-- "ENVOYE" ou de contourner la contrainte anti-doublon depuis le navigateur).
create policy sel_notifications on public.notifications_log for select using (
  id_entreprise = public.entreprise_de() or public.est_super_admin());

commit;

select 'fix_21_ok' as status;
