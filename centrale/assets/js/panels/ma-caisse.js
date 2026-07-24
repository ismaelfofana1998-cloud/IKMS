import { lireCaisseTousLivreurs, verserCaisse, lireHistoriqueVersements } from "../repository.js";
import { afficherFlash, escapeHtml, formaterFcfa } from "../ui.js";

export const titre = "Ma caisse";
export const sousTitre = "Ton propre solde d'espèces (encaissements en point relais notamment) et tes versements.";

export async function monter(conteneur, actionsContainer, profil) {
  async function rafraichir() {
    const [tous, historique] = await Promise.all([
      lireCaisseTousLivreurs(), lireHistoriqueVersements(profil.id_utilisateur)
    ]);
    const moi = tous.find((s) => s.id_livreur === profil.id_utilisateur);
    const solde = moi?.solde_especes || 0;

    conteneur.innerHTML = `
      <div class="bloc-tableau" style="max-width:420px;">
        <div class="tableau-titre">Mon solde</div>
        <p style="font-size:28px;font-weight:700;margin:12px 0;color:${solde > 0 ? "var(--attente)" : "var(--valide)"};">
          ${formaterFcfa(solde)} FCFA
        </p>
        <p class="sous-titre" style="margin-bottom:16px;">
          Augmente à chaque paiement en espèces que tu encaisses (retrait en point relais notamment),
          diminue une fois qu'un versement est validé par un administrateur — c'est à lui que tu remets
          physiquement l'argent.
        </p>
        ${solde > 0 ? `
          <div class="champ">
            <label>Montant à verser</label>
            <input id="montant-versement" type="number" min="1" max="${solde}" value="${solde}">
          </div>
          <p class="message-erreur" id="erreur-versement"></p>
          <button class="btn btn-primaire" id="btn-verser">Verser au hub</button>
        ` : `<p class="sous-titre">Rien à verser pour l'instant.</p>`}
      </div>

      <div class="bloc-tableau" style="max-width:600px;">
        <div class="tableau-titre">Mes versements</div>
        ${historique.length ? `
          <table class="donnees">
            <thead><tr><th>Montant</th><th>Date</th><th>Statut</th></tr></thead>
            <tbody>
              ${historique.map((h) => `
                <tr>
                  <td class="cellule-donnee">${formaterFcfa(h.montant)} FCFA</td>
                  <td>${new Date(h.cree_le).toLocaleString("fr-FR")}</td>
                  <td>${h.valide_par ? `<span class="tampon valide">Validé par ${escapeHtml(h.nom_validateur || "")}</span>` : `<span class="tampon attente">En attente</span>`}</td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="etat-vide-tableau">Aucun versement pour l'instant.</div>`}
      </div>`;

    conteneur.querySelector("#btn-verser")?.addEventListener("click", async (e) => {
      const montant = Number(conteneur.querySelector("#montant-versement").value);
      const erreur = conteneur.querySelector("#erreur-versement");
      if (!montant || montant <= 0 || montant > solde) {
        erreur.textContent = "Montant invalide."; erreur.classList.add("visible"); return;
      }
      e.currentTarget.disabled = true;
      const r = await verserCaisse(montant);
      if (!r.ok) { erreur.textContent = r.message; erreur.classList.add("visible"); e.currentTarget.disabled = false; return; }
      afficherFlash("Versement enregistré — en attente de validation par un administrateur");
      rafraichir();
    });
  }

  await rafraichir();
}
