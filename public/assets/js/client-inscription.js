import { getSupabaseClient } from "./supabase-client.js";
import { resoudreCodeEntreprise, lienPage, traduireErreurAuth } from "./entreprise-contexte.js";

const codeEntreprise = resoudreCodeEntreprise();
const conteneur = document.querySelector("#contenu");
const supabase = getSupabaseClient();

function validerTelephone(valeur) {
  const local = String(valeur || "").replace(/[\s.\-]/g, "").replace(/^(\+225|00225|225)/, "");
  if (!/^0\d{9}$/.test(local)) {
    return { valide: false, message: "Numéro invalide : 10 chiffres attendus (ex. 07 00 00 00 00)." };
  }
  return { valide: true, normalise: local };
}

// Piège connu de supabase-js : sur une réponse non-2xx, error.message reste
// générique — le vrai message est dans error.context (l'objet Response
// brut), à parser soi-même.
async function extraireErreurFonction(error, data) {
  if (data?.error) return data.error;
  if (error?.context && typeof error.context.json === "function") {
    try {
      const corps = await error.context.json();
      if (corps?.error) return corps.error;
    } catch { /* corps non-JSON */ }
  }
  return traduireErreurAuth(error?.message);
}

function afficherFormulaire() {
  if (!codeEntreprise) {
    conteneur.innerHTML = `
      <div class="chargement-pub">
        Aucune entreprise identifiée. Ouvre d'abord le lien complet fourni par ton entreprise de livraison
        (avec <code>?entreprise=CODE</code>) — il sera ensuite mémorisé sur cet appareil.
      </div>`;
    return;
  }

  // Marque blanche : cette page appartient à l'entreprise de livraison, pas
  // à la plateforme IKMS elle-même — invisible pour ses clients.
  supabase.rpc("rpc_nom_entreprise", { p_code_entreprise: codeEntreprise }).then(({ data: nomEntreprise }) => {
    const elMarque = document.querySelector("#marque-tenant");
    if (elMarque) elMarque.textContent = nomEntreprise || "Créer un compte client";
  });

  conteneur.innerHTML = `
    <p class="message-erreur-pub" id="erreur-form"></p>
    <form id="form-inscription-client">
      <div class="champ-pub"><label>Nom (ou nom de la boutique)</label><input id="c-nom" required placeholder="Boutique Awa"></div>
      <div class="champ-pub"><label>Téléphone</label><input id="c-telephone" type="tel" inputmode="numeric" required placeholder="07 00 00 00 00" maxlength="14"></div>
      <div class="champ-pub"><label>Email (optionnel)</label><input id="c-email" type="email"></div>
      <div class="champ-pub"><label>Adresse (optionnel)</label><input id="c-adresse"></div>
      <div class="champ-pub"><label>Mot de passe</label><input id="c-password" type="password" required minlength="8" placeholder="Au moins 8 caractères"></div>
      <button type="submit" class="btn-pub btn-pub-primaire" id="btn-inscrire">Créer mon compte</button>
    </form>
    <p style="text-align:center;font-size:13px;color:var(--ink-soft);margin-top:16px;">
      Déjà un compte ?
      <a href="${lienPage("client-connexion.html", codeEntreprise)}" style="color:var(--terracotta);font-weight:700;">Se connecter</a>
    </p>
    <p style="text-align:center;font-size:13px;color:var(--ink-soft);margin-top:8px;">
      <a href="${lienPage("expediteur.html", codeEntreprise)}" style="color:var(--ink-soft);">‹ Envoyer un colis sans compte</a>
    </p>
  `;

  document.querySelector("#form-inscription-client").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erreur = document.querySelector("#erreur-form");
    erreur.classList.remove("visible");

    const telValidation = validerTelephone(document.querySelector("#c-telephone").value);
    if (!telValidation.valide) {
      erreur.textContent = telValidation.message;
      erreur.classList.add("visible");
      return;
    }

    const bouton = document.querySelector("#btn-inscrire");
    bouton.disabled = true; bouton.textContent = "Création…";

    const { data, error } = await supabase.functions.invoke("inscrire-client-pro", {
      body: {
        code_entreprise: codeEntreprise,
        nom: document.querySelector("#c-nom").value.trim(),
        telephone: telValidation.normalise,
        email: document.querySelector("#c-email").value.trim(),
        adresse: document.querySelector("#c-adresse").value.trim(),
        password: document.querySelector("#c-password").value
      }
    });

    if (error || data?.error) {
      erreur.textContent = await extraireErreurFonction(error, data);
      erreur.classList.add("visible");
      bouton.disabled = false; bouton.textContent = "Créer mon compte";
      return;
    }

    // Compte créé : on connecte directement (évite de retaper le mot de passe).
    await supabase.auth.signInWithPassword({
      email: `client-${codeEntreprise}-${telValidation.normalise}@clients.ikigai.internal`.toLowerCase(),
      password: document.querySelector("#c-password").value
    });
    window.location.href = lienPage("client-espace.html", codeEntreprise);
  });
}

afficherFormulaire();
