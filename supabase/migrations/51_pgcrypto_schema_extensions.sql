-- ============================================================================
-- 51 - Correctif : pgcrypto est dans le schema "extensions" chez Supabase
-- A executer apres 50_facturation_activee_par_admin.sql.
--
-- Erreur rencontree : "function gen_random_bytes(integer) does not exist"
-- au moment de creer une cle API. Cause : Supabase installe pgcrypto dans
-- le schema "extensions", pas "public", par defaut sur la plupart des
-- projets -- et les fonctions SECURITY DEFINER de ce projet limitent
-- volontairement leur search_path a "public" (bonne pratique de securite,
-- volontaire) ce qui les empeche de voir les fonctions de pgcrypto
-- (gen_random_bytes, digest, pgp_sym_encrypt, pgp_sym_decrypt).
--
-- Touche aussi bien les cles API (patch 46) que le chiffrement Wave par
-- entreprise (patch 42) -- meme cause exacte, corrige les deux ici.
--
-- Le correctif ajoute juste "extensions" au search_path des fonctions
-- concernees (ALTER FUNCTION, pas besoin de les redefinir entierement) --
-- fonctionne que pgcrypto soit installe dans public OU extensions.
-- ============================================================================

begin;

-- Cles API (patch 46)
alter function public.rpc_creer_cle_api(text) set search_path = public, extensions;
alter function public.interne_verifier_cle_api(text) set search_path = public, extensions;

-- Wave par entreprise (patch 42)
alter function public.rpc_definir_paiement_wave_interne(uuid, text, text, text) set search_path = public, extensions;
alter function public.interne_lire_paiement_wave(uuid, text) set search_path = public, extensions;
alter function public.interne_paiement_wave_par_jeton(uuid, text) set search_path = public, extensions;

commit;

select 'fix_51_ok' as status;
