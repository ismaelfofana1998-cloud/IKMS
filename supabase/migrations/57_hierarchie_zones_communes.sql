-- ============================================================================
-- 57 - Hierarchie a deux couches pour les zones : nom_commune (le "gros
-- morceau" affiche au client) + mots_cles (termes de la sous-zone, pour la
-- reconnaissance automatique). A executer apres 56.
--
-- Ne remplace RIEN de l'existant : zones_tarification, zones_tarifs_paires,
-- tarif_zone_zone(), rpc_creer_commande restent inchanges. Chaque zone
-- (ligne de zones_tarification) reste l'unite tarifaire atomique -- ce
-- patch ajoute seulement de quoi la RANGER sous un nom de commune commun et
-- l'IDENTIFIER par plusieurs mots-cles plutot qu'un seul champ description.
--
-- Retro-compatible par construction : nom_commune est retropeuple depuis
-- description (aujourd'hui, chaque zone EST une commune entiere -- donc
-- description contient deja le bon nom de commune). mots_cles vide (defaut)
-- ne change rien au comportement actuel de deviserZone().
-- ============================================================================

begin;

alter table public.zones_tarification
  add column if not exists nom_commune text,
  add column if not exists mots_cles text[] not null default '{}';

update public.zones_tarification
  set nom_commune = description
  where nom_commune is null;

comment on column public.zones_tarification.nom_commune is
  'Le "gros morceau" affiche en premier au client (ex: Yopougon) -- commun a toutes les sous-zones d''une meme commune. Plusieurs lignes peuvent partager le meme nom_commune.';
comment on column public.zones_tarification.mots_cles is
  'Termes qui identifient CETTE sous-zone precisement (ex: Niangon, Niangon Nord) -- vide si la zone couvre la commune entiere sans decoupage.';

-- La RPC publique renvoie desormais nom_commune et mots_cles, pour que le
-- formulaire externe puisse construire le selecteur a deux niveaux.
drop function if exists public.rpc_lister_zones_publiques(text);

create or replace function public.rpc_lister_zones_publiques(p_code_entreprise text)
returns table (code_zone text, description text, nom_commune text, mots_cles text[])
language sql stable security definer set search_path = public as $$
  select z.code_zone, z.description, z.nom_commune, z.mots_cles
  from public.zones_tarification z
  join public.entreprises e on e.id_entreprise = z.id_entreprise
  where e.code_entreprise = upper(trim(p_code_entreprise)) and e.actif and z.actif
  order by z.nom_commune, z.code_zone;
$$;
grant execute on function public.rpc_lister_zones_publiques to anon, authenticated;

commit;

select 'fix_57_ok' as status;
