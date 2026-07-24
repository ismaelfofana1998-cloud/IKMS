// Fonction Edge : inscrire-entreprise
//
// Inscription libre-service : une société prospect arrive sur la page
// publique d'inscription, remplit le formulaire, et cette fonction cree
// directement son entreprise + son premier compte administrateur — sans
// intervention du super-admin (contrairement au panneau "Entreprises
// clientes" de plateforme.html, reserve a un usage manuel/assiste).
//
// SECURITE : contrairement a creer-utilisateur, cette fonction est appelee
// SANS session (l'appelant n'existe pas encore) donc ne peut pas s'appuyer
// sur la RLS ou un profil appelant pour se proteger — toute la validation
// est ici, cote fonction, avec la cle service_role. Limites actuelles
// (a renforcer avant un lancement public a grande echelle) : pas de
// verification d'email, pas de captcha, pas de rate limiting dedie au-dela
// de celui de Supabase par defaut. A minima, ajouter une verification
// d'email (lien de confirmation) avant d'ouvrir plus largement.
//
// Deploiement :
//   supabase functions deploy inscrire-entreprise

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
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return reponseJson({ error: "Configuration serveur incomplete." }, 500);
  }

  let corps;
  try { corps = await req.json(); } catch { return reponseJson({ error: "Corps de requete invalide." }, 400); }

  const codeEntreprise = String(corps.code_entreprise || "").trim().toUpperCase();
  const nomEntreprise = String(corps.nom_entreprise || "").trim();
  const adminNom = String(corps.admin_nom || "").trim();
  const adminEmail = String(corps.admin_email || "").trim().toLowerCase();
  const adminTelephone = String(corps.admin_telephone || "").trim() || null;
  const adminPassword = String(corps.admin_password || "");

  if (!codeEntreprise || !nomEntreprise || !adminNom || !adminEmail || !adminPassword) {
    return reponseJson({ error: "Tous les champs sont obligatoires (sauf téléphone)." }, 400);
  }
  if (!/^[A-Z0-9_-]{3,30}$/.test(codeEntreprise)) {
    return reponseJson({ error: "Le code entreprise doit faire 3 à 30 caractères (lettres, chiffres, - ou _)." }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    return reponseJson({ error: "Email invalide." }, 400);
  }
  if (adminPassword.length < 8) {
    return reponseJson({ error: "Le mot de passe doit contenir au moins 8 caractères." }, 400);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: existante } = await supabaseAdmin
    .from("entreprises").select("id_entreprise").eq("code_entreprise", codeEntreprise).maybeSingle();
  if (existante) {
    return reponseJson({ error: `Le code "${codeEntreprise}" est déjà utilisé. Choisis-en un autre.` }, 409);
  }

  const { data: entreprise, error: erreurEntreprise } = await supabaseAdmin
    .from("entreprises")
    .insert({ code_entreprise: codeEntreprise, nom: nomEntreprise })
    .select("id_entreprise, code_entreprise")
    .single();
  if (erreurEntreprise) {
    return reponseJson({ error: `Création de l'entreprise impossible : ${erreurEntreprise.message}` }, 500);
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: adminEmail, password: adminPassword, email_confirm: true,
    user_metadata: { nom: adminNom, telephone: adminTelephone }
  });
  if (authError || !authData?.user?.id) {
    // L'entreprise a ete creee mais pas l'admin : on nettoie pour ne pas
    // laisser une entreprise fantome sans aucun utilisateur.
    await supabaseAdmin.from("entreprises").delete().eq("id_entreprise", entreprise.id_entreprise);
    return reponseJson({ error: authError?.message || "Compte administrateur non créé." }, 400);
  }

  const { error: insertError } = await supabaseAdmin.from("utilisateurs").insert({
    id_utilisateur: authData.user.id,
    id_entreprise: entreprise.id_entreprise,
    nom: adminNom, telephone: adminTelephone, email: adminEmail, role: "admin",
    salaire_jour: 0, charges_jour: 0, actif: true
  });
  if (insertError) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    await supabaseAdmin.from("entreprises").delete().eq("id_entreprise", entreprise.id_entreprise);
    return reponseJson({ error: `Compte administrateur non créé : ${insertError.message}` }, 500);
  }

  return reponseJson({ data: { code_entreprise: entreprise.code_entreprise } });
});
