import {
  listerColisDisponiblesPourLot, listerLots, listerColisDuLot, creerLot, modifierLot, assignerLot,
  listerLivreursActifs, validerRecuperationColis, creerNotification
} from "../repository.js";
import { afficherFlash, escapeHtml, formaterFcfa, tampon, alerteZone, ouvrirModale, fermerModale } from "../ui.js";

export const titre = "Lots & livraison";
export const sousTitre = "Regroupe les colis en lots et assigne les livreurs.";

export async function monter(conteneur, actionsContainer, profil) {
  const idHubAgent = profil?.role === "agent" ? profil.id_hub_affecte : null;
  const livreurs = await listerLivreursActifs();
  // Même principe que Ramassage : un seul onglet visible à la fois pour la
  // liste des lots, sinon les lots déjà assignés (qui peuvent rester listés
  // longtemps le temps de la tournée) noient ceux qui restent à assigner.
  let ongletActifLot = "A_ASSIGNER";

  async function rafraichir() {
    const [disponibles, lots] = await Promise.all([
      listerColisDisponiblesPourLot(idHubAgent), listerLots(idHubAgent)
    ]);

    conteneur.innerHTML = `
      <div class="bloc-tableau">
        <div class="tableau-titre">
          Colis disponibles au hub (${disponibles.length})
          <button class="btn btn-primaire btn-petit" id="btn-creer-lot" ${disponibles.length ? "" : "disabled"}>Créer un lot</button>
        </div>
        ${disponibles.length ? `
          <table class="donnees">
            <thead><tr><th></th><th>Colis</th><th>Destinataire</th><th>Zone</th><th>Montant</th></tr></thead>
            <tbody>
              ${disponibles.map((c) => `
                <tr>
                  <td><input type="checkbox" class="case-colis" value="${c.id_colis}"></td>
                  <td class="cellule-donnee">${escapeHtml(c.id_colis)}</td>
                  <td>${escapeHtml(c.destinataire_nom)}<br>${alerteZone(c.alerte_zone)}</td>
                  <td>${escapeHtml(c.code_zone || "—")}</td>
                  <td class="cellule-donnee">${formaterFcfa(c.montant_livraison)}</td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="etat-vide-tableau">Aucun colis en attente de lot.</div>`}
      </div>

      <div class="bloc-tableau">
        <div class="tableau-titre">Lots</div>
        <div class="onglets-panneau">
          <button class="onglet-panneau" data-onglet-lot="A_ASSIGNER" aria-current="${ongletActifLot === "A_ASSIGNER"}">
            À assigner (${lots.filter((l) => !l.id_livreur).length})
          </button>
          <button class="onglet-panneau" data-onglet-lot="DEJA_ASSIGNES" aria-current="${ongletActifLot === "DEJA_ASSIGNES"}">
            Déjà assignés (${lots.filter((l) => l.id_livreur).length})
          </button>
        </div>
        ${(() => {
          const lotsAffiches = lots.filter((l) => ongletActifLot === "A_ASSIGNER" ? !l.id_livreur : !!l.id_livreur);
          return `
        ${ongletActifLot === "A_ASSIGNER" && lotsAffiches.length ? `
          <div class="barre-assignation-groupee">
            <select id="select-livreur-groupe-lot">
              <option value="">Assigner la sélection à…</option>
              ${livreurs.map((l) => `<option value="${l.id_utilisateur}">${escapeHtml(l.nom)}</option>`).join("")}
            </select>
            <button class="btn btn-primaire btn-petit" id="btn-assigner-groupe-lot" disabled>Assigner la sélection</button>
            <span id="compteur-selection-lot" class="compteur-selection"></span>
          </div>` : ""}
        ${lotsAffiches.length ? `
          <table class="donnees">
            <thead><tr><th></th><th>Lot</th><th>Colis</th><th>Statut</th><th>Livreur</th><th></th></tr></thead>
            <tbody>
              ${lotsAffiches.map((l) => `
                <tr>
                  <td>${!l.id_livreur ? `<input type="checkbox" class="case-lot" value="${l.id_lot}">` : ""}</td>
                  <td class="cellule-donnee">${escapeHtml(l.id_lot)}${l.note ? "<br><span style=\"font-size:12px;color:var(--ink-soft);\">" + escapeHtml(l.note) + "</span>" : ""}</td>
                  <td>${l.nb_colis || 0}</td>
                  <td>${tampon(l.statut || "PREPARE")}</td>
                  <td>${livreurs.find((lv) => lv.id_utilisateur === l.id_livreur)?.nom || "—"}</td>
                  <td class="cellule-actions">
                    ${l.statut !== "RECUPERATION" ? `<button class="btn btn-discret btn-petit" data-voir-lot="${l.id_lot}">Voir</button>` : ""}
                    ${!l.id_livreur ? `<button class="btn btn-primaire btn-petit" data-assigner-lot="${l.id_lot}">Assigner</button>` : ""}
                    ${l.statut === "RECUPERATION" ? `<button class="btn btn-primaire btn-petit" data-voir-lot="${l.id_lot}">Valider colis par colis</button>` : ""}
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="etat-vide-tableau">${ongletActifLot === "A_ASSIGNER" ? "Aucun lot à assigner." : "Aucun lot déjà assigné."}</div>`}`;
        })()}
      </div>
    `;

    conteneur.querySelectorAll("[data-onglet-lot]").forEach((btn) => {
      btn.addEventListener("click", () => { ongletActifLot = btn.dataset.ongletLot; rafraichir(); });
    });

    conteneur.querySelector("#btn-creer-lot")?.addEventListener("click", async () => {
      const ids = [...conteneur.querySelectorAll(".case-colis:checked")].map((c) => c.value);
      if (!ids.length) { afficherFlash("Coche au moins un colis.", true); return; }
      const r = await creerLot(ids, null);
      if (r.ok) { afficherFlash(`Lot ${r.idLot} créé`); rafraichir(); } else afficherFlash(r.message, true);
    });

    conteneur.querySelectorAll("[data-voir-lot]").forEach((btn) => {
      btn.addEventListener("click", () => voirLot(btn.dataset.voirLot));
    });
    conteneur.querySelectorAll("[data-assigner-lot]").forEach((btn) => {
      btn.addEventListener("click", () => {
        // Même principe que pour le ramassage : si un livreur est déjà
        // choisi dans le sélecteur groupé, pas besoin de le redemander.
        const idLivreurPreselectionne = conteneur.querySelector("#select-livreur-groupe-lot")?.value;
        if (idLivreurPreselectionne) {
          assignerLotDirectement(btn.dataset.assignerLot, idLivreurPreselectionne, btn);
        } else {
          ouvrirAssignationLot(btn.dataset.assignerLot);
        }
      });
    });

    // Assignation groupée des lots (même mécanique que le panneau Ramassage).
    const casesLot = () => [...conteneur.querySelectorAll(".case-lot")];
    const selectGroupeLot = conteneur.querySelector("#select-livreur-groupe-lot");
    const btnAssignerGroupeLot = conteneur.querySelector("#btn-assigner-groupe-lot");
    const compteurSelectionLot = conteneur.querySelector("#compteur-selection-lot");
    if (selectGroupeLot) {
      function majEtatGroupeLot() {
        const nbCochees = casesLot().filter((c) => c.checked).length;
        compteurSelectionLot.textContent = nbCochees ? `${nbCochees} sélectionné${nbCochees > 1 ? "s" : ""}` : "";
        btnAssignerGroupeLot.disabled = !(nbCochees > 0 && selectGroupeLot.value);
      }
      casesLot().forEach((c) => c.addEventListener("change", majEtatGroupeLot));
      selectGroupeLot.addEventListener("change", majEtatGroupeLot);
      btnAssignerGroupeLot.addEventListener("click", async () => {
        const idLivreur = selectGroupeLot.value;
        const idsLot = casesLot().filter((c) => c.checked).map((c) => c.value);
        if (!idLivreur || !idsLot.length) return;
        btnAssignerGroupeLot.disabled = true;
        btnAssignerGroupeLot.textContent = "Assignation…";
        const resultats = await Promise.all(idsLot.map((id) => assignerLot(id, idLivreur)));
        const echecs = resultats.filter((r) => !r.ok).length;
        if (echecs) afficherFlash(`${idsLot.length - echecs}/${idsLot.length} lots assignés, ${echecs} échec(s).`, true);
        else afficherFlash(`${idsLot.length} lot${idsLot.length > 1 ? "s" : ""} assigné${idsLot.length > 1 ? "s" : ""}.`);
        if (idsLot.length - echecs > 0) {
          creerNotification(idLivreur, null, "LOT_ASSIGNE", `${idsLot.length - echecs} lot${idsLot.length - echecs > 1 ? "s" : ""} de livraison assigné${idsLot.length - echecs > 1 ? "s" : ""}`, null).catch(() => {});
        }
        rafraichir();
      });
    }
  }

  async function assignerLotDirectement(idLot, idLivreur, btn) {
    btn.disabled = true;
    const texteInitial = btn.textContent;
    btn.textContent = "Assignation…";
    const r = await assignerLot(idLot, idLivreur);
    if (r.ok) {
      afficherFlash("Lot assigné"); rafraichir();
      creerNotification(idLivreur, null, "LOT_ASSIGNE", `Nouveau lot de livraison assigné : ${idLot}`, null).catch(() => {});
    }
    else { afficherFlash(r.message, true); btn.disabled = false; btn.textContent = texteInitial; }
  }

  async function voirLot(idLot) {
    async function rendreContenu(boite) {
      const colis = await listerColisDuLot(idLot);
      boite.querySelector("#corps-lot").innerHTML = `
        <table class="donnees" style="margin-top:12px;">
          <thead><tr><th>Colis</th><th>Destinataire</th><th>Zone</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            ${colis.map((c) => `<tr>
              <td class="cellule-donnee">${escapeHtml(c.id_colis)}</td>
              <td>${escapeHtml(c.destinataire_nom)}<br><span style="color:var(--ink-soft);font-size:12px;">${escapeHtml(c.destinataire_adresse || "—")}</span><br>${alerteZone(c.alerte_zone)}</td>
              <td>${escapeHtml(c.code_zone || "—")}</td>
              <td>${tampon(c.statut)}</td>
              <td class="cellule-actions">${c.statut === "RECUP_DEMANDEE" ? `<button class="btn btn-primaire btn-petit" data-valider-colis="${c.id_colis}">Valider</button>` : ""}</td>
            </tr>`).join("")}
          </tbody>
        </table>`;
      boite.querySelectorAll("[data-valider-colis]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true; btn.textContent = "…";
          const r = await validerRecuperationColis(btn.dataset.validerColis);
          if (r.ok) {
            afficherFlash("Colis validé");
            await rendreContenu(boite); // reste ouvert, juste la liste qui se met à jour
            rafraichir(); // met à jour le tableau des lots en arrière-plan
          } else {
            afficherFlash(r.message, true); btn.disabled = false; btn.textContent = "Valider";
          }
        });
      });
    }

    ouvrirModale(`
      <h2>Contenu du lot ${escapeHtml(idLot)}</h2>
      <p class="sous-titre" style="margin-bottom:10px;">
        Valide chaque colis individuellement quand le livreur vient le récupérer — la remise se fait
        colis par colis, pas d'un coup pour tout le lot. La fenêtre reste ouverte entre deux validations.
      </p>
      <div id="corps-lot"></div>
      <div class="actions-bas"><button class="btn btn-discret" id="btn-fermer">Fermer</button></div>
    `, async (boite) => {
      boite.closest(".boite-modale")?.classList.add("boite-modale-large");
      boite.querySelector("#btn-fermer").addEventListener("click", fermerModale);
      await rendreContenu(boite);
    });
  }

  function ouvrirAssignationLot(idLot) {
    ouvrirModale(`
      <h2>Assigner un livreur au lot</h2>
      <p class="message-erreur" id="erreur-lot"></p>
      <div class="champ">
        <label>Livreur</label>
        <select id="select-livreur-lot">
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
        const idLivreur = boite.querySelector("#select-livreur-lot").value;
        const erreur = boite.querySelector("#erreur-lot");
        if (!idLivreur) { erreur.textContent = "Choisis un livreur."; erreur.classList.add("visible"); return; }
        e.currentTarget.disabled = true;
        const r = await assignerLot(idLot, idLivreur);
        if (r.ok) {
          afficherFlash("Lot assigné"); fermerModale(); rafraichir();
          creerNotification(idLivreur, null, "LOT_ASSIGNE", `Nouveau lot de livraison assigné : ${idLot}`, null).catch(() => {});
        }
        else { erreur.textContent = r.message; erreur.classList.add("visible"); e.currentTarget.disabled = false; }
      });
    });
  }

  await rafraichir();
  return () => fermerModale();
}
