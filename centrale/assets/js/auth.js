import { getSupabaseClient, getSessionActuelle } from "./supabase-client.js";

const ROLES_CENTRALE = ["agent", "admin", "super_admin"];

export async function chargerProfilCentrale() {
  const session = await getSessionActuelle();
  if (!session?.user) return null;

  const { data, error } = await getSupabaseClient()
    .from("utilisateurs")
    .select("id_utilisateur, id_entreprise, nom, role, actif, id_hub_affecte")
    .eq("id_utilisateur", session.user.id)
    .maybeSingle();

  if (error || !data) return null;
  if (!ROLES_CENTRALE.includes(data.role) || !data.actif) return null;
  return data;
}

export async function connecterCentrale(email, password) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data?.session) {
    if (error?.message === "Invalid login credentials") {
      return { ok: false, message: "Email ou mot de passe incorrect." };
    }
    return { ok: false, message: error?.message || "Connexion impossible. Vérifie ta connexion internet et réessaie." };
  }

  const profil = await chargerProfilCentrale();
  if (!profil) {
    await supabase.auth.signOut();
    return { ok: false, message: "Ce compte n'a pas accès à l'espace centrale." };
  }
  return { ok: true, profil };
}

export async function deconnecterCentrale() {
  await getSupabaseClient().auth.signOut();
  window.location.href = "./index.html";
}

export async function garantirAccesCentrale() {
  const profil = await chargerProfilCentrale();
  if (!profil) { window.location.href = "./index.html"; return null; }
  return profil;
}
