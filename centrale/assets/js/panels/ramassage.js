import { listerCommandesEnRamassage, listerLivreursActifs, assignerRamassage, lireLiensCommande, construireUrlPartage, creerNotification } from "../repository.js";
import { afficherFlash, escapeHtml, tampon, alerteZone, ouvrirModale, fermerModale, copierTexte } from "../ui.js";

export const titre = "Ramassage";
export const sousTitre = "Assigne un livreur pour récupérer les colis chez l'expéditeur.";

// Le hub de dépôt n'est plus un choix ici : il se déduit automatiquement de
// la zone de ramassage (configuré une fois pour toutes dans Zones et
// tarifs), exactement comme les grandes sociétés de logistique — le point
// de collecte est unique, la destination peut être multiple.
export async function monter(conteneur, actionsContainer, profil) {
  const idHubAgent = profil?.role === "agent" ? profil.id_hub_affecte : null;
  const livreurs = await listerLivreursActifs();
  // Un seul onglet visible à la fois : mélanger les commandes encore à
  // assigner avec celles déjà confiées à un livreur rend le panneau
  // illisible dès que le volume grossit -- "à assigner" reste l'onglet par
  // défaut puisque c'est l'action qui reste à faire.
  let ongletActif = "A_ASSIGNER";

  async function rafraichir() {
    const toutes = await listerCommandesEnRamassage(idHubAgent);
    const aAssigner = toutes.filter((c) => !c.id_livreur_ramassage);
    const dejaAssignees = toutes.filter((c) => c.id_livreur_ramassage);
    const commandes = ongletActif === "A_ASSIGNER" ? aAssigner : dejaAssignees;

    conteneur.innerHTML = `
      <div class="onglets-panneau">
        <button class="onglet-panneau" data-onglet="A_ASSIGNER" aria-current="${ongletActif === "A_ASSIGNER"}">
          À assigner (${aAssigner.length})
        </button>
        <button class="onglet-panneau" data-onglet="DEJA_ASSIGNEES" aria-current="${ongletActif === "DEJA_ASSIGNEES"}">
          Déjà assignées (${dejaAssignees.length})
        </button>
      </div>
      ${!commandes.length ? `<div class="etat-vide-tableau">${ongletActif === "A_ASSIGNER" ? "Aucun ramassage en attente." : "Aucune commande déjà assignée."}</div>` : `
      ${ongletActif === "A_ASSIGNER" ? `
      <div class="barre-assignation-groupee">
        <select id="select-livreur-groupe">
          <option value="">Assigner la sélection à…</option>
          ${livreurs.map((l) => `<option value="${l.id_utilisateur}">${escapeHtml(l.nom)}</option>`).join("")}
        </select>
        <button class="btn btn-primaire btn-petit" id="btn-assigner-groupe" disabled>Assigner la sélection</button>
        <span id="compteur-selection" class="compteur-selection"></span>
      </div>` : ""}
      <div class="bloc-tableau">
        <table class="donnees">
          <thead><tr>${ongletActif === "A_ASSIGNER" ? "<th><input type=\"checkbox\" id=\"case-tout\"></th>" : "<th></th>"}<th>Commande</th><th>Expéditeur</th><th>Adresse</th><th>Hub</th><th>Livreur</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            ${commandes.map((c) => `
              <tr>
                <td>${ongletActif === "A_ASSIGNER" ? `<input type="checkbox" class="case-commande" value="${c.id_commande}">` : ""}</td>
                <td class="cellule-donnee">${escapeHtml(c.id_commande)}</td>
                <td>${escapeHtml(c.expediteur_nom)}<br><span style="color:var(--ink-soft);font-size:12px;">${escapeHtml(c.expediteur_tel)}</span></td>
                <td>${escapeHtml(c.expediteur_adresse || "—")}<br>${alerteZone(c.alerte_zone_expediteur)}</td>
                <td>${escapeHtml(c.hubs?.nom || "—")}</td>
                <td>${escapeHtml(livreurs.find((l) => l.id_utilisateur === c.id_livreur_ramassage)?.nom || "—")}</td>
                <td>${tampon(c.id_livreur_ramassage ? "A_RAMASSER" : "CREE")}</td>
                <td class="cellule-actions">
                  <button class="btn btn-discret btn-petit" data-lien="${c.id_commande}">Lien</button>
                  <button class="btn btn-primaire btn-petit" data-assigner="${c.id_commande}">${c.id_livreur_ramassage ? "Réassigner" : "Assigner"}</button>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`}`;

    conteneur.querySelectorAll("[data-onglet]").forEach((btn) => {
      btn.addEventListener("click", () => { ongletActif = btn.dataset.onglet; rafraichir(); });
    });

    conteneur.querySelectorAll("[data-assigner]").forEach((btn) => {
      btn.addEventListener("click", () => {
        // Si un livreur est déjà choisi dans le sélecteur groupé au-dessus,
        // pas la peine de le redemander pour une seule ligne : on assigne
        // directement. Sinon, on ouvre la modale de sélection comme avant.
        const idLivreurPreselectionne = conteneur.querySelector("#select-livreur-groupe")?.value;
        if (idLivreurPreselectionne) {
          assignerDirectement(btn.dataset.assigner, idLivreurPreselectionne, btn);
        } else {
          ouvrirAssignation(btn.dataset.assigner);
        }
      });
    });
    conteneur.querySelectorAll("[data-lien]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const liens = await lireLiensCommande(btn.dataset.lien);
        const lienExp = liens.find((l) => l.type === "POSITION_EXPEDITEUR");
        if (lienExp) copierTexte(construireUrlPartage(lienExp.token));
        else afficherFlash("Aucun lien trouvé pour cette commande.", true);
      });
    });

    // Sélection groupée : le bouton ne s'active que si au moins une ligne
    // est cochée ET qu'un livreur est choisi dans la liste du haut. N'existe
    // que sur l'onglet "à assigner" (voir le rendu conditionnel ci-dessus).
    const casesCommande = () => [...conteneur.querySelectorAll(".case-commande")];
    const caseTout = conteneur.querySelector("#case-tout");
    const selectGroupe = conteneur.querySelector("#select-livreur-groupe");
    const btnAssignerGroupe = conteneur.querySelector("#btn-assigner-groupe");
    const compteurSelection = conteneur.querySelector("#compteur-selection");
    if (!selectGroupe) return;

    function majEtatGroupe() {
      const nbCochees = casesCommande().filter((c) => c.checked).length;
      compteurSelection.textContent = nbCochees ? `${nbCochees} sélectionnée${nbCochees > 1 ? "s" : ""}` : "";
      btnAssignerGroupe.disabled = !(nbCochees > 0 && selectGroupe.value);
    }

    caseTout.addEventListener("change", () => {
      casesCommande().forEach((c) => { c.checked = caseTout.checked; });
      majEtatGroupe();
    });
    casesCommande().forEach((c) => c.addEventListener("change", majEtatGroupe));
    selectGroupe.addEventListener("change", majEtatGroupe);

    btnAssignerGroupe.addEventListener("click", async () => {
      const idLivreur = selectGroupe.value;
      const idsCommande = casesCommande().filter((c) => c.checked).map((c) => c.value);
      if (!idLivreur || !idsCommande.length) return;
      btnAssignerGroupe.disabled = true;
      btnAssignerGroupe.textContent = "Assignation…";
      const resultats = await Promise.all(idsCommande.map((id) => assignerRamassage(id, idLivreur)));
      const echecs = resultats.filter((r) => !r.ok).length;
      if (echecs) afficherFlash(`${idsCommande.length - echecs}/${idsCommande.length} commandes assignées, ${echecs} échec(s).`, true);
      else afficherFlash(`${idsCommande.length} commande${idsCommande.length > 1 ? "s" : ""} assignée${idsCommande.length > 1 ? "s" : ""}.`);
      if (idsCommande.length - echecs > 0) {
        creerNotification(idLivreur, null, "RAMASSAGE_ASSIGNE",
          `${idsCommande.length - echecs} ramassage${idsCommande.length - echecs > 1 ? "s" : ""} assigné${idsCommande.length - echecs > 1 ? "s" : ""}`, null).catch(() => {});
      }
      rafraichir();
    });
  }

  async function assignerDirectement(idCommande, idLivreur, btn) {
    btn.disabled = true;
    const texteInitial = btn.textContent;
    btn.textContent = "Assignation…";
    const r = await assignerRamassage(idCommande, idLivreur);
    if (r.ok) {
      afficherFlash("Ramassage assigné"); rafraichir();
      creerNotification(idLivreur, null, "RAMASSAGE_ASSIGNE", `Nouveau ramassage assigné : ${idCommande}`, null).catch(() => {});
    }
    else { afficherFlash(r.message, true); btn.disabled = false; btn.textContent = texteInitial; }
  }

  function ouvrirAssignation(idCommande) {
    ouvrirModale(`
      <h2>Assigner un livreur</h2>
      <p class="sous-titre">Commande ${escapeHtml(idCommande)}</p>
      <p class="message-erreur" id="erreur-assign"></p>
      <div class="champ">
        <label>Livreur</label>
        <select id="select-livreur">
          <option value="">Choisir…</option>
          ${livreurs.map((l) => `<option value="${l.id_utilisateur}">${escapeHtml(l.nom)}</option>`).join("")}
        </select>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler">Annuler</button>
        <button class="btn btn-primaire" id="btn-confirmer">Assigner</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      boite.querySelector("#btn-confirmer").addEventListener("click", async (e) => {
        const idLivreur = boite.querySelector("#select-livreur").value;
        const erreur = boite.querySelector("#erreur-assign");
        if (!idLivreur) { erreur.textContent = "Choisis un livreur."; erreur.classList.add("visible"); return; }
        e.currentTarget.disabled = true;
        const r = await assignerRamassage(idCommande, idLivreur);
        if (r.ok) {
          afficherFlash("Ramassage assigné"); fermerModale(); rafraichir();
          creerNotification(idLivreur, null, "RAMASSAGE_ASSIGNE", `Nouveau ramassage assigné : ${idCommande}`, null).catch(() => {});
        }
        else { erreur.textContent = r.message; erreur.classList.add("visible"); e.currentTarget.disabled = false; }
      });
    });
  }

  await rafraichir();
  return () => fermerModale();
}
