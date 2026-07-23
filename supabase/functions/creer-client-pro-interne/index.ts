// Fonction Edge : creer-client-pro-interne
//
// PROBLEME CORRIGE (signale par le client) : la creation d'un client pro
// depuis le panneau centrale ne creait qu'un enregistrement metier, sans
// compte d'authentification -- le client ne pouvait donc jamais se
// connecter a son espace, sauf a s'inscrire une SECONDE fois via
// client-inscription.html, ce qui aurait cree un compte disjoint du
// premier. Cette fonction fusionne les deux : la creation interne cree
// desormais le meme type de compte que l'auto-inscription (email
// synthetique + mot de passe), et renvoie un mot de passe genere pour que
// l'agent puisse le transmettre au client (lien/texte a partager).
//
// Reserve aux agents/admins (verifie ici, jamais suppose cote client).
//
// Deploiement :
//   supabase functions deploy creer-client-pro-interne

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function reponseJson(corps, status = 200) {
  return new Response(JSON.stringify(corps), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

// Doit rester identique à emailSynthetique() dans client-connexion.js et
// inscrire-client-pro/index.ts — sinon un client créé ici ne pourrait pas
// se connecter avec le même calcul côté page de connexion.
function emailSynthetique(codeEntreprise, telephone) {
  return `client-${codeEntreprise}-${telephone}@clients.ikigai.internal`.toLowerCase();
}

function genererMotDePasse() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let mdp = "";
  for (let i = 0; i < 10; i++) mdp += alphabet[Math.floor(Math.random() * alphabet.length)];
  return mdp;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return reponseJson({ error: "Methode non autorisee." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return reponseJson({ error: "Configuration serveur incomplete." }, 500);
  }

  const autorisation = req.headers.get("Authorization") || "";
  if (!autorisation) return reponseJson({ error: "Authentification requise." }, 401);

  let corps;
  try { corps = await req.json(); } catch { return reponseJson({ error: "Corps de requete invalide." }, 400); }

  const nom = String(corps.nom || "").trim();
  const telephoneBrut = String(corps.telephone || "").trim();
  const telephone = telephoneBrut.replace(/[\s.\-]/g, "").replace(/^(\+225|00225|225)/, "");
  const email = String(corps.email || "").trim() || null;
  const adresse = String(corps.adresse || "").trim() || null;

  if (!nom || !telephone) return reponseJson({ error: "Nom et téléphone sont obligatoires." }, 400);
  if (!/^0\d{9}$/.test(telephone)) {
    return reponseJson({ error: "Numéro invalide : 10 chiffres attendus (ex. 07 00 00 00 00)." }, 400);
  }

  // Verifie que l'appelant est bien un agent/admin de SON entreprise (jamais
  // suppose) : client anon avec le JWT de l'appelant pour lire son propre profil.
  const supabaseAppelant = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: autorisation } } });
  const { data: userData } = await supabaseAppelant.auth.getUser();
  if (!userData?.user?.id) return reponseJson({ error: "Session invalide." }, 401);

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: profilAppelant } = await supabaseAdmin
    .from("utilisateurs").select("id_entreprise, role, actif").eq("id_utilisateur", userData.user.id).maybeSingle();
  if (!profilAppelant?.actif || !["agent", "admin", "super_admin"].includes(profilAppelant.role)) {
    return reponseJson({ error: "Non autorisé à créer un client pro." }, 403);
  }

  const { data: entreprise } = await supabaseAdmin
    .from("entreprises").select("id_entreprise, code_entreprise").eq("id_entreprise", profilAppelant.id_entreprise).maybeSingle();
  if (!entreprise) return reponseJson({ error: "Entreprise introuvable." }, 404);

  const { data: existant } = await supabaseAdmin
    .from("clients_pro").select("id_client").eq("id_entreprise", entreprise.id_entreprise).eq("telephone", telephone).maybeSingle();
  if (existant) return reponseJson({ error: "Un client existe déjà avec ce numéro." }, 409);

  const motDePasse = genererMotDePasse();
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: emailSynthetique(entreprise.code_entreprise, telephone),
    password: motDePasse, email_confirm: true,
    user_metadata: { nom, telephone, type: "client_pro" }
  });
  if (authError || !authData?.user?.id) {
    return reponseJson({ error: authError?.message || "Compte non créé." }, 400);
  }

  const { error: insertError } = await supabaseAdmin.from("clients_pro").insert({
    id_entreprise: entreprise.id_entreprise, nom, telephone, email, adresse, id_auth: authData.user.id
  });
  if (insertError) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    return reponseJson({ error: `Compte client non créé : ${insertError.message}` }, 500);
  }

  return reponseJson({ data: { telephone, mot_de_passe: motDePasse, code_entreprise: entreprise.code_entreprise } });
});
