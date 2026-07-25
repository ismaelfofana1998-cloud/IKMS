import {
  listerColisRetourRecu, deciderRetour, listerColisARetourner, assignerRetour,
  listerLivreursActifs, construireUrlPartage,
  listerRetoursEnRecuperation, validerRecuperationRetour, validerPointRelais, validerRetraitPointRelais,
  listerColisPointRelais, lireMontantDu, encaisserEspecesPointRelais, initierPaiementWavePointRelais, attendreConfirmationWave
} from "../repository.js";
import { afficherFlash, escapeHtml, formaterFcfa, libelleMotif, ouvrirModale, fermerModale, copierTexte } from "../ui.js";

export const titre = "Retours à traiter";
export const sousTitre = "";

const ETAPES_RETOUR = [
  ["DECISION", "À décider"],
  ["ASSIGNATION", "À assigner"],
  ["RECUPERATION", "Récupérations"],
  ["RELAIS", "Points relais"]
];

export async function monter(conteneur, actionsContainer, profil) {
  const idHubAgent = profil?.role === "agent" ? profil.id_hub_affecte : null;
  const livreurs = await listerLivreursActifs();
  let etapeActive = "DECISION";
  let etapeInitialisee = false;
  let donnees = { recus: [], aRetourner: [], recupsRetour: [], enPointRelais: [] };

  actionsContainer.innerHTML = `<button class="btn btn-discret" id="btn-actualiser-retours">Actualiser</button>`;

  function rendreRetours() {
    const { recus, aRetourner, recupsRetour, enPointRelais } = donnees;
    const compteurs = {
      DECISION: recus.length,
      ASSIGNATION: aRetourner.length,
      RECUPERATION: recupsRetour.length,
      RELAIS: enPointRelais.length
    };
    const total = Object.values(compteurs).reduce((somme, nombre) => somme + nombre, 0);

    if (!etapeInitialisee) {
      etapeActive = ETAPES_RETOUR.find(([id]) => compteurs[id] > 0)?.[0] || "DECISION";
      etapeInitialisee = true;
    }

    const decisionHtml = `
      <div class="tableau-defilant">
        <table class="donnees tableau-retours">
          <thead><tr><th>Colis</th><th>Destinataire</th><th>Motif</th><th></th></tr></thead>
          <tbody>
            ${recus.map((c) => `
              <tr>
                <td class="identifiant-metier">${escapeHtml(c.id_colis)}</td>
                <td>${escapeHtml(c.destinataire_nom)}</td>
                <td>${libelleMotif(c.motif_retour)}</td>
                <td class="cellule-actions">
                  <button class="btn btn-primaire btn-petit" data-choisir-decision="${c.id_colis}">Décider</button>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

    const assignationHtml = `
      <div class="barre-assignation-groupee barre-retours">
        <select id="select-livreur-groupe-retour">
          <option value="">Assigner la sélection à…</option>
          ${livreurs.map((l) => `<option value="${l.id_utilisateur}">${escapeHtml(l.nom)}</option>`).join("")}
        </select>
        <button class="btn btn-primaire btn-petit" id="btn-assigner-groupe-retour" disabled>Assigner</button>
        <span id="compteur-selection-retour" class="compteur-selection"></span>
      </div>
      <div class="tableau-defilant">
        <table class="donnees tableau-retours">
          <thead><tr><th></th><th>Colis</th><th>Destinataire</th><th>Motif</th><th></th></tr></thead>
          <tbody>
            ${aRetourner.map((c) => `
              <tr>
                <td><input type="checkbox" class="case-retour" value="${c.id_colis}"></td>
                <td class="identifiant-metier">${escapeHtml(c.id_colis)}</td>
                <td>${escapeHtml(c.destinataire_nom)}</td>
                <td>${libelleMotif(c.motif_retour)}</td>
                <td class="cellule-actions"><button class="btn btn-primaire btn-petit" data-assigner-retour="${c.id_colis}">Assigner</button></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

    const recuperationHtml = `
      <div class="tableau-defilant">
        <table class="donnees tableau-retours">
          <thead><tr><th>Colis</th><th>Destinataire</th><th>Livreur</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            ${recupsRetour.map((c) => `
              <tr>
                <td class="identifiant-metier">${escapeHtml(c.id_colis)}</td>
                <td>${escapeHtml(c.destinataire_nom)}</td>
                <td>${escapeHtml(livreurs.find((lv) => lv.id_utilisateur === c.id_livreur_retour)?.nom || "—")}</td>
                <td>${c.statut === "RETOUR_ASSIGNE" ? "Assigné" : "Récupération demandée"}</td>
                <td class="cellule-actions">
                  ${c.statut === "RETOUR_RECUP_DEMANDEE"
                    ? `<button class="btn btn-primaire btn-petit" data-valider-recuperation-retour="${c.id_colis}">Valider</button>`
                    : `<span class="texte-attente-retour">En attente du livreur</span>`}
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

    const relaisHtml = `
      <div class="tableau-defilant">
        <table class="donnees tableau-retours">
          <thead><tr><th>Colis</th><th>Destinataire</th><th>Hub</th><th></th></tr></thead>
          <tbody>
            ${enPointRelais.map((c) => `
              <tr>
                <td class="identifiant-metier">${escapeHtml(c.id_colis)}</td>
                <td>${escapeHtml(c.destinataire_nom)}<small>${escapeHtml(c.destinataire_tel)}</small></td>
                <td>${escapeHtml(c.hubs?.nom || "—")}</td>
                <td class="cellule-actions"><button class="btn btn-primaire btn-petit" data-retrait-point-relais="${c.id_colis}">Valider le retrait</button></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

    const fichiers = {
      DECISION: [recus, "Décisions à prendre", "Aucun retour en attente de décision.", decisionHtml],
      ASSIGNATION: [aRetourner, "Retours à assigner", "Aucun retour en attente d’assignation.", assignationHtml],
      RECUPERATION: [recupsRetour, "Récupérations au hub", "Aucune récupération de retour en attente.", recuperationHtml],
      RELAIS: [enPointRelais, "Retraits en point relais", "Aucun colis en attente de retrait.", relaisHtml]
    };
    const [elements, titreFile, messageVide, contenuFile] = fichiers[etapeActive];

    conteneur.innerHTML = `
      ${total ? `
        <div class="filtres-operations filtres-retours" role="tablist" aria-label="Étapes des retours">
          ${ETAPES_RETOUR.map(([id, libelle]) => `
            <button class="filtre-operation" role="tab" data-etape-retour="${id}" aria-selected="${etapeActive === id}" aria-current="${etapeActive === id}">
              <span>${libelle}</span><strong>${compteurs[id]}</strong>
            </button>`).join("")}
        </div>
        <div class="bloc-tableau retours-epures">
          <div class="barre-resultats-historique"><span>${titreFile}</span><small>${elements.length}</small></div>
          ${elements.length ? contenuFile : `<div class="etat-vide-tableau">${messageVide}</div>`}
        </div>
      ` : `
        <div class="etat-vide-retours">
          <strong>Aucun retour à traiter</strong>
          <span>Les prochains retours apparaîtront ici dès leur réception au hub.</span>
        </div>`}`;

    conteneur.querySelectorAll("[data-etape-retour]").forEach((bouton) => {
      bouton.addEventListener("click", () => {
        etapeActive = bouton.dataset.etapeRetour;
        rendreRetours();
      });
    });

    conteneur.querySelectorAll("[data-retrait-point-relais]").forEach((btn) => {
      btn.addEventListener("click", () => ouvrirRetraitPointRelais(btn.dataset.retraitPointRelais));
    });

    conteneur.querySelectorAll("[data-valider-recuperation-retour]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "Validation…";
        const r = await validerRecuperationRetour(btn.dataset.validerRecuperationRetour);
        if (r.ok) { afficherFlash("Récupération validée"); rafraichir(); }
        else { afficherFlash(r.message, true); btn.disabled = false; btn.textContent = "Valider la récupération"; }
      });
    });

    conteneur.querySelectorAll("[data-choisir-decision]").forEach((btn) => {
      btn.addEventListener("click", () => ouvrirChoixDecisionRetour(btn.dataset.choisirDecision));
    });
    conteneur.querySelectorAll("[data-assigner-retour]").forEach((btn) => {
      btn.addEventListener("click", () => {
        // Même principe que ramassage/lots : si un livreur est déjà choisi
        // dans le sélecteur groupé, pas besoin de le redemander.
        const idLivreurPreselectionne = conteneur.querySelector("#select-livreur-groupe-retour")?.value;
        if (idLivreurPreselectionne) {
          assignerDirectement(btn.dataset.assignerRetour, idLivreurPreselectionne, btn);
        } else {
          ouvrirAssignationRetour(btn.dataset.assignerRetour);
        }
      });
    });

    // Assignation groupée des retours (même mécanique que Ramassage/Lots).
    const casesRetour = () => [...conteneur.querySelectorAll(".case-retour")];
    const selectGroupe = conteneur.querySelector("#select-livreur-groupe-retour");
    const btnAssignerGroupe = conteneur.querySelector("#btn-assigner-groupe-retour");
    const compteurSelection = conteneur.querySelector("#compteur-selection-retour");
    if (selectGroupe) {
      function majEtatGroupe() {
        const nbCochees = casesRetour().filter((c) => c.checked).length;
        compteurSelection.textContent = nbCochees ? `${nbCochees} sélectionné${nbCochees > 1 ? "s" : ""}` : "";
        btnAssignerGroupe.disabled = !(nbCochees > 0 && selectGroupe.value);
      }
      casesRetour().forEach((c) => c.addEventListener("change", majEtatGroupe));
      selectGroupe.addEventListener("change", majEtatGroupe);
      btnAssignerGroupe.addEventListener("click", async () => {
        const idLivreur = selectGroupe.value;
        const idsColis = casesRetour().filter((c) => c.checked).map((c) => c.value);
        if (!idLivreur || !idsColis.length) return;
        btnAssignerGroupe.disabled = true;
        btnAssignerGroupe.textContent = "Assignation…";
        const resultats = await Promise.all(idsColis.map((id) => assignerRetour(id, idLivreur)));
        const echecs = resultats.filter((r) => !r.ok).length;
        if (echecs) afficherFlash(`${idsColis.length - echecs}/${idsColis.length} retours assignés, ${echecs} échec(s).`, true);
        else afficherFlash(`${idsColis.length} retour${idsColis.length > 1 ? "s" : ""} assigné${idsColis.length > 1 ? "s" : ""}.`);
        rafraichir();
      });
    }
  }

  async function rafraichir() {
    const [recus, aRetourner, recupsRetour, enPointRelais] = await Promise.all([
      listerColisRetourRecu(idHubAgent),
      listerColisARetourner(idHubAgent),
      listerRetoursEnRecuperation(idHubAgent),
      listerColisPointRelais(idHubAgent)
    ]);
    donnees = { recus, aRetourner, recupsRetour, enPointRelais };
    rendreRetours();
  }

  async function assignerDirectement(idColis, idLivreur, btn) {
    btn.disabled = true;
    const texteInitial = btn.textContent;
    btn.textContent = "Assignation…";
    const r = await assignerRetour(idColis, idLivreur);
    if (r.ok) { afficherFlash("Retour assigné"); rafraichir(); }
    else { afficherFlash(r.message, true); btn.disabled = false; btn.textContent = texteInitial; }
  }

  function ouvrirAssignationRetour(idColis) {
    ouvrirModale(`
      <h2>Assigner un livreur au retour</h2>
      <p class="message-erreur" id="erreur-retour"></p>
      <div class="champ">
        <label>Livreur</label>
        <select id="select-livreur-retour">
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
        const idLivreur = boite.querySelector("#select-livreur-retour").value;
        const erreur = boite.querySelector("#erreur-retour");
        if (!idLivreur) { erreur.textContent = "Choisis un livreur."; erreur.classList.add("visible"); return; }
        e.currentTarget.disabled = true;
        const r = await assignerRetour(idColis, idLivreur);
        if (r.ok) { afficherFlash("Retour assigné"); fermerModale(); rafraichir(); }
        else { erreur.textContent = r.message; erreur.classList.add("visible"); e.currentTarget.disabled = false; }
      });
    });
  }

  function ouvrirChoixDecisionRetour(idColis) {
    ouvrirModale(`
      <h2>Que faire de ce colis&nbsp;?</h2>
      <p class="sous-titre identifiant-metier">${escapeHtml(idColis)}</p>
      <div class="liste-decisions-retour">
        <button type="button" data-decision-retour="REPROGRAMMER">
          <strong>Reprogrammer</strong>
          <span>Préparer une nouvelle livraison.</span>
        </button>
        <button type="button" data-decision-retour="POINT_RELAIS">
          <strong>Point relais</strong>
          <span>Conserver le colis dans ce hub pour retrait.</span>
        </button>
        <button type="button" data-decision-retour="EXPEDITEUR">
          <strong>Retour expéditeur</strong>
          <span>Organiser la restitution à l’expéditeur.</span>
        </button>
      </div>
      <div class="actions-bas"><button class="btn btn-discret" id="btn-annuler-decision">Annuler</button></div>
    `, (boite) => {
      boite.querySelector("#btn-annuler-decision").addEventListener("click", fermerModale);
      boite.querySelectorAll("[data-decision-retour]").forEach((bouton) => {
        bouton.addEventListener("click", () => {
          const decision = bouton.dataset.decisionRetour;
          if (decision === "POINT_RELAIS") confirmerPointRelais(idColis);
          else confirmerDecision(idColis, decision);
        });
      });
    });
  }

  function confirmerDecision(idColis, decision) {
    ouvrirModale(`
      <h2>${decision === "REPROGRAMMER" ? "Reprogrammer la livraison" : "Retourner à l'expéditeur"}</h2>
      <p class="sous-titre">${decision === "REPROGRAMMER"
        ? "Appelle le destinataire pour lui proposer une nouvelle livraison. Le colis redevient disponible pour un nouveau lot."
        : "Le colis sera assigné à un livreur pour être rendu à l'expéditeur. Un nouveau code de retour va être généré."}</p>
      ${decision === "REPROGRAMMER" ? `
      <div class="champ">
        <label>Supplément convenu avec le destinataire (FCFA, optionnel)</label>
        <input id="supplement-reprogrammation" type="number" min="0" placeholder="0">
      </div>` : ""}
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler">Annuler</button>
        <button class="btn btn-primaire" id="btn-confirmer">Confirmer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      boite.querySelector("#btn-confirmer").addEventListener("click", async (e) => {
        e.currentTarget.disabled = true;
        const supplement = decision === "REPROGRAMMER"
          ? Number(boite.querySelector("#supplement-reprogrammation").value) || null
          : null;
        // Appel atomique : la décision et la lecture du lien de code se
        // font dans le même appel, la même transaction — voir le
        // correctif dédié dans repository.js / rpc_decider_retour.
        const r = await deciderRetour(idColis, decision, supplement);
        if (!r.ok) { afficherFlash(r.message, true); e.currentTarget.disabled = false; return; }

        if (decision === "EXPEDITEUR") {
          fermerModale();
          ouvrirLienCodeRetour(idColis, r.tokenCodeRetour);
        } else {
          afficherFlash(supplement ? `Décision enregistrée — supplément de ${supplement} FCFA ajouté` : "Décision enregistrée");
          fermerModale();
        }
        rafraichir();
      });
    });
  }

  // Point relais : contrairement à reprogrammer/retour expéditeur, aucun
  // motif à saisir — juste une confirmation, puis un SMS part vers le
  // destinataire avec le nom du hub où récupérer son colis.
  function confirmerPointRelais(idColis) {
    ouvrirModale(`
      <h2>Déposer en point relais</h2>
      <p class="sous-titre">
        À proposer au destinataire au téléphone, en alternative à la reprogrammation. Le colis
        reste à ce hub, un SMS lui confirme le nom du hub et le code à présenter pour le retrait.
      </p>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler">Annuler</button>
        <button class="btn btn-primaire" id="btn-confirmer">Confirmer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      boite.querySelector("#btn-confirmer").addEventListener("click", async (e) => {
        e.currentTarget.disabled = true;
        const r = await validerPointRelais(idColis);
        if (!r.ok) { afficherFlash(r.message, true); e.currentTarget.disabled = false; return; }
        fermerModale();
        afficherFlash("Colis en point relais — SMS envoyé au destinataire");
        rafraichir();
      });
    });
  }

  // Retrait par le destinataire : même code que la livraison normale
  // (visible sur le SMS reçu) — le serveur revérifie aussi la règle de
  // paiement, jamais une simple validation côté client.
  async function ouvrirRetraitPointRelais(idColis) {
    const solde = await lireMontantDu(idColis);
    ouvrirModale(`
      <h2>Valider le retrait</h2>
      ${solde > 0 ? `
        <p class="sous-titre">Solde à encaisser avant remise : <strong>${formaterFcfa(solde)} FCFA</strong>.</p>
        <p class="message-erreur" id="erreur-retrait"></p>
        <div class="choix-paiement" id="choix-paiement-retrait">
          <button class="btn btn-primaire btn-pleine-largeur" data-methode="ESPECES" style="margin-bottom:8px;">Espèces</button>
          <button class="btn btn-discret btn-pleine-largeur" data-methode="WAVE">Wave</button>
        </div>
        <div id="zone-code-retrait" hidden></div>
      ` : `
        <p class="sous-titre">Rien à encaisser — demande le code au destinataire (celui reçu par SMS).</p>
        <p class="message-erreur" id="erreur-retrait"></p>
        <div id="zone-code-retrait"></div>
      `}
      <div class="actions-bas"><button class="btn btn-discret" id="btn-annuler">Annuler</button></div>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      const erreur = boite.querySelector("#erreur-retrait");

      function afficherSaisieCode() {
        boite.querySelector("#choix-paiement-retrait")?.setAttribute("hidden", "");
        const zone = boite.querySelector("#zone-code-retrait");
        zone.hidden = false;
        zone.innerHTML = `
          <div class="champ">
            <label>Code de retrait</label>
            <input id="code-retrait" style="text-transform:uppercase;letter-spacing:0.1em;font-family:var(--police-donnee);" maxlength="8">
          </div>
          <button class="btn btn-primaire btn-pleine-largeur" id="btn-confirmer">Valider</button>`;
        zone.querySelector("#btn-confirmer").addEventListener("click", async (e) => {
          const code = zone.querySelector("#code-retrait").value.trim();
          if (!code) { erreur.textContent = "Le code est obligatoire."; erreur.classList.add("visible"); return; }
          e.currentTarget.disabled = true;
          const r = await validerRetraitPointRelais(idColis, code);
          if (r.ok) { afficherFlash("Colis remis au destinataire"); fermerModale(); rafraichir(); }
          else { erreur.textContent = r.message; erreur.classList.add("visible"); e.currentTarget.disabled = false; }
        });
      }

      if (solde <= 0) { afficherSaisieCode(); return; }

      boite.querySelectorAll("[data-methode]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const methode = e.currentTarget.dataset.methode;
          e.currentTarget.disabled = true;
          if (methode === "ESPECES") {
            const r = await encaisserEspecesPointRelais(idColis);
            if (!r.ok) { erreur.textContent = r.message; erreur.classList.add("visible"); e.currentTarget.disabled = false; return; }
            afficherFlash("Paiement encaissé");
            afficherSaisieCode();
          } else {
            e.currentTarget.textContent = "Création du paiement Wave…";
            const init = await initierPaiementWavePointRelais(idColis);
            if (!init.ok) { erreur.textContent = init.message; erreur.classList.add("visible"); e.currentTarget.disabled = false; e.currentTarget.textContent = "Wave"; return; }
            window.open(init.waveLaunchUrl, "_blank", "noopener");
            e.currentTarget.textContent = "En attente de confirmation Wave…";
            const confirme = await attendreConfirmationWave(init.idPaiement);
            if (confirme === true) { afficherFlash("Paiement Wave confirmé"); afficherSaisieCode(); }
            else if (confirme === false) { erreur.textContent = "Paiement Wave échoué. Réessaie ou choisis Espèces."; erreur.classList.add("visible"); e.currentTarget.disabled = false; e.currentTarget.textContent = "Wave"; }
            else { erreur.textContent = "Toujours en attente — vérifie sur le téléphone du destinataire, ou réessaie."; erreur.classList.add("visible"); e.currentTarget.disabled = false; e.currentTarget.textContent = "Wave"; }
          }
        });
      });
    });
  }

  function ouvrirLienCodeRetour(idColis, token) {
    if (!token) {
      afficherFlash("Décision enregistrée, mais le lien de code n'a pas pu être généré — vérifie depuis Liens ou réessaie.", true);
      return;
    }
    const url = construireUrlPartage(token);
    ouvrirModale(`
      <h2>Décision enregistrée</h2>
      <p class="sous-titre" style="margin-bottom:10px;">
        Envoie ce lien à l'expéditeur maintenant : il y trouvera le nouveau code à donner au livreur
        pour récupérer son colis (différent du code de ramassage initial).
      </p>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--creme);border-radius:8px;gap:10px;">
        <span style="font-size:13px;">Code de retour · ${escapeHtml(idColis)}</span>
        <button class="lien-copie" id="btn-partager-retour">Partager</button>
      </div>
      <div class="actions-bas"><button class="btn btn-primaire" id="btn-fermer">Terminé</button></div>
    `, (boite) => {
      boite.querySelector("#btn-fermer").addEventListener("click", fermerModale);
      boite.querySelector("#btn-partager-retour").addEventListener("click", async (e) => {
        if (navigator.share) {
          try { await navigator.share({ text: "Voici le code pour la reprise de ton colis en retour", url }); return; } catch { return; }
        }
        await copierTexte(url);
        e.currentTarget.textContent = "Copié";
        setTimeout(() => { e.currentTarget.textContent = "Partager"; }, 1800);
      });
    });
  }

  actionsContainer.querySelector("#btn-actualiser-retours").addEventListener("click", rafraichir);
  await rafraichir();
  return () => fermerModale();
}
