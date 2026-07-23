import { listerVehicules, creerVehicule, modifierVehicule } from "../repository.js";
import { afficherFlash, escapeHtml, formaterFcfa, ouvrirModale, fermerModale } from "../ui.js";

export const titre = "Véhicules";
export const sousTitre = "Le parc de véhicules et leurs charges journalières.";

const LIBELLES_STATUT_V = { ACTIF: "Actif", EN_REPARATION: "En réparation", HORS_SERVICE: "Hors service" };

export async function monter(conteneur, actionsContainer, profil) {
  actionsContainer.innerHTML = `<button class="btn btn-primaire" id="btn-nouveau-vehicule">+ Nouveau véhicule</button>`;

  async function rafraichir() {
    const vehicules = await listerVehicules();
    conteneur.innerHTML = `
      <div class="bloc-tableau">
        ${vehicules.length ? `
          <table class="donnees">
            <thead><tr><th>Type</th><th>Immatriculation</th><th>Statut</th><th>Charges/jour</th><th></th></tr></thead>
            <tbody>
              ${vehicules.map((v) => `
                <tr>
                  <td>${v.type}</td>
                  <td class="cellule-donnee">${escapeHtml(v.immatriculation || "—")}</td>
                  <td><span class="tampon ${v.statut === "ACTIF" ? "valide" : v.statut === "EN_REPARATION" ? "attente" : "alerte"}">${LIBELLES_STATUT_V[v.statut]}</span></td>
                  <td class="cellule-donnee">${formaterFcfa(v.charges_jour)}</td>
                  <td class="cellule-actions"><button class="btn btn-discret btn-petit" data-modifier="${v.id_vehicule}">Modifier</button></td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="etat-vide-tableau">Aucun véhicule enregistré.</div>`}
      </div>`;

    conteneur.querySelectorAll("[data-modifier]").forEach((btn) => {
      const v = vehicules.find((x) => x.id_vehicule === btn.dataset.modifier);
      btn.addEventListener("click", () => ouvrirFormulaire(v));
    });
  }

  function ouvrirFormulaire(vehicule) {
    const estEdition = !!vehicule;
    ouvrirModale(`
      <h2>${estEdition ? "Modifier le véhicule" : "Nouveau véhicule"}</h2>
      <p class="message-erreur" id="erreur-vehicule"></p>
      <div class="formulaire">
        <div class="ligne-champs">
          <div class="champ"><label>Type</label>
            <select id="v-type">
              ${["VELO", "MOTO", "TRICYCLE", "VOITURE", "CAMION", "AUTRE"].map((t) => `<option value="${t}" ${vehicule?.type === t ? "selected" : ""}>${t}</option>`).join("")}
            </select>
          </div>
          <div class="champ"><label>Immatriculation</label><input id="v-immat" value="${vehicule?.immatriculation || ""}"></div>
        </div>
        <div class="ligne-champs">
          <div class="champ"><label>Statut</label>
            <select id="v-statut">
              ${Object.entries(LIBELLES_STATUT_V).map(([k, v]) => `<option value="${k}" ${vehicule?.statut === k ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </div>
          <div class="champ"><label>Charges / jour (FCFA)</label><input id="v-charges" type="number" value="${vehicule?.charges_jour || 0}"></div>
        </div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer">Enregistrer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer").addEventListener("click", async (e) => {
        e.currentTarget.disabled = true;
        const champs = {
          type: boite.querySelector("#v-type").value,
          immatriculation: boite.querySelector("#v-immat").value.trim() || null,
          statut: boite.querySelector("#v-statut").value,
          charges_jour: Number(boite.querySelector("#v-charges").value) || 0
        };
        const r = estEdition
          ? await modifierVehicule(vehicule.id_vehicule, champs)
          : await creerVehicule({ ...champs, id_entreprise: profil.id_entreprise });
        if (r.ok) { afficherFlash("Véhicule enregistré"); fermerModale(); rafraichir(); }
        else { boite.querySelector("#erreur-vehicule").textContent = r.message; boite.querySelector("#erreur-vehicule").classList.add("visible"); e.currentTarget.disabled = false; }
      });
    });
  }

  actionsContainer.querySelector("#btn-nouveau-vehicule").addEventListener("click", () => ouvrirFormulaire(null));
  await rafraichir();
  return () => fermerModale();
}
