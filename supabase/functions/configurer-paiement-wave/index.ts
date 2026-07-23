// Fonction Edge : configurer-paiement-wave
//
// Appelee depuis l'onglet "Paiements" de l'espace centrale, par un admin
// qui enregistre SA PROPRE cle API Wave et SA PROPRE cle de signature (son
// propre compte Wave Business, celui de son entreprise -- jamais une cle
// partagee par toute la plateforme).
//
// Les cles sont chiffrees avant d'etre stockees (voir
// 42_wave_par_entreprise.sql) -- cette fonction ne les stocke jamais en
// clair et ne les renvoie plus jamais ensuite : une fois enregistrees,
// elles ne sont plus consultables, seulement remplaçables (comme un mot de
// passe). Renvoie l'URL de webhook a enregistrer chez Wave.
//
// Secrets requis : CHIFFREMENT_PAIEMENTS_CLE (le meme que wave-initier-
// paiement et wave-webhook).
// Deploiement : supabase functions deploy configurer-paiement-wave

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function reponseJson(corps, status = 200) {
  return new Response(JSON.stringify(corps), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return reponseJson({ error: "Methode non autorisee." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const CLE_ENVELOPPE = Deno.env.get("CHIFFREMENT_PAIEMENTS_CLE");
  const APP_BASE_URL = Deno.env.get("SUPABASE_URL"); // base de l'URL du webhook = ce meme projet

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY || !CLE_ENVELOPPE) {
    return reponseJson({ error: "Configuration serveur incomplete." }, 500);
  }

  const autorisation = req.headers.get("Authorization") || "";
  if (!autorisation) return reponseJson({ error: "Authentification requise." }, 401);

  let corps;
  try { corps = await req.json(); } catch { return reponseJson({ error: "Corps de requete invalide." }, 400); }
  const apiKey = String(corps.api_key || "").trim();
  const signingSecret = String(corps.signing_secret || "").trim();
  if (!apiKey || !signingSecret) {
    return reponseJson({ error: "Cle API et cle de signature toutes les deux requises." }, 400);
  }

  // Verifie l'appelant via son propre JWT (pas service_role) : il doit
  // etre admin/super_admin de SA propre entreprise -- c'est cette
  // entreprise-la, et seulement elle, qui est configuree par cet appel.
  const supabaseAppelant = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: autorisation } }
  });
  const { data: { user }, error: userError } = await supabaseAppelant.auth.getUser();
  if (userError || !user) return reponseJson({ error: "Session invalide." }, 401);

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: profil, error: profilError } = await supabaseAdmin
    .from("utilisateurs").select("id_entreprise, role, actif").eq("id_utilisateur", user.id).maybeSingle();
  if (profilError || !profil || !profil.actif || !["admin", "super_admin"].includes(profil.role)) {
    return reponseJson({ error: "Reserve a un administrateur." }, 403);
  }

  const { data: jeton, error: rpcError } = await supabaseAdmin.rpc("rpc_definir_paiement_wave_interne", {
    p_id_entreprise: profil.id_entreprise, p_api_key: apiKey, p_signing_secret: signingSecret, p_cle_enveloppe: CLE_ENVELOPPE
  });
  if (rpcError) return reponseJson({ error: rpcError.message }, 500);

  return reponseJson({
    data: {
      url_webhook: `${APP_BASE_URL}/functions/v1/wave-webhook/${jeton}`
    }
  });
});
