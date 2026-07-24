import { getSupabaseClient } from "./supabase-client.js";
import { resoudreCodeEntreprise, lienPage, traduireErreurAuth } from "./entreprise-contexte.js";

const codeEntreprise = resoudreCodeEntreprise();
const conteneur = document.querySelector("#contenu");
const supabase = getSupabaseClient();

// Doit rester identique à emailSynthetique() dans la fonction Edge
// inscrire-client-pro : le téléphone + le code entreprise composent un
// identifiant technique invisible pour la personne, qui ne voit/tape que
// son numéro de téléphone.
function emailSynthetique(code, telephone) {
  return `client-${code}-${telephone}@clients.ikigai.internal`.toLowerCase();
}

function normaliserTelephone(valeur) {
  const local = String(valeur || "").replace(/[\s.\-]/g, "").replace(/^(\+225|00225|225)/, "");
  return /^0\d{9}$/.test(local) ? local : null;
}

async function demarrer() {
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
    if (elMarque) elMarque.textContent = nomEntreprise || "Espace client";
  });

  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    // Une session existe (stockage du navigateur, partagé entre toutes les
    // pages de ce domaine) -- mais ça ne veut pas dire qu'elle correspond à
    // un compte client de CETTE entreprise précisément (ex. session d'une
    // autre entreprise testée avant, ou d'un autre type de compte). Vérifie
    // avant de sauter vers l'espace client, sinon on atterrit sur un
    // message "compte introuvable" qui ressemble à un bug plutôt qu'à une
    // simple déconnexion nécessaire.
    const { data: clientExistant } = await supabase
      .from("clients_pro").select("id_client")
      .eq("id_auth", session.user.id).maybeSingle();
    if (clientExistant) {
      window.location.href = lienPage("client-espace.html", codeEntreprise);
      return;
    }
    await supabase.auth.signOut();
  }

  conteneur.innerHTML = `
    <p class="message-erreur-pub" id="erreur-form"></p>
    <form id="form-connexion-client">
      <div class="champ-pub"><label>Téléphone</label><input id="c-telephone" type="tel" inputmode="numeric" required placeholder="07 00 00 00 00" maxlength="14"></div>
      <div class="champ-pub"><label>Mot de passe</label><input id="c-password" type="password" required></div>
      <button type="submit" class="btn-pub btn-pub-primaire" id="btn-connexion">Se connecter</button>
    </form>
    <p style="text-align:center;font-size:13px;color:var(--ink-soft);margin-top:16px;">
      Pas encore de compte ?
      <a href="${lienPage("client-inscription.html", codeEntreprise)}" style="color:var(--terracotta);font-weight:700;">Créer un compte</a>
    </p>
    <p style="text-align:center;font-size:13px;color:var(--ink-soft);margin-top:8px;">
      <a href="${lienPage("expediteur.html", codeEntreprise)}" style="color:var(--ink-soft);">‹ Envoyer un colis sans compte</a>
    </p>
  `;

  document.querySelector("#form-connexion-client").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erreur = document.querySelector("#erreur-form");
    erreur.classList.remove("visible");

    const telephone = normaliserTelephone(document.querySelector("#c-telephone").value);
    if (!telephone) {
      erreur.textContent = "Numéro invalide : 10 chiffres attendus (ex. 07 00 00 00 00).";
      erreur.classList.add("visible");
      return;
    }

    const bouton = document.querySelector("#btn-connexion");
    bouton.disabled = true; bouton.textContent = "Connexion…";

    const { error } = await supabase.auth.signInWithPassword({
      email: emailSynthetique(codeEntreprise, telephone),
      password: document.querySelector("#c-password").value
    });

    if (error) {
      erreur.textContent = traduireErreurAuth(error.message);
      erreur.classList.add("visible");
      bouton.disabled = false; bouton.textContent = "Se connecter";
      return;
    }

    window.location.href = lienPage("client-espace.html", codeEntreprise);
  });
}

demarrer();
