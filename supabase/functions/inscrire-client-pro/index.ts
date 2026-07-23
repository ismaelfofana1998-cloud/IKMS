// Fonction Edge : inscrire-client-pro
//
// Inscription en libre-service d'un CLIENT PRO — un client régulier d'une
// entreprise de livraison (ex. une boutique qui expédie via IKIGAI
// Livraison), PAS une entreprise cliente du SaaS (voir inscrire-entreprise
// pour ça, un objet totalement différent malgré le nom proche).
//
// Le client choisit un mot de passe, mais Supabase Auth exige un email pour
// s'authentifier : on génère un email synthétique dérivé du téléphone et du
// code entreprise (jamais affiché, jamais communiqué — seul le téléphone
// sert d'identifiant côté client). Le format doit être identique entre
// l'inscription (ici) et la connexion (client-connexion.js) pour que les
// deux se retrouvent sur le même compte.
//
// Deploiement :
//   supabase functions deploy inscrire-client-pro

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function reponseJson(corps, status = 200) {
  return new Response(JSON.stringify(corps), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

// Doit rester identique à emailSynthetique() dans client-connexion.js.
function emailSynthetique(codeEntreprise, telephone) {
  return `client-${codeEntreprise}-${telephone}@clients.ikigai.internal`.toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return reponseJson({ error: "Methode non autorisee." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return reponseJson({ error: "Configuration serveur incomplete." }, 500);
  }

  let corps;
  try { corps = await req.json(); } catch { return reponseJson({ error: "Corps de requete invalide." }, 400); }

  const codeEntreprise = String(corps.code_entreprise || "").trim().toUpperCase();
  const nom = String(corps.nom || "").trim();
  const telephoneBrut = String(corps.telephone || "").trim();
  const telephone = telephoneBrut.replace(/[\s.\-]/g, "").replace(/^(\+225|00225|225)/, "");
  const email = String(corps.email || "").trim() || null;
  const adresse = String(corps.adresse || "").trim() || null;
  const password = String(corps.password || "");

  if (!codeEntreprise || !nom || !telephone || !password) {
    return reponseJson({ error: "Nom, téléphone et mot de passe sont obligatoires." }, 400);
  }
  if (!/^0\d{9}$/.test(telephone)) {
    return reponseJson({ error: "Numéro invalide : 10 chiffres attendus (ex. 07 00 00 00 00)." }, 400);
  }
  if (password.length < 8) {
    return reponseJson({ error: "Le mot de passe doit contenir au moins 8 caractères." }, 400);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: entreprise } = await supabaseAdmin
    .from("entreprises").select("id_entreprise").eq("code_entreprise", codeEntreprise).eq("actif", true).maybeSingle();
  if (!entreprise) {
    return reponseJson({ error: `Entreprise "${codeEntreprise}" introuvable.` }, 404);
  }

  const { data: existant } = await supabaseAdmin
    .from("clients_pro").select("id_client").eq("id_entreprise", entreprise.id_entreprise).eq("telephone", telephone).maybeSingle();
  if (existant) {
    return reponseJson({ error: "Un compte existe déjà avec ce numéro pour cette entreprise. Connecte-toi plutôt." }, 409);
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: emailSynthetique(codeEntreprise, telephone),
    password,
    email_confirm: true,
    user_metadata: { nom, telephone, type: "client_pro" }
  });
  if (authError || !authData?.user?.id) {
    return reponseJson({ error: authError?.message || "Compte non créé." }, 400);
  }

  const { error: insertError } = await supabaseAdmin.from("clients_pro").insert({
    id_entreprise: entreprise.id_entreprise, nom, telephone, email, adresse,
    id_auth: authData.user.id
    // facturation_activee : PAS ici -- reste a sa valeur par defaut (false).
    // Un compte qui s'inscrit lui-meme n'a pas la facturation differee tant
    // qu'un administrateur ne l'active pas explicitement (confiance etablie
    // apres un historique de commandes reglees normalement).
  });
  if (insertError) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    return reponseJson({ error: `Compte client non créé : ${insertError.message}` }, 500);
  }

  return reponseJson({ data: { ok: true } });
});
