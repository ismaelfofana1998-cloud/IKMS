import { listerColisAValider, validerDepot, validerRetourRecu } from "../repository.js";
import { afficherFlash, escapeHtml, tampon, libelleMotif } from "../ui.js";

export const titre = "Réception hub";
export const sousTitre = "Valide les dépôts et confirme l'arrivée des retours, colis par colis.";

export async function monter(conteneur, actionsContainer, profil) {
  const idHubAgent = profil?.role === "agent" ? profil.id_hub_affecte : null;

  async function rafraichir() {
    const colis = await listerColisAValider(idHubAgent);
    if (!colis.length) {
      conteneur.innerHTML = `<div class="etat-vide-tableau">Rien à valider pour le moment.</div>`;
      return;
    }
    conteneur.innerHTML = `
      <div class="bloc-tableau">
        <table class="donnees">
          <thead><tr><th>Colis</th><th>Destinataire</th><th>Statut annoncé</th><th>Motif</th><th></th></tr></thead>
          <tbody>
            ${colis.map((c) => {
              const alerte = c.alerte_zone || c.commandes?.alerte_zone_expediteur;
              return `
              <tr${alerte ? ' class="ligne-alerte-zone"' : ""}>
                <td class="cellule-donnee">${escapeHtml(c.id_colis)}</td>
                <td>
                  ${escapeHtml(c.destinataire_nom)}
                  ${alerte ? `<div class="badge-alerte-zone">⚠️ Zone à vérifier — ${escapeHtml(alerte)}</div>` : ""}
                </td>
                <td>${tampon(c.statut)}</td>
                <td>${libelleMotif(c.motif_retour)}</td>
                <td class="cellule-actions">
                  ${c.statut === "DEPOT_DEMANDE"
                    ? `<button class="btn btn-primaire btn-petit" data-valider-depot="${c.id_colis}">Valider le dépôt</button>`
                    : `<button class="btn btn-primaire btn-petit" data-valider-retour-recu="${c.id_colis}">Confirmer la réception</button>`}
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
        <p class="sous-titre" style="margin-top:10px;">
          Les retours confirmés ici passent dans l'onglet "Retours à traiter" pour la décision
          (reprogrammer ou renvoyer à l'expéditeur).
        </p>
      </div>`;

    conteneur.querySelectorAll("[data-valider-depot]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const r = await validerDepot(btn.dataset.validerDepot);
        if (r.ok) { afficherFlash("Dépôt validé"); rafraichir(); } else afficherFlash(r.message, true);
      });
    });
    conteneur.querySelectorAll("[data-valider-retour-recu]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const r = await validerRetourRecu(btn.dataset.validerRetourRecu);
        if (r.ok) { afficherFlash("Retour reçu — à traiter dans l'onglet Retours"); rafraichir(); } else afficherFlash(r.message, true);
      });
    });
  }

  await rafraichir();
}
