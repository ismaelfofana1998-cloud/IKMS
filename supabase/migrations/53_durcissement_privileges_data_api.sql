-- ============================================================================
-- 53 - Durcissement des privileges Data API par defaut (defense en profondeur)
-- A executer apres 52_alerte_zone_persistee.sql.
--
-- Deux trous de privileges Postgres/Supabase, aucun couvert par la RLS,
-- corriges ici. Inspire des patterns verifies sur IKIGAI Market (marketplace
-- partenaire, meme famille de projets Supabase) :
--
-- 1. TRUNCATE / REFERENCES / TRIGGER sur les tables. La RLS ne filtre que
--    SELECT/INSERT/UPDATE/DELETE -- un TRUNCATE contourne totalement la RLS
--    et vide une table en un coup quel que soit son contenu, un REFERENCES
--    permet de creer une contrainte de cle etrangere pointant vers elle. Les
--    nouveaux projets Supabase accordent des privileges Data API etendus a
--    anon/authenticated par defaut ; ce patch les retire explicitement, sur
--    les tables existantes ET sur toute table future (ALTER DEFAULT
--    PRIVILEGES), pour ne plus dependre d'un oubli a chaque migration.
--
-- 2. EXECUTE sur les fonctions. Contrairement aux tables, PostgreSQL accorde
--    EXECUTE a PUBLIC par defaut a la creation de CHAQUE fonction. Les
--    nombreux "grant execute ... to authenticated" deja presents dans ce
--    projet s'AJOUTENT a ce droit public implicite -- ils ne le remplacent
--    pas. Quelques fonctions sensibles (interne_verifier_cle_api,
--    interne_lire_paiement_wave, interne_paiement_wave_par_jeton) le
--    retirent deja explicitement au cas par cas ; ce patch generalise le
--    reflexe a TOUTES les fonctions existantes du schema public en une
--    seule fois, et fixe le meme comportement pour les fonctions futures.
--    Revoquer EXECUTE de PUBLIC ne touche pas les grants explicites deja
--    accordes a authenticated/anon/service_role : ce sont des entrees
--    d'ACL separees, rien ne change pour les appels legitimes.
--
-- Sans risque de regression identifie :
--   - pgcrypto vit dans le schema "extensions" (patch 51), pas "public" --
--     aucune fonction de chiffrement n'est dans le perimetre revoque ici.
--   - gen_random_uuid() est native (pg_catalog), pas schema public.
--   - aucune colonne de ce projet n'utilise une fonction du schema public
--     comme valeur par defaut (verifie avant d'ecrire ce patch) -- un
--     INSERT direct via Data API ne peut donc pas etre casse par le
--     retrait d'EXECUTE sur les fonctions applicatives.
--   - les triggers (trg_maj_colis, trg_sync_jwt, trg_privileges...)
--     s'executent via le mecanisme de trigger, pas par appel direct : le
--     role qui fait le DML n'a jamais eu besoin d'EXECUTE sur la fonction
--     de trigger, ce patch ne change rien pour eux.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Tables : TRUNCATE / REFERENCES / TRIGGER jamais couverts par la RLS.
-- ----------------------------------------------------------------------------
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Fonctions : EXECUTE accorde a PUBLIC par defaut par Postgres, jamais
-- retire globalement jusqu'ici (seulement au cas par cas sur 3 fonctions).
-- ----------------------------------------------------------------------------
revoke execute on all functions in schema public from public;
alter default privileges in schema public
  revoke execute on functions from public;

-- ----------------------------------------------------------------------------
-- 3. Defense en profondeur sur les fonctions d'identite invoquees DEPUIS des
-- policies RLS et qui relisent elles-memes une table protegee par RLS
-- (entreprise_de() est appelee par la policy sel_utilisateurs sur
-- utilisateurs, et relit utilisateurs -- meme chaine pour client_pro_de()
-- sur clients_pro). Aujourd'hui ca fonctionne parce que le role proprietaire
-- de ces fonctions (le role de migration) a BYPASSRLS -- ce qui est vrai par
-- defaut chez Supabase, mais reste une hypothese implicite sur QUI possede
-- ces fonctions, pas une garantie ecrite dans le code. "set row_security =
-- off" rend cette garantie explicite et portable, quel que soit le
-- proprietaire futur -- comportement inchange en pratique aujourd'hui,
-- simplement plus explicite. Meme correctif applique cote IKIGAI Market
-- (voir marketplace_rls_recursion_fix.sql) pour la meme raison exacte.
-- ----------------------------------------------------------------------------
alter function public.profil_de(uuid) set row_security = off;
alter function public.entreprise_de(uuid) set row_security = off;
alter function public.est_super_admin() set row_security = off;
alter function public.client_pro_de(uuid) set row_security = off;

commit;

select 'fix_53_ok' as status;
