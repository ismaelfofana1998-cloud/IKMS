import { lireKpiTableauDeBord, lireRamassagesRecents, lireLotsEnPreparation, listerLivreursActifs, lirePerformanceDuJour } from "../repository.js";
import { escapeHtml, formaterFcfa, tampon } from "../ui.js";

export const titre = "Tableau de bord";
export const sousTitre = "Vue d'ensemble du jour — colis, lots et encaissements.";

const FORMATEUR_DATE = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export async function monter(conteneur, actionsContainer, profil) {
  const idHubAgent = profil?.role === "agent" ? profil.id_hub_affecte : null;

  async function rafraichir(jour = new Date().toISOString().slice(0, 10)) {
    const [kpi, ramassages, lots, livreurs, parLivreur] = await Promise.all([
      lireKpiTableauDeBord(idHubAgent),
      lireRamassagesRecents(idHubAgent),
      lireLotsEnPreparation(idHubAgent),
      listerLivreursActifs(),
      lirePerformanceDuJour(jour)
    ]);

    conteneur.innerHTML = `
      <div class="entete-tableau-bord">
        <div class="date-tableau-bord">${majusculePremiere(FORMATEUR_DATE.format(new Date()))}</div>
      </div>

      <div class="grille-kpi">
        <div class="carte-kpi">
          <div class="label">Colis en attente</div>
          <div class="valeur">${kpi.colisEnAttente}</div>
        </div>
        <div class="carte-kpi">
          <div class="label">Lots en transit</div>
          <div class="valeur">${kpi.lotsEnTransit}</div>
        </div>
        <div class="carte-kpi">
          <div class="label">Livraisons du jour</div>
          <div class="valeur">${kpi.livraisonsDuJour}</div>
        </div>
        <div class="carte-kpi accent">
          <div class="label">Encaissé aujourd'hui</div>
          <div class="valeur">${formaterFcfa(kpi.encaisseAujourdhui)} <span class="unite">FCFA</span></div>
        </div>
        <div class="carte-kpi">
          <div class="label">Marge aujourd'hui</div>
          <div class="valeur ${kpi.margeAujourdhui < 0 ? "negatif" : "positif"}">${formaterFcfa(kpi.margeAujourdhui)} <span class="unite">FCFA</span></div>
        </div>
      </div>

      <div class="colonnes-tableau-bord">
        <div class="bloc-tableau">
          <div class="tableau-titre">
            Ramassages du jour
            <button class="btn btn-discret btn-petit" data-aller-panel="ramassage">Voir tout</button>
          </div>
          ${ramassages.length ? `
          <table class="donnees">
            <thead><tr><th>Code</th><th>Expéditeur</th><th>Zone</th><th>Livreur</th><th>Statut</th><th style="text-align:right;">Montant</th></tr></thead>
            <tbody>
              ${ramassages.map((c) => `
                <tr>
                  <td class="cellule-donnee">${escapeHtml(c.id_commande)}</td>
                  <td>${escapeHtml(c.expediteur_nom)}</td>
                  <td>${escapeHtml(c.zone)}</td>
                  <td>${escapeHtml(livreurs.find((l) => l.id_utilisateur === c.id_livreur_ramassage)?.nom || "—")}</td>
                  <td>${tampon(c.id_livreur_ramassage ? "A_RAMASSER" : "CREE")}</td>
                  <td class="cellule-donnee" style="text-align:right;">${formaterFcfa(c.montant)}</td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="etat-vide-tableau">Aucun ramassage aujourd'hui.</div>`}
        </div>

        <div class="bloc-tableau">
          <div class="tableau-titre">
            Lots en préparation
            <button class="btn btn-discret btn-petit" data-aller-panel="lots">Voir tout</button>
          </div>
          <div class="liste-lots-preparation">
            ${lots.length ? lots.map((l) => `
              <div class="carte-lot-preparation">
                <div class="entete-lot-preparation">
                  <div>${escapeHtml(l.id_lot)}</div>
                  <div>${escapeHtml(livreurs.find((lv) => lv.id_utilisateur === l.id_livreur)?.nom || "Hub")}</div>
                </div>
                <div class="sous-lot-preparation">${l.nb_colis || 0} colis</div>
                <div class="barre-progression-lot"><div class="remplissage-progression-lot" style="width:${progressionLot(l.statut)}%"></div></div>
              </div>`).join("") : `<div class="etat-vide-tableau">Aucun lot en préparation.</div>`}
          </div>
        </div>
      </div>

      <div class="bloc-tableau" style="margin-top:16px;">
        <div class="tableau-titre">
          Performance par livreur
          <input type="date" id="date-perf-tdb" value="${jour}" style="height:34px;border:1.5px solid var(--ligne);border-radius:8px;padding:0 10px;">
        </div>
        ${parLivreur.length ? `
          <table class="donnees">
            <thead><tr><th>Livreur</th><th>Ramassages</th><th>Livraisons</th><th>CA</th><th>Salaire</th><th>Charges</th><th>Véhicule</th><th>Marge</th></tr></thead>
            <tbody>
              ${parLivreur.map((p) => `
                <tr>
                  <td>${escapeHtml(p.nom)}</td>
                  <td>${p.nb_ramassages}</td>
                  <td>${p.nb_livraisons}</td>
                  <td class="cellule-donnee">${formaterFcfa(p.ca_livre)}</td>
                  <td class="cellule-donnee">${formaterFcfa(p.salaire_jour)}</td>
                  <td class="cellule-donnee">${formaterFcfa(p.charges_livreur + Number(p.charges_vehicule || 0))}</td>
                  <td>${p.type_vehicule || "—"}</td>
                  <td class="cellule-donnee" style="color:${p.marge_jour < 0 ? "var(--alerte)" : "var(--valide)"};">${formaterFcfa(p.marge_jour)}</td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="etat-vide-tableau">Aucune activité ce jour-là.</div>`}
      </div>
    `;

    conteneur.querySelector("#date-perf-tdb").addEventListener("change", (e) => rafraichir(e.target.value));

    conteneur.querySelectorAll("[data-aller-panel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelector(`.sidebar-lien[data-panel="${btn.dataset.allerPanel}"]`)?.click();
      });
    });
  }

  await rafraichir();
  return () => {};
}

function majusculePremiere(texte) {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

// Le statut du lot (PREPARE/RECUPERATION/EN_TOURNEE/TERMINE) n'a pas de
// pourcentage d'avancement propre en base -- juste une étape. On approxime
// une position raisonnable sur la barre pour donner un repère visuel rapide,
// pas une mesure exacte (le détail exact reste dans le panneau Lots).
function progressionLot(statut) {
  switch (statut) {
    case "RECUPERATION": return 66;
    case "EN_TOURNEE": return 85;
    case "TERMINE": return 100;
    default: return 30;
  }
}
