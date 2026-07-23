import { lireCaisseTousLivreurs, lireCaisseParHub, listerVersementsEnAttente, validerVersement, lireHistoriqueVersements } from "../repository.js";
import { afficherFlash, escapeHtml, formaterFcfa } from "../ui.js";

export const titre = "Caisse";
export const sousTitre = "Solde espèces de chaque livreur et agent (point relais), et versements à valider.";

const LIBELLE_ROLE = { livreur: "Livreur", agent: "Agent" };

export async function monter(conteneur) {
  async function rafraichir() {
    const [soldes, parHub, versements, historique] = await Promise.all([
      lireCaisseTousLivreurs(), lireCaisseParHub(), listerVersementsEnAttente(), lireHistoriqueVersements()
    ]);

    conteneur.innerHTML = `
      ${parHub.length ? `
      <div class="bloc-tableau">
        <div class="tableau-titre">Cash actuellement détenu, par hub</div>
        <table class="donnees">
          <thead><tr><th>Hub</th><th>Total espèces</th><th>Personnes concernées</th></tr></thead>
          <tbody>
            ${parHub.map((h) => `
              <tr>
                <td>${escapeHtml(h.nom_hub || "—")}</td>
                <td class="cellule-donnee" style="color:${h.solde_especes_hub > 0 ? "var(--attente)" : "var(--valide)"};">${formaterFcfa(h.solde_especes_hub)} FCFA</td>
                <td>${h.nb_personnes_avec_cash}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>` : ""}

      <div class="bloc-tableau">
        <div class="tableau-titre">Solde espèces par personne</div>
        ${soldes.length ? `
          <table class="donnees">
            <thead><tr><th>Nom</th><th>Rôle</th><th>Solde</th></tr></thead>
            <tbody>
              ${soldes.map((s) => `
                <tr>
                  <td>${escapeHtml(s.nom)}</td>
                  <td>${LIBELLE_ROLE[s.role] || s.role}</td>
                  <td class="cellule-donnee" style="color:${s.solde_especes > 0 ? "var(--attente)" : "var(--valide)"};">${formaterFcfa(s.solde_especes)} FCFA</td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="etat-vide-tableau">Aucun livreur ou agent actif.</div>`}
      </div>

      <div class="bloc-tableau">
        <div class="tableau-titre">Versements à valider (${versements.length})</div>
        ${versements.length ? `
          <table class="donnees">
            <thead><tr><th>Personne</th><th>Montant</th><th>Date</th><th></th></tr></thead>
            <tbody>
              ${versements.map((v) => `
                <tr>
                  <td>${escapeHtml(soldes.find((s) => s.id_livreur === v.id_livreur)?.nom || v.id_livreur)}</td>
                  <td class="cellule-donnee">${formaterFcfa(v.montant)} FCFA</td>
                  <td>${new Date(v.cree_le).toLocaleString("fr-FR")}</td>
                  <td class="cellule-actions"><button class="btn btn-primaire btn-petit" data-valider="${v.id}">Valider la réception</button></td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="etat-vide-tableau">Aucun versement en attente.</div>`}
      </div>

      <div class="bloc-tableau">
        <div class="tableau-titre">Historique complet des versements (${historique.length})</div>
        ${historique.length ? `
          <table class="donnees">
            <thead><tr><th>Personne</th><th>Rôle</th><th>Hub</th><th>Montant</th><th>Date</th><th>Statut</th></tr></thead>
            <tbody>
              ${historique.map((h) => `
                <tr>
                  <td>${escapeHtml(h.nom_personne)}</td>
                  <td>${LIBELLE_ROLE[h.role_personne] || h.role_personne}</td>
                  <td>${escapeHtml(h.nom_hub || "—")}</td>
                  <td class="cellule-donnee">${formaterFcfa(h.montant)} FCFA</td>
                  <td>${new Date(h.cree_le).toLocaleString("fr-FR")}</td>
                  <td>${h.valide_par ? `<span class="tampon valide">Validé par ${escapeHtml(h.nom_validateur || "")}</span>` : `<span class="tampon attente">En attente</span>`}</td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="etat-vide-tableau">Aucun versement pour l'instant.</div>`}
      </div>
    `;

    conteneur.querySelectorAll("[data-valider]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const r = await validerVersement(btn.dataset.valider);
        if (r.ok) { afficherFlash("Versement validé"); rafraichir(); } else afficherFlash(r.message, true);
      });
    });
  }

  await rafraichir();
  return () => {};
}
