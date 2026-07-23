import { listerHubs, creerHub, modifierHub } from "../repository.js";
import { afficherFlash, escapeHtml, ouvrirModale, fermerModale } from "../ui.js";

export const titre = "Hubs";
export const sousTitre = "Les points de dépôt/relais de votre entreprise. Une seule liste, valable pour tous les livreurs.";

export async function monter(conteneur, actionsContainer, profil) {
  async function rafraichir() {
    const hubs = await listerHubs();
    conteneur.innerHTML = `
      <div class="bloc-tableau">
        <div class="tableau-titre" style="display:flex;justify-content:space-between;align-items:center;">
          <span>Hubs (${hubs.length})</span>
          <button class="btn btn-primaire btn-petit" id="btn-nouveau-hub">+ Nouveau hub</button>
        </div>
        ${hubs.length ? `
          <table class="donnees">
            <thead><tr><th>Nom</th><th>Adresse</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              ${hubs.map((h) => `
                <tr>
                  <td class="cellule-donnee">${escapeHtml(h.nom)}</td>
                  <td>${escapeHtml(h.adresse || "—")}</td>
                  <td>${h.actif ? '<span class="tampon valide-contour">Actif</span>' : '<span class="tampon">Désactivé</span>'}</td>
                  <td class="cellule-actions">
                    <button class="btn btn-discret btn-petit" data-modifier="${h.id_hub}">Modifier</button>
                    <button class="btn btn-discret btn-petit" data-basculer="${h.id_hub}" data-etat="${h.actif}">${h.actif ? "Désactiver" : "Réactiver"}</button>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="etat-vide-tableau">Aucun hub créé pour l'instant — un seul point de dépôt implicite est utilisé partout.</div>`}
      </div>`;

    conteneur.querySelector("#btn-nouveau-hub").addEventListener("click", () => ouvrirFormulaire());
    conteneur.querySelectorAll("[data-modifier]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const hub = hubs.find((h) => h.id_hub === btn.dataset.modifier);
        ouvrirFormulaire(hub);
      });
    });
    conteneur.querySelectorAll("[data-basculer]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const r = await modifierHub(btn.dataset.basculer, { actif: btn.dataset.etat !== "true" });
        if (r.ok) { afficherFlash("Hub mis à jour"); rafraichir(); }
        else { afficherFlash(r.message, true); btn.disabled = false; }
      });
    });
  }

  function ouvrirFormulaire(hub) {
    ouvrirModale(`
      <h2>${hub ? "Modifier le hub" : "Nouveau hub"}</h2>
      <p class="message-erreur" id="erreur-hub"></p>
      <div class="formulaire">
        <div class="champ"><label>Nom</label><input id="h-nom" value="${hub ? escapeHtml(hub.nom) : ""}" placeholder="Hub Centre-ville"></div>
        <div class="champ"><label>Adresse${hub ? "" : " (obligatoire)"}</label><input id="h-adresse" value="${hub ? escapeHtml(hub.adresse || "") : ""}" placeholder="Yopougon, Abidjan"></div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer">${hub ? "Enregistrer" : "Créer"}</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer").addEventListener("click", async (e) => {
        const erreur = boite.querySelector("#erreur-hub");
        const nom = boite.querySelector("#h-nom").value.trim();
        const adresse = boite.querySelector("#h-adresse").value.trim();
        if (!nom) { erreur.textContent = "Le nom est obligatoire."; erreur.classList.add("visible"); return; }
        if (!hub && !adresse) { erreur.textContent = "L'adresse est obligatoire pour un nouveau hub."; erreur.classList.add("visible"); return; }
        e.currentTarget.disabled = true;
        const r = hub
          ? await modifierHub(hub.id_hub, { nom, adresse: adresse || null })
          : await creerHub(profil.id_entreprise, nom, adresse);
        if (r.ok) { afficherFlash(hub ? "Hub modifié" : "Hub créé"); fermerModale(); rafraichir(); }
        else { erreur.textContent = r.message; erreur.classList.add("visible"); e.currentTarget.disabled = false; }
      });
    });
  }

  await rafraichir();
  return () => fermerModale();
}
