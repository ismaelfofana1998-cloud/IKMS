import { lireMonEssai, lireCodeEntreprise } from "../repository.js";
import { afficherFlash, escapeHtml } from "../ui.js";

export const titre = "Abonnement";
export const sousTitre = "Statut de votre essai, choix de votre formule, et liens à partager.";

async function partager(texte, url, bouton) {
  if (navigator.share) {
    try { await navigator.share({ text: texte, url }); return; } catch { return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    const original = bouton.textContent;
    bouton.textContent = "Copié";
    setTimeout(() => { bouton.textContent = original; }, 1800);
  } catch { /* silencieux */ }
}

export async function monter(conteneur, actionsContainer, profil) {
  const [essai, codeEntreprise] = await Promise.all([
    lireMonEssai().catch(() => null),
    lireCodeEntreprise(profil.id_entreprise).catch(() => null)
  ]);

  const base = window.APP_CONFIG?.APP_BASE_URL || window.location.origin;
  // Ces deux pages vivent dans le déploiement "pages publiques" — le chemin
  // suppose qu'il est servi à la racine du même domaine que la centrale, ou
  // sur un sous-domaine dédié ; ajuste APP_BASE_URL dans config.public.js
  // si ton hébergement sépare les deux différemment.
  const urlExpediteur = `${base}/expediteur.html?entreprise=${encodeURIComponent(codeEntreprise || "")}`;
  const urlClientPro = `${base}/client-inscription.html?entreprise=${encodeURIComponent(codeEntreprise || "")}`;

  let blocEssai;
  if (!essai || essai.essai_expire_le === null) {
    blocEssai = `<div class="bloc-tableau"><p>Aucun essai en cours — abonnement actif.</p></div>`;
  } else if (essai.jours_restants > 0) {
    blocEssai = `
      <div class="bloc-tableau">
        <div class="tableau-titre">Période d'essai</div>
        <p style="font-size:28px;font-weight:700;margin:6px 0;">${essai.jours_restants} jour${essai.jours_restants > 1 ? "s" : ""} restant${essai.jours_restants > 1 ? "s" : ""}</p>
        <p class="sous-titre">Ton essai gratuit se termine le ${new Date(essai.essai_expire_le).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.</p>
      </div>`;
  } else {
    blocEssai = `
      <div class="bloc-tableau">
        <div class="tableau-titre">Essai terminé</div>
        <p class="sous-titre">Contacte-nous pour activer un abonnement payant et continuer à utiliser IKMS sans interruption.</p>
      </div>`;
  }

  conteneur.innerHTML = `
    ${blocEssai}

    <div class="bloc-tableau" style="margin-top:18px;">
      <div class="tableau-titre">Formules</div>
      <p class="sous-titre" style="margin-bottom:12px;">
        La facturation se fait pour l'instant manuellement, en direct avec l'équipe IKMS — aucune carte
        bancaire à enregistrer ici. Contacte-nous pour choisir ta formule et l'activer.
      </p>
      <div class="cartes-transport" style="display:flex;gap:12px;flex-wrap:wrap;">
        <div class="transport-card" style="flex:1;min-width:180px;cursor:default;">
          <span class="transport-titre">Standard</span>
          <span class="transport-desc">Pour démarrer et tester en conditions réelles.</span>
        </div>
        <div class="transport-card" style="flex:1;min-width:180px;cursor:default;">
          <span class="transport-titre">Croissance</span>
          <span class="transport-desc">Pour une activité déjà régulière, plusieurs livreurs.</span>
        </div>
        <div class="transport-card" style="flex:1;min-width:180px;cursor:default;">
          <span class="transport-titre">Sur mesure</span>
          <span class="transport-desc">Besoins spécifiques — parlons-en directement.</span>
        </div>
      </div>
    </div>

    <div class="bloc-tableau" style="margin-top:18px;">
      <div class="tableau-titre">Liens à partager</div>
      <p class="sous-titre" style="margin-bottom:10px;">
        Envoie ces liens à tes clients pour qu'ils puissent expédier un colis ou créer leur compte client pro.
      </p>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--creme);border-radius:8px;gap:10px;">
          <span style="font-size:13px;">Page d'envoi de colis (grand public)</span>
          <button class="lien-copie" data-partager="${escapeHtml(urlExpediteur)}" data-texte="Envoie ton colis directement ici :">Partager</button>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--creme);border-radius:8px;gap:10px;">
          <span style="font-size:13px;">Création de compte client pro</span>
          <button class="lien-copie" data-partager="${escapeHtml(urlClientPro)}" data-texte="Crée ton compte client pro ici :">Partager</button>
        </div>
      </div>
    </div>
  `;

  conteneur.querySelectorAll("[data-partager]").forEach((b) => {
    b.addEventListener("click", () => partager(b.dataset.texte, b.dataset.partager, b));
  });
}
