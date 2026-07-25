import { listerHistoriqueCommandes } from "../repository.js";
import { afficherFlash, escapeHtml, formaterFcfa, tampon, libelleStatut } from "../ui.js";
import { telechargerHistoriqueExcel } from "../excel.js";

export const titre = "Historique des commandes";
export const sousTitre = "";

const STATUTS = [
  ["", "Tous les statuts"],
  ["CREE", "En attente"],
  ["A_RAMASSER", "À ramasser"],
  ["RAMASSE", "Ramassé"],
  ["DEPOT_DEMANDE", "Dépôt demandé"],
  ["AU_HUB", "Au hub"],
  ["EN_LOT", "En lot"],
  ["RECUP_DEMANDEE", "Récupération demandée"],
  ["EN_TOURNEE", "En livraison"],
  ["LIVRE", "Livré"],
  ["RETOUR_EN_COURS", "Retour en cours"],
  ["RETOUR_DEMANDE", "Retour demandé"],
  ["RETOUR_RECU", "Retour reçu"],
  ["A_RETOURNER", "À retourner"],
  ["RETOURNE", "Retourné"],
  ["ANNULE", "Annulé"]
];

function dateLocale(valeur) {
  if (!valeur) return "—";
  return new Date(valeur).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function libellePaiement(mode) {
  return {
    A_LA_LIVRAISON: "À la livraison",
    PAR_EXPEDITEUR: "Par expéditeur",
    SANS_PAIEMENT: "Facturation"
  }[mode] || mode || "—";
}

export async function monter(conteneur, actionsContainer) {
  const limite = 50;
  let page = 0;
  let total = 0;
  let lignes = [];
  let minuteur = null;
  let exportEnCours = false;

  actionsContainer.innerHTML = `<button class="btn btn-primaire" id="btn-exporter-historique">Exporter en Excel</button>`;

  conteneur.innerHTML = `
    <div class="filtres-historique">
      <div class="champ champ-recherche-historique">
        <label>Rechercher</label>
        <input id="recherche-historique" type="search" placeholder="CMD, RM, COL, LIV, nom ou téléphone">
      </div>
      <div class="champ">
        <label>Statut du colis</label>
        <select id="statut-historique">
          ${STATUTS.map(([valeur, libelle]) => `<option value="${valeur}">${libelle}</option>`).join("")}
        </select>
      </div>
      <div class="champ">
        <label>Du</label>
        <input id="date-debut-historique" type="date">
      </div>
      <div class="champ">
        <label>Au</label>
        <input id="date-fin-historique" type="date">
      </div>
    </div>
    <div id="resultats-historique"><div class="etat-vide-tableau">Chargement…</div></div>`;

  const recherche = conteneur.querySelector("#recherche-historique");
  const statut = conteneur.querySelector("#statut-historique");
  const dateDebut = conteneur.querySelector("#date-debut-historique");
  const dateFin = conteneur.querySelector("#date-fin-historique");
  const resultats = conteneur.querySelector("#resultats-historique");
  const btnExport = actionsContainer.querySelector("#btn-exporter-historique");

  const filtres = () => ({
    recherche: recherche.value,
    statut: statut.value,
    dateDebut: dateDebut.value,
    dateFin: dateFin.value
  });

  function rendre() {
    const premiere = total ? page * limite + 1 : 0;
    const derniere = Math.min((page + 1) * limite, total);
    resultats.innerHTML = `
      <div class="bloc-tableau">
        <div class="barre-resultats-historique">
          <span>${total} ligne${total > 1 ? "s" : ""}</span>
          <small>${premiere}–${derniere}</small>
        </div>
        ${lignes.length ? `
          <div class="tableau-defilant">
            <table class="donnees historique-commandes">
              <thead>
                <tr>
                  <th>Commande</th><th>Colis</th><th>Expéditeur</th><th>Destinataire</th>
                  <th>Hub</th><th>Livreur</th><th>Statut commande</th><th>Statut colis</th>
                  <th>Montant</th><th>Créée</th>
                </tr>
              </thead>
              <tbody>
                ${lignes.map((ligne) => `
                  <tr>
                    <td class="identifiant-metier">
                      ${escapeHtml(ligne.id_commande)}
                      <small>${escapeHtml(ligne.id_ramassage || "—")}</small>
                    </td>
                    <td class="identifiant-metier">
                      ${escapeHtml(ligne.id_colis)}
                      <small>${escapeHtml(ligne.id_lot || "Sans lot")}</small>
                    </td>
                    <td>${escapeHtml(ligne.expediteur_nom)}<small>${escapeHtml(ligne.expediteur_tel)}</small></td>
                    <td>${escapeHtml(ligne.destinataire_nom)}<small>${escapeHtml(ligne.destinataire_tel)}</small></td>
                    <td>${escapeHtml(ligne.hub_nom || "—")}</td>
                    <td>
                      ${escapeHtml(ligne.livreur_livraison_nom || ligne.livreur_ramassage_nom || "—")}
                      ${ligne.livreur_livraison_nom && ligne.livreur_ramassage_nom
                        ? `<small>Ramassage : ${escapeHtml(ligne.livreur_ramassage_nom)}</small>`
                        : ""}
                    </td>
                    <td>${tampon(ligne.statut_commande)}</td>
                    <td>${tampon(ligne.statut_colis)}</td>
                    <td class="cellule-donnee">${formaterFcfa(ligne.montant_livraison)} FCFA</td>
                    <td><small>${dateLocale(ligne.cree_le)}</small></td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
          <div class="pagination-historique">
            <button class="btn btn-discret btn-petit" id="page-precedente-historique" ${page === 0 ? "disabled" : ""}>Précédent</button>
            <span>Page ${page + 1} sur ${Math.max(1, Math.ceil(total / limite))}</span>
            <button class="btn btn-discret btn-petit" id="page-suivante-historique" ${(page + 1) * limite >= total ? "disabled" : ""}>Suivant</button>
          </div>` : `<div class="etat-vide-tableau">Aucune commande ne correspond aux filtres.</div>`}
      </div>`;

    resultats.querySelector("#page-precedente-historique")?.addEventListener("click", () => {
      page -= 1;
      charger();
    });
    resultats.querySelector("#page-suivante-historique")?.addEventListener("click", () => {
      page += 1;
      charger();
    });
  }

  async function charger() {
    resultats.setAttribute("aria-busy", "true");
    try {
      const resultat = await listerHistoriqueCommandes({
        ...filtres(),
        page,
        limite
      });
      lignes = resultat.lignes;
      total = resultat.total;
      rendre();
    } catch (erreur) {
      console.error("Impossible de charger l'historique", erreur);
      const migrationManquante = /rpc_historique_commandes|schema cache|function/i.test(erreur?.message || "");
      resultats.innerHTML = `
        <div class="etat-vide-tableau etat-erreur-historique">
          ${migrationManquante
            ? "L’historique nécessite l’application de la migration 20260725000200_operations_historique.sql dans Supabase."
            : "Impossible de charger l’historique pour le moment."}
        </div>`;
    } finally {
      resultats.removeAttribute("aria-busy");
    }
  }

  async function exporter() {
    if (exportEnCours) return;
    exportEnCours = true;
    btnExport.disabled = true;
    btnExport.textContent = "Préparation…";
    try {
      const toutes = [];
      const tailleLot = 1000;
      let numeroPage = 0;
      let totalExport = null;
      do {
        const resultat = await listerHistoriqueCommandes({
          ...filtres(),
          page: numeroPage,
          limite: tailleLot
        });
        toutes.push(...resultat.lignes);
        totalExport = resultat.total;
        numeroPage += 1;
        if (!resultat.lignes.length) break;
      } while (toutes.length < totalExport);

      const lignesExcel = toutes.map((ligne) => ({
        ...ligne,
        statut_commande_libelle: libelleStatut(ligne.statut_commande),
        statut_colis_libelle: libelleStatut(ligne.statut_colis),
        mode_paiement: libellePaiement(ligne.mode_paiement)
      }));
      telechargerHistoriqueExcel(lignesExcel);
      afficherFlash(`${lignesExcel.length} ligne${lignesExcel.length > 1 ? "s" : ""} exportée${lignesExcel.length > 1 ? "s" : ""}`);
    } catch (erreur) {
      console.error("Impossible d'exporter l'historique", erreur);
      afficherFlash("Impossible de générer l’export Excel.", true);
    } finally {
      exportEnCours = false;
      btnExport.disabled = false;
      btnExport.textContent = "Exporter en Excel";
    }
  }

  recherche.addEventListener("input", () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      page = 0;
      charger();
    }, 350);
  });
  [statut, dateDebut, dateFin].forEach((champ) => {
    champ.addEventListener("change", () => {
      page = 0;
      charger();
    });
  });
  btnExport.addEventListener("click", exporter);

  await charger();
}
