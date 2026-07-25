-- ============================================================================
-- 26 - Correction : collision d'identifiants entre entreprises
-- A executer apres 25_rattachement_client_pro_interne.sql.
-- ============================================================================
--
-- BUG DE FOND (present depuis 00_install_v3.sql, jamais visible tant qu'une
-- seule entreprise ne creait des commandes) : generer_id() incremente un
-- compteur PAR ENTREPRISE (compteurs.id_entreprise, type), donc la premiere
-- commande de CHAQUE nouvelle entreprise s'appelle "CMD-000001" -- mais
-- commandes.id_commande est une cle primaire GLOBALE (partagee par toutes
-- les entreprises). Des que 2 entreprises existent, la 1ere commande de la
-- 2e entreprise entre en collision avec la 1ere commande de la 1ere
-- entreprise : "duplicate key value violates unique constraint
-- commandes_pkey" -- exactement l'erreur remontee.
--
-- CORRECTIF : un seul compteur GLOBAL par type (commande/colis/lot), partage
-- par toutes les entreprises, au lieu d'un compteur par entreprise. Les
-- numeros ne redemarrent plus a 1 pour chaque nouvelle entreprise (consequence
-- cosmetique mineure : la numerotation continue a travers toutes les
-- entreprises) mais l'unicite est desormais garantie par construction, plus
-- besoin de "creer des compteurs" a la main pour une nouvelle entreprise --
-- source du deuxieme message d'erreur (tentative de contournement manuel qui
-- ne fonctionnait de toute facon pas, la vraie cause etant le design meme du
-- compteur, pas une ligne manquante).
-- ============================================================================

begin;

-- Consolide les compteurs existants (un par entreprise) en un seul compteur
-- global par type, en repartant du plus grand numero deja utilise pour ce
-- type -- aucun risque de reutiliser un identifiant deja pris.
create table if not exists public.compteurs_globaux (
  type text primary key,
  valeur bigint not null default 0
);

insert into public.compteurs_globaux (type, valeur)
select type, max(valeur) from public.compteurs group by type
on conflict (type) do update set valeur = greatest(public.compteurs_globaux.valeur, excluded.valeur);

create or replace function public.generer_id(p_entreprise uuid, p_type text, p_prefixe text)
returns text language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.compteurs_globaux (type, valeur) values (p_type, 1)
  on conflict (type) do update set valeur = public.compteurs_globaux.valeur + 1
  returning valeur into v;
  return p_prefixe || '-' || lpad(v::text, 6, '0');
end;
$$;

commit;

select 'fix_26_ok' as status;
