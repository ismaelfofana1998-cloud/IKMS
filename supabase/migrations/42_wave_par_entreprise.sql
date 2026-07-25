-- ============================================================================
-- 42 - Configuration Wave PAR ENTREPRISE (pas une clé globale de plateforme)
-- A executer apres 41_correctif_portefeuille_client_pro.sql.
--
-- Corrige un vrai trou d'architecture, signale a juste titre par le
-- client : les fonctions Wave utilisaient UNE SEULE cle API/signature,
-- partagee par toutes les entreprises de la plateforme. Sur un SaaS
-- multi-tenant, chaque entreprise doit recevoir l'argent sur SON PROPRE
-- compte Wave -- il faut donc une cle API et une cle de signature par
-- entreprise, pas une cle globale.
--
-- Conception :
--   - Les cles de chaque entreprise sont chiffrees en base (pgcrypto,
--     chiffrement symetrique) avec une cle de chiffrement "d'enveloppe"
--     qui elle-meme ne vit JAMAIS en base -- uniquement comme secret
--     Supabase (variable d'environnement), passee en parametre a chaque
--     appel depuis une fonction Edge. Meme en cas de fuite complete de la
--     base de donnees, les cles Wave de chaque entreprise restent
--     illisibles sans cette cle d'enveloppe separee.
--   - Les fonctions qui dechiffrent (lecture des vraies cles) sont
--     reservees a `service_role` -- jamais accessibles a un utilisateur
--     authentifie normal, meme admin. Un admin ne peut qu'ECRIRE ses
--     propres cles (jamais les relire ensuite), exactement comme un champ
--     de mot de passe.
--   - Chaque entreprise recoit aussi un jeton de webhook unique et
--     imprevisible, utilise dans l'URL que Wave doit appeler -- ca permet
--     de savoir IMMEDIATEMENT quelle entreprise (et donc quelle cle de
--     signature) utiliser pour verifier un evenement entrant, sans avoir
--     a deviner ou essayer plusieurs cles.
-- ============================================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.entreprises_paiement_config (
  id_entreprise uuid primary key references public.entreprises(id_entreprise),
  wave_api_key_chiffre bytea,
  wave_signing_secret_chiffre bytea,
  jeton_webhook uuid not null default gen_random_uuid(),
  actif boolean not null default true,
  maj_le timestamptz not null default now()
);

alter table public.entreprises_paiement_config enable row level security;

-- Aucune policy de lecture directe des colonnes chiffrees pour qui que ce
-- soit -- meme un admin ne passe que par les RPC ci-dessous, qui ne
-- renvoient jamais le contenu en clair sauf a service_role.
create policy sel_config_paiement_admin on public.entreprises_paiement_config for select
using (id_entreprise = public.entreprise_de() and public.jwt_role() in ('admin','super_admin'));

grant select on public.entreprises_paiement_config to authenticated;

-- ----------------------------------------------------------------------------
-- Ecriture des cles (admin de sa propre entreprise uniquement). La cle
-- d'enveloppe (p_cle_enveloppe) est fournie par la fonction Edge appelante
-- -- jamais tapee ni vue par le navigateur de l'admin.
-- ----------------------------------------------------------------------------
create or replace function public.rpc_definir_paiement_wave_interne(
  p_id_entreprise uuid, p_api_key text, p_signing_secret text, p_cle_enveloppe text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_jeton uuid;
begin
  insert into public.entreprises_paiement_config (id_entreprise, wave_api_key_chiffre, wave_signing_secret_chiffre)
  values (
    p_id_entreprise,
    pgp_sym_encrypt(p_api_key, p_cle_enveloppe),
    pgp_sym_encrypt(p_signing_secret, p_cle_enveloppe)
  )
  on conflict (id_entreprise) do update
    set wave_api_key_chiffre = excluded.wave_api_key_chiffre,
        wave_signing_secret_chiffre = excluded.wave_signing_secret_chiffre,
        maj_le = now()
  returning jeton_webhook into v_jeton;
  return v_jeton;
end;
$$;
-- Reserve a service_role : jamais accessible via PostgREST a un utilisateur
-- normal, meme avec le bon role applicatif -- seule une fonction Edge,
-- avec la cle de service ET la cle d'enveloppe, peut l'appeler.
revoke all on function public.rpc_definir_paiement_wave_interne from public, authenticated, anon;

-- Etat visible par un admin : configure ou non, et l'URL de webhook a
-- enregistrer chez Wave -- jamais les cles elles-memes.
create or replace function public.rpc_etat_paiement_wave()
returns table (configure boolean, jeton_webhook uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_entreprise uuid := public.entreprise_de();
begin
  if public.jwt_role() not in ('admin','super_admin') then
    raise exception 'Reserve a un administrateur.';
  end if;
  return query
    select (c.wave_api_key_chiffre is not null and c.wave_signing_secret_chiffre is not null), c.jeton_webhook
    from public.entreprises_paiement_config c where c.id_entreprise = v_entreprise;
  if not found then
    return query select false, null::uuid;
  end if;
end;
$$;
grant execute on function public.rpc_etat_paiement_wave to authenticated;

-- ----------------------------------------------------------------------------
-- Lecture dechiffree : reservee a service_role (fonctions Edge uniquement).
-- ----------------------------------------------------------------------------
create or replace function public.interne_lire_paiement_wave(p_id_entreprise uuid, p_cle_enveloppe text)
returns table (api_key text, signing_secret text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select pgp_sym_decrypt(c.wave_api_key_chiffre, p_cle_enveloppe),
           pgp_sym_decrypt(c.wave_signing_secret_chiffre, p_cle_enveloppe)
    from public.entreprises_paiement_config c
    where c.id_entreprise = p_id_entreprise and c.actif;
end;
$$;
revoke all on function public.interne_lire_paiement_wave from public, authenticated, anon;

-- Resout un jeton de webhook -> entreprise + cles dechiffrees, en un seul
-- appel (le webhook Wave n'a que le jeton dans son URL, jamais l'entreprise
-- directement).
create or replace function public.interne_paiement_wave_par_jeton(p_jeton uuid, p_cle_enveloppe text)
returns table (id_entreprise uuid, api_key text, signing_secret text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select c.id_entreprise,
           pgp_sym_decrypt(c.wave_api_key_chiffre, p_cle_enveloppe),
           pgp_sym_decrypt(c.wave_signing_secret_chiffre, p_cle_enveloppe)
    from public.entreprises_paiement_config c
    where c.jeton_webhook = p_jeton and c.actif;
end;
$$;
revoke all on function public.interne_paiement_wave_par_jeton from public, authenticated, anon;

commit;

select 'fix_42_ok' as status;
