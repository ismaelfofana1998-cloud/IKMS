import * as panneauAbonnement from "./abonnement.js";
import * as panneauPaiements from "./paiements.js";
import * as panneauPersonnalisation from "./personnalisation.js";

export const titre = "Compte entreprise";
export const sousTitre = "Ton abonnement IKMS, ton compte de paiement et l'apparence de ta page publique — les réglages, pas la logistique.";

const ONGLETS = [
  { id: "ABONNEMENT", label: "Abonnement", module: panneauAbonnement },
  { id: "PAIEMENTS", label: "Paiements", module: panneauPaiements },
  { id: "PERSONNALISATION", label: "Personnalisation", module: panneauPersonnalisation }
];

export async function monter(conteneur, actionsContainer, profil) {
  let ongletActif = "ABONNEMENT";
  let demonterSousPanneau = null;

  async function afficherOnglet() {
    if (demonterSousPanneau) { demonterSousPanneau(); demonterSousPanneau = null; }

    conteneur.innerHTML = `
      <div class="onglets-panneau">
        ${ONGLETS.map((o) => `<button class="onglet-panneau" data-onglet="${o.id}" aria-current="${o.id === ongletActif}">${o.label}</button>`).join("")}
      </div>
      <div id="zone-sous-panneau"></div>
    `;
    conteneur.querySelectorAll("[data-onglet]").forEach((btn) => {
      btn.addEventListener("click", () => { ongletActif = btn.dataset.onglet; afficherOnglet(); });
    });

    const { module } = ONGLETS.find((o) => o.id === ongletActif);
    const sousConteneur = conteneur.querySelector("#zone-sous-panneau");
    const resultat = await module.monter(sousConteneur, actionsContainer, profil);
    demonterSousPanneau = typeof resultat === "function" ? resultat : null;
  }

  await afficherOnglet();
  return () => { if (demonterSousPanneau) demonterSousPanneau(); };
}
