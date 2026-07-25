-- ============================================================================
-- 58 - Renommage de zones_tarification.description en "secteur"
-- A executer apres 57_hierarchie_zones_communes.sql.
--
-- "description" etait un nom vague, herite de l'epoque ou chaque commune
-- n'avait qu'une seule ligne. Depuis le patch 57, plusieurs lignes peuvent
-- partager le meme nom_commune -- ce champ designe alors precisement le
-- secteur (Niangon, Gesco, Siporex...) a l'interieur de cette commune. Le
-- vocabulaire du schema doit refleter ca directement plutot que de laisser
-- deviner. Un simple renommage de colonne -- aucune donnee ne change,
-- aucune fonction SQL ne referencait ce champ (seul le code applicatif le
-- lisait pour l'affichage), donc rien d'autre a toucher cote base.
-- ============================================================================

begin;

alter table public.zones_tarification rename column description to secteur;

comment on column public.zones_tarification.secteur is
  'Nom du secteur precis a l''interieur de la commune (ex: Niangon) -- ou le nom de la commune elle-meme si cette ligne n''est pas subdivisee.';

drop function if exists public.rpc_lister_zones_publiques(text);

create or replace function public.rpc_lister_zones_publiques(p_code_entreprise text)
returns table (code_zone text, secteur text, nom_commune text, mots_cles text[])
language sql stable security definer set search_path = public as $$
  select z.code_zone, z.secteur, z.nom_commune, z.mots_cles
  from public.zones_tarification z
  join public.entreprises e on e.id_entreprise = z.id_entreprise
  where e.code_entreprise = upper(trim(p_code_entreprise)) and e.actif and z.actif
  order by z.nom_commune, z.code_zone;
$$;
grant execute on function public.rpc_lister_zones_publiques to anon, authenticated;

commit;

select 'fix_58_ok' as status;
