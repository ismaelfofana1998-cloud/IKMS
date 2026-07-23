import * as panneauUtilisateurs from "./utilisateurs.js";
import * as panneauVehicules from "./vehicules.js";
import * as panneauHubs from "./hubs.js";

export const titre = "Ressources";
export const sousTitre = "Ton équipe, ton parc de véhicules et tes hubs — regroupés ici, à modifier rarement une fois en place.";

const ONGLETS = [
  { id: "EQUIPE", label: "Équipe", module: panneauUtilisateurs },
  { id: "VEHICULES", label: "Véhicules", module: panneauVehicules },
  { id: "HUBS", label: "Hubs", module: panneauHubs }
];

export async function monter(conteneur, actionsContainer, profil) {
  let ongletActif = "EQUIPE";
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
