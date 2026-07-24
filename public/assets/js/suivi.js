import { getSupabaseClient } from "./supabase-client.js";

const conteneur = document.querySelector("#contenu");
const token = new URLSearchParams(window.location.search).get("token");
let supabase = null;

function escapeHtml(texte) {
  const div = document.createElement("div");
  div.textContent = String(texte ?? "");
  return div.innerHTML;
}

function iconePosition() {
  return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
}

// Remplace le contenu ET rejoue l'animation d'entrée (fondu doux).
function majContenu(html) {
  conteneur.innerHTML = html;
  conteneur.classList.remove("entree-contenu");
  void conteneur.offsetWidth;
  conteneur.classList.add("entree-contenu");
}

async function demarrer() {
  if (!token) {
    majContenu(`
      <section class="carte-suivi carte-recherche-suivi">
        <div class="icone-position">${iconePosition()}</div>
        <p class="sur-titre-suivi">Suivi de colis</p>
        <h1>Où est votre colis&nbsp;?</h1>
        <p>Collez le lien reçu par message ou saisissez directement votre code de suivi.</p>
        <form id="form-recherche-suivi">
          <label for="code-suivi">Lien ou code de suivi</label>
          <input id="code-suivi" name="code" autocomplete="off" inputmode="text" placeholder="Ex. A8F3K2…" required>
          <button class="btn-pub btn-pub-primaire" type="submit">Afficher le suivi</button>
        </form>
        <div class="aide-suivi">Le lien de suivi est envoyé lors de la création de l'expédition.</div>
      </section>
    `);
    document.querySelector("#form-recherche-suivi").addEventListener("submit", (event) => {
      event.preventDefault();
      const value = document.querySelector("#code-suivi").value.trim();
      if (!value) return;
      let nextToken = value;
      try {
        nextToken = new URL(value).searchParams.get("token") || value;
      } catch {
        // La valeur est déjà un token brut.
      }
      window.location.search = new URLSearchParams({ token: nextToken }).toString();
    });
    return;
  }

  supabase = getSupabaseClient();
  const { data: lien, error } = await supabase.rpc("rpc_lire_lien", { p_token: token }).maybeSingle();
  if (error || !lien) {
    majContenu(`<div class="chargement-pub">Ce lien est invalide ou a expiré. Demande un nouveau lien à l'expéditeur.</div>`);
    return;
  }

  const estExpediteur = lien.type === "POSITION_EXPEDITEUR";
  const elMarque = document.querySelector("#marque-tenant");
  if (elMarque) elMarque.textContent = lien.nom_entreprise || "Suivi de colis";
  const nomPersonne = estExpediteur ? lien.expediteur_nom : lien.destinataire_nom;
  const libelleCode = estExpediteur ? "Code à donner au livreur pour le ramassage" : "Code à donner au livreur à la livraison";

  // Une fois le ramassage effectué, plus personne n'a besoin de la position
  // de l'expéditeur — inutile de continuer à la lui demander (le lien et
  // le token restent en base dans tous les cas, seule cette invitation à
  // partager s'arrête).
  if (!lien.toujours_utile) {
    majContenu(`
      <div class="carte-suivi">
        <div class="icone-position">${iconePosition()}</div>
        <h2>Merci ${escapeHtml(nomPersonne || "")}</h2>
        <p>Ton colis a déjà été récupéré — plus besoin de partager ta position.</p>
      </div>
    `);
    return;
  }

  majContenu(`
    <div class="carte-suivi">
      <div class="icone-position">${iconePosition()}</div>
      <h2>Bonjour ${escapeHtml(nomPersonne || "")}</h2>
      <p>Partage ta position pour aider le livreur à te trouver plus facilement.</p>
      <button class="btn-pub btn-pub-primaire" id="btn-partager">Partager ma position</button>
      <div id="etat-position"></div>
    </div>

    ${lien.code ? `
      <div class="recap-code" style="margin-top:16px;">
        <div class="label">${libelleCode}</div>
        <div class="code">${escapeHtml(lien.code)}</div>
      </div>` : ""}
  `);

  document.querySelector("#btn-partager").addEventListener("click", partagerPosition);
}

function partagerPosition() {
  const bouton = document.querySelector("#btn-partager");
  const etat = document.querySelector("#etat-position");
  if (!navigator.geolocation) {
    etat.innerHTML = `<div class="etat-position attente">La localisation n'est pas disponible sur cet appareil.</div>`;
    return;
  }

  bouton.disabled = true; bouton.textContent = "Localisation en cours…";
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { error } = await supabase.rpc("rpc_enregistrer_position", {
        p_token: token,
        p_lat: position.coords.latitude,
        p_lng: position.coords.longitude
      });
      if (error) {
        etat.innerHTML = `<div class="etat-position attente">Erreur : ${escapeHtml(error.message)}</div>`;
        bouton.disabled = false; bouton.textContent = "Réessayer";
        return;
      }
      bouton.textContent = "Position partagée";
      etat.innerHTML = `<div class="etat-position ok">Position transmise au livreur ✓</div>`;
    },
    () => {
      etat.innerHTML = `<div class="etat-position attente">Position refusée. Autorise la localisation dans les réglages de ton téléphone pour réessayer.</div>`;
      bouton.disabled = false; bouton.textContent = "Réessayer";
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

demarrer();
