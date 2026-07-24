// Fonction Edge : creer-utilisateur
//
// La creation d'un compte Supabase Auth (auth.admin.createUser) exige la cle
// service_role, qui ne doit jamais etre exposee dans le navigateur. Le front
// (panels/utilisateurs.js) appelle donc cette fonction via
// supabase.functions.invoke("creer-utilisateur", { body: {...} }).
//
// Deroule :
//   1) verifie que l'appelant est connecte et a un role autorise (admin,
//      agent, ou super_admin) ;
//   2) determine l'entreprise cible (celle de l'appelant, sauf super_admin
//      qui peut cibler une autre entreprise) ;
//   3) cree le compte Auth avec la cle service_role ;
//   4) insere la fiche utilisateurs (id_utilisateur = auth_user id) ;
//   5) si l'etape 4 echoue, supprime le compte Auth pour eviter un orphelin.
//
// Deploiement : depuis le dossier qui contient ce dossier "supabase/" :
//   supabase login
//   supabase link --project-ref <ID_DE_TON_PROJET>
//   supabase functions deploy creer-utilisateur

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const ROLES_AUTORISES_A_CREER = ["admin", "agent", "super_admin"];
const ROLES_CREABLES = ["admin", "agent", "livreur"];

function reponseJson(corps, status = 200) {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
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

  const supabaseAppelant = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: autorisation } }
  });
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await supabaseAppelant.auth.getUser();
  if (userError || !userData?.user) return reponseJson({ error: "Session invalide ou expiree." }, 401);

  const { data: profilAppelant, error: profilError } = await supabaseAdmin
    .from("utilisateurs")
    .select("id_utilisateur, id_entreprise, role, actif")
    .eq("id_utilisateur", userData.user.id)
    .maybeSingle();

  if (profilError || !profilAppelant || !profilAppelant.actif) {
    return reponseJson({ error: "Profil appelant introuvable ou inactif." }, 403);
  }
  if (!ROLES_AUTORISES_A_CREER.includes(profilAppelant.role)) {
    return reponseJson({ error: "Droits insuffisants pour creer un utilisateur." }, 403);
  }

  let corps;
  try { corps = await req.json(); } catch { return reponseJson({ error: "Corps de requete invalide." }, 400); }

  const nom = String(corps.nom || "").trim();
  const email = String(corps.email || "").trim().toLowerCase();
  const password = String(corps.password || "");
  const telephone = String(corps.telephone || "").trim() || null;
  const role = String(corps.role || "").trim().toLowerCase();
  const salaireJour = Number(corps.salaire_jour || 0);
  const chargesJour = Number(corps.charges_jour || 0);
  const idVehicule = corps.id_vehicule || null;
  const idHubAffecte = corps.id_hub_affecte || null;

  if (!nom || !email || !password || !role) {
    return reponseJson({ error: "Nom, email, mot de passe et role sont obligatoires." }, 400);
  }
  if (password.length < 6) return reponseJson({ error: "Le mot de passe doit contenir au moins 6 caracteres." }, 400);
  if (!ROLES_CREABLES.includes(role)) return reponseJson({ error: `Role invalide : ${role}.` }, 400);
  if (role === "admin" && profilAppelant.role === "agent") {
    return reponseJson({ error: "Un agent ne peut pas creer un compte admin." }, 403);
  }

  const idEntrepriseCible =
    profilAppelant.role === "super_admin" && corps.id_entreprise
      ? String(corps.id_entreprise)
      : profilAppelant.id_entreprise;
  if (!idEntrepriseCible) return reponseJson({ error: "Impossible de determiner l'entreprise de rattachement." }, 400);

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { nom, telephone }
  });
  if (authError || !authData?.user?.id) {
    return reponseJson({ error: authError?.message || "Compte Auth non cree." }, 400);
  }

  const idUtilisateur = authData.user.id;
  const { data: utilisateurInsere, error: insertError } = await supabaseAdmin
    .from("utilisateurs")
    .insert({
      id_utilisateur: idUtilisateur,
      id_entreprise: idEntrepriseCible,
      nom, telephone, email, role,
      salaire_jour: salaireJour, charges_jour: chargesJour,
      id_vehicule: idVehicule, id_hub_affecte: idHubAffecte, actif: true
    })
    .select("id_utilisateur, nom, telephone, email, role, actif")
    .single();

  if (insertError) {
    await supabaseAdmin.auth.admin.deleteUser(idUtilisateur);
    const messageAmical = insertError.message?.includes("idx_utilisateurs_vehicule_unique")
      ? "Ce véhicule est déjà affecté à un autre utilisateur actif."
      : `Compte utilisateurs non créé : ${insertError.message}`;
    return reponseJson({ error: messageAmical }, 500);
  }

  return reponseJson({ data: utilisateurInsere });
});
