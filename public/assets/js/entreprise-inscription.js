import { getSupabaseClient } from "./supabase-client.js";

const conteneur = document.querySelector("#contenu");
const supabase = getSupabaseClient();

function escapeHtml(texte) {
  const div = document.createElement("div");
  div.textContent = String(texte ?? "");
  return div.innerHTML;
}

// Piège connu de supabase-js : sur une réponse non-2xx, error.message reste
// générique ("Edge Function returned a non-2xx status code") — le vrai
// message est dans error.context (l'objet Response brut), à parser soi-même.
async function extraireErreurFonction(error, data) {
  if (data?.error) return data.error;
  if (error?.context && typeof error.context.json === "function") {
    try {
      const corps = await error.context.json();
      if (corps?.error) return corps.error;
    } catch { /* corps non-JSON : on retombe sur error.message */ }
  }
  return error?.message || "Une erreur est survenue.";
}

function afficherFormulaire() {
  conteneur.innerHTML = `
    <p class="message-erreur-pub" id="erreur-form"></p>
    <form id="form-inscription">
      <div class="champ-pub">
        <label>Code entreprise</label>
        <input id="i-code" required placeholder="EXPRESSCI" style="text-transform:uppercase;" maxlength="30">
      </div>
      <div class="champ-pub"><label>Nom commercial</label><input id="i-nom" required placeholder="Express CI Livraison"></div>

      <hr style="border:none;border-top:1px solid var(--ligne);margin:18px 0;">

      <div class="champ-pub"><label>Votre nom</label><input id="i-admin-nom" required placeholder="Nom complet"></div>
      <div class="champ-pub"><label>Votre email</label><input id="i-admin-email" type="email" required placeholder="vous@exemple.com"></div>
      <div class="champ-pub"><label>Téléphone (optionnel)</label><input id="i-admin-telephone" placeholder="07..."></div>
      <div class="champ-pub"><label>Mot de passe</label><input id="i-admin-password" type="password" required minlength="8" placeholder="Au moins 8 caractères"></div>

      <button type="submit" class="btn-pub btn-pub-primaire" id="btn-inscrire">Créer mon compte</button>
    </form>
    <p style="font-size:12.5px;color:var(--ink-soft);text-align:center;margin-top:14px;">
      Vous pourrez ensuite créer vos agents, livreurs, zones et tarifs depuis votre espace centrale.
    </p>
    <p style="font-size:12px;color:var(--ink-soft);text-align:center;margin-top:6px;">
      Ceci crée une entreprise cliente de la plateforme IKMS (SaaS). Pour un compte client
      d'une entreprise de livraison déjà existante (facturation/portefeuille), utilise plutôt le lien
      d'inscription client fourni par cette entreprise.
  `;

  document.querySelector("#form-inscription").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erreur = document.querySelector("#erreur-form");
    erreur.classList.remove("visible");

    const codeEntreprise = document.querySelector("#i-code").value.trim().toUpperCase();
    const nomEntreprise = document.querySelector("#i-nom").value.trim();
    const adminNom = document.querySelector("#i-admin-nom").value.trim();
    const adminEmail = document.querySelector("#i-admin-email").value.trim();
    const adminTelephone = document.querySelector("#i-admin-telephone").value.trim();
    const adminPassword = document.querySelector("#i-admin-password").value;

    const bouton = document.querySelector("#btn-inscrire");
    bouton.disabled = true; bouton.textContent = "Création…";

    const { data, error } = await supabase.functions.invoke("inscrire-entreprise", {
      body: {
        code_entreprise: codeEntreprise, nom_entreprise: nomEntreprise,
        admin_nom: adminNom, admin_email: adminEmail,
        admin_telephone: adminTelephone, admin_password: adminPassword
      }
    });

    if (error || data?.error) {
      erreur.textContent = await extraireErreurFonction(error, data);
      erreur.classList.add("visible");
      bouton.disabled = false; bouton.textContent = "Créer mon compte";
      return;
    }

    const resultat = { code_entreprise: data.data.code_entreprise, adminEmail, adminPassword };
    // Connecte directement le compte tout juste créé (évite de retaper le mot
    // de passe) — ne fonctionne que si cette page et la centrale partagent
    // la même origine (voir CENTRALE_BASE_URL dans config.public.js) : la
    // session Supabase (localStorage) ne traverse pas les domaines différents.
    await supabase.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
    afficherConfirmation(resultat);
  });
}

function afficherConfirmation({ code_entreprise, adminEmail, adminPassword }) {
  const urlCentrale = `${window.APP_CONFIG?.CENTRALE_BASE_URL || "."}/index.html`;
  conteneur.innerHTML = `
    <div class="recap-code">
      <div class="label">Votre compte est prêt</div>
      <div class="code">${escapeHtml(code_entreprise)}</div>
    </div>
    <p style="font-size:14px;color:var(--ink-soft);text-align:center;margin-top:14px;">
      Note bien ce code entreprise : les personnes qui vous envoient un colis en auront besoin sur la page d'envoi.
    </p>
    <a class="btn-pub btn-pub-primaire" href="${urlCentrale}" style="margin-top:18px;display:flex;">Accéder à mon espace</a>
    <p style="font-size:12px;color:var(--ink-soft);text-align:center;margin-top:12px;">
      Si la connexion automatique ne fonctionne pas (espace hébergé sur un autre domaine),
      connecte-toi avec : <strong>${escapeHtml(adminEmail)}</strong> et le mot de passe choisi.
    </p>
  `;
}

// Personnalisation superadmin (voir plateforme.html, onglet "Personnaliser")
// -- cette page n'appartient à aucune entreprise, les paramètres sont donc
// globaux à la plateforme, jamais scopés par tenant. Rien de personnalisé ?
// Le texte/les couleurs par défaut déjà dans le HTML restent inchangés.
async function appliquerPersonnalisationPlateforme() {
  const { data, error } = await supabase.rpc("rpc_lire_parametres_plateforme");
  if (error || !data?.length) return;
  const p = Object.fromEntries(data.map((r) => [r.cle, r.valeur]).filter(([, v]) => v));

  if (p.slogan_principal) document.querySelector(".hero-titre").innerHTML = escapeHtml(p.slogan_principal).replace(/\n/g, "<br>");
  if (p.slogan_secondaire) document.querySelector(".hero-sous").textContent = p.slogan_secondaire;
  if (p.titre_formulaire) document.querySelector(".entete-section-form h2").textContent = p.titre_formulaire;
  if (p.sous_titre_formulaire) document.querySelector(".entete-section-form p").textContent = p.sous_titre_formulaire;

  const hero = document.querySelector(".hero-kinetique");
  if (p.couleur_fond) hero.style.setProperty("--indigo", p.couleur_fond);
  if (p.couleur_accent) hero.style.setProperty("--peche", p.couleur_accent);
  if (p.image_hero) {
    const { data: url } = supabase.storage.from("plateforme").getPublicUrl(p.image_hero);
    hero.style.backgroundImage = `linear-gradient(165deg, rgba(18,23,27,0.55) 0%, rgba(18,23,27,0.25) 100%), url('${url.publicUrl}')`;
    hero.style.backgroundSize = "cover";
    hero.style.backgroundPosition = "center";
  }
}

afficherFormulaire();
appliquerPersonnalisationPlateforme();
