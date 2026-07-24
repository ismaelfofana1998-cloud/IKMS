import { creerCommande, listerCommandes, listerColisDeCommande, lireStatutsCommandes, lireLiensCommande, construireUrlPartage, lireCodeEntreprise, listerZones, estimerTarif, notifier, listerClientsPro } from "../repository.js";
import { afficherFlash, escapeHtml, formaterFcfa, tampon, ouvrirModale, fermerModale, copierTexte } from "../ui.js";
import { brancherAutocompletion, deviserZone, construireSelecteurZoneHtml, brancherSelecteurZone, definirZoneSelectionnee } from "../geo.js";

export const titre = "Commandes";
export const sousTitre = "Créer une commande au téléphone et suivre les commandes récentes.";

let compteurLigne = 0;

// Format ivoirien : 10 chiffres depuis 2021 (ex. 07 00 00 00 00). Accepte
// aussi le préfixe international +225/00225.
function validerTelephone(valeur) {
  const local = String(valeur || "").replace(/[\s.\-]/g, "").replace(/^(\+225|00225|225)/, "");
  if (!/^0\d{9}$/.test(local)) {
    return { valide: false, message: "numéro invalide (10 chiffres attendus, ex. 07 00 00 00 00)." };
  }
  return { valide: true, normalise: local };
}

function ligneColisHtml(index) {
  return `
    <div class="ligne-colis-form" data-ligne="${index}">
      <div class="champ"><label>Destinataire</label><input class="dest-nom" required placeholder="Nom"></div>
      <div class="champ"><label>Téléphone</label><input class="dest-tel" required placeholder="07..."></div>
      <div class="champ champ-adresse-centrale"><label>Adresse</label><input class="dest-adresse" placeholder="Quartier, repère" autocomplete="off"><div class="liste-suggestions" hidden></div></div>
      <div class="champ">
        <label>Zone</label>
        <div class="selecteur-zone selecteur-zone-dest"></div>
        <div class="prix-estime-centrale" data-prix-ligne hidden></div>
      </div>
      <button type="button" class="btn btn-discret btn-petit" data-retirer-ligne>Retirer</button>
    </div>`;
}

export async function monter(conteneur, actionsContainer, profil) {
  const idHubAgent = profil?.role === "agent" ? profil.id_hub_affecte : null;
  actionsContainer.innerHTML = `<button class="btn btn-primaire" id="btn-nouvelle-commande">+ Nouvelle commande</button>`;

  let modeAujourdhui = true;
  let recherche = "";

  conteneur.innerHTML = `
    <div class="bloc-tableau">
      <div class="tableau-titre" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <span id="titre-liste-commandes">Commandes d'aujourd'hui</span>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="recherche-commandes" placeholder="Rechercher : n° commande, nom, téléphone…" style="min-width:260px;">
          <button class="btn btn-discret btn-petit" id="btn-toutes-commandes">Voir toutes les commandes</button>
        </div>
      </div>
      <div id="zone-tableau"><div class="etat-vide-tableau">Chargement…</div></div>
    </div>`;

  const champRecherche = conteneur.querySelector("#recherche-commandes");
  const btnToutes = conteneur.querySelector("#btn-toutes-commandes");
  const titreListe = conteneur.querySelector("#titre-liste-commandes");

  let minuteurRecherche = null;
  champRecherche.addEventListener("input", () => {
    clearTimeout(minuteurRecherche);
    minuteurRecherche = setTimeout(() => { recherche = champRecherche.value; rafraichir(); }, 350);
  });
  btnToutes.addEventListener("click", () => {
    modeAujourdhui = !modeAujourdhui;
    btnToutes.textContent = modeAujourdhui ? "Voir toutes les commandes" : "Revenir à aujourd'hui";
    titreListe.textContent = modeAujourdhui ? "Commandes d'aujourd'hui" : "Toutes les commandes";
    rafraichir();
  });

  async function rafraichir() {
    const commandes = await listerCommandes({ idHubAgent, aujourdhuiSeulement: modeAujourdhui, recherche });
    const statuts = await lireStatutsCommandes(commandes.map((c) => c.id_commande));
    const zone = conteneur.querySelector("#zone-tableau");
    if (!commandes.length) {
      zone.innerHTML = `<div class="etat-vide-tableau">${recherche ? "Aucune commande ne correspond à cette recherche." : modeAujourdhui ? "Aucune commande aujourd'hui." : "Aucune commande pour le moment."}</div>`;
      return;
    }
    zone.innerHTML = `
      <table class="donnees">
        <thead><tr><th>Commande</th><th>Expéditeur</th><th>Hub</th><th>Colis</th><th>Statut</th><th>Paiement</th><th>Créée</th><th></th></tr></thead>
        <tbody>
          ${commandes.map((c) => {
            const s = statuts[c.id_commande] || { statut: "EN_ATTENTE", nb_colis: 0 };
            return `
              <tr${c.alerte_zone_expediteur ? ' class="ligne-alerte-zone"' : ""}>
                <td class="cellule-donnee">${escapeHtml(c.id_commande)}</td>
                <td>
                  ${escapeHtml(c.expediteur_nom)}<br><span style="color:var(--ink-soft);font-size:12px;">${escapeHtml(c.expediteur_tel)}</span>
                  ${c.alerte_zone_expediteur ? `<div class="badge-alerte-zone">⚠️ Zone à vérifier — ${escapeHtml(c.alerte_zone_expediteur)}</div>` : ""}
                </td>
                <td>${escapeHtml(c.hubs?.nom || "—")}</td>
                <td><button class="btn btn-discret btn-petit" data-voir-colis="${c.id_commande}">${s.nb_colis} colis</button></td>
                <td>${tampon(s.statut)}</td>
                <td>${c.mode_paiement === "A_LA_LIVRAISON" ? "À la livraison" : c.mode_paiement === "PAR_EXPEDITEUR" ? "Par expéditeur" : "Sans paiement"}</td>
                <td style="color:var(--ink-soft);font-size:12px;">${new Date(c.cree_le).toLocaleString("fr-FR")}</td>
                <td class="cellule-actions"><button class="btn btn-discret btn-petit" data-liens="${c.id_commande}">Liens</button></td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>`;

    zone.querySelectorAll("[data-liens]").forEach((btn) => {
      btn.addEventListener("click", () => ouvrirLiens(btn.dataset.liens));
    });
    zone.querySelectorAll("[data-voir-colis]").forEach((btn) => {
      btn.addEventListener("click", () => ouvrirColis(btn.dataset.voirColis));
    });
  }

  async function ouvrirColis(idCommande) {
    const colis = await listerColisDeCommande(idCommande);
    ouvrirModale(`
      <h2>Colis de la commande ${escapeHtml(idCommande)}</h2>
      <table class="donnees" style="margin-top:12px;">
        <thead><tr><th>Colis</th><th>Destinataire</th><th>Zone</th><th>Statut</th><th>Montant</th></tr></thead>
        <tbody>
          ${colis.map((c) => `
            <tr${c.alerte_zone ? ' class="ligne-alerte-zone"' : ""}>
              <td class="cellule-donnee">${escapeHtml(c.id_colis)}</td>
              <td>
                ${escapeHtml(c.destinataire_nom)}<br><span style="color:var(--ink-soft);font-size:12px;">${escapeHtml(c.destinataire_tel)}</span>
                ${c.alerte_zone ? `<div class="badge-alerte-zone">⚠️ Zone à vérifier — ${escapeHtml(c.alerte_zone)}</div>` : ""}
              </td>
              <td>${escapeHtml(c.code_zone || "—")}</td>
              <td>${tampon(c.statut)}</td>
              <td>${formaterFcfa(c.montant_livraison)} FCFA</td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="actions-bas"><button class="btn btn-discret" id="btn-fermer-colis">Fermer</button></div>
    `, (boite) => {
      boite.querySelector("#btn-fermer-colis").addEventListener("click", fermerModale);
    });
  }

  async function partagerLien(texte, url, bouton) {
    if (navigator.share) {
      try { await navigator.share({ text: texte, url }); return; } catch { return; }
    }
    await copierTexte(url);
    const original = bouton.textContent;
    bouton.textContent = "Copié";
    setTimeout(() => { bouton.textContent = original; }, 1800);
  }

  function contenuLiens(liens) {
    return `
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${liens.map((l) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--creme);border-radius:8px;gap:10px;">
            <span style="font-size:13px;">${l.type === "POSITION_EXPEDITEUR" ? "Position expéditeur" : "Position destinataire"}${l.destinataire_nom ? " · " + escapeHtml(l.destinataire_nom) : (l.id_colis ? " · " + escapeHtml(l.id_colis) : "")}</span>
            <button class="lien-copie" data-partager="${construireUrlPartage(l.token)}" data-texte="${l.type === "POSITION_EXPEDITEUR" ? "Voici le lien pour partager ta position au livreur" : "Voici le lien pour partager ta position au livreur"}">Partager</button>
          </div>`).join("") || "<p>Aucun lien trouvé.</p>"}
      </div>`;
  }

  function attacherPartage(boite) {
    boite.querySelectorAll("[data-partager]").forEach((b) => {
      b.addEventListener("click", () => partagerLien(b.dataset.texte, b.dataset.partager, b));
    });
  }

  async function ouvrirLiens(idCommande) {
    const liens = await lireLiensCommande(idCommande);
    ouvrirModale(`
      <h2>Liens de partage</h2>
      <p class="sous-titre">Partage ou renvoie n'importe lequel de ces liens à tout moment.</p>
      ${contenuLiens(liens)}
      <div class="actions-bas"><button class="btn btn-discret" id="btn-fermer">Fermer</button></div>
    `, (boite) => {
      boite.querySelector("#btn-fermer").addEventListener("click", fermerModale);
      attacherPartage(boite);
    });
  }

  async function ouvrirFormulaireCommande() {
    compteurLigne = 1;
    const zones = (await listerZones()).filter((z) => z.actif);
    const codeEntreprise = await lireCodeEntreprise(profil.id_entreprise);
    const clients = (await listerClientsPro()).filter((c) => c.actif);
    let idClientProSelectionne = null;
    ouvrirModale(`
      <h2>Nouvelle commande</h2>
      <p class="sous-titre">Commande saisie au téléphone pour un client.</p>
      <p class="message-erreur" id="erreur-commande"></p>
      <form id="form-commande" class="formulaire">
        <div class="champ champ-adresse-centrale">
          <label>Client pro (optionnel)</label>
          <input id="client-recherche" placeholder="Rechercher par nom ou téléphone…" autocomplete="off">
          <div class="liste-suggestions" id="suggestions-client" hidden></div>
          <div id="client-choisi" style="display:none;margin-top:6px;font-size:12.5px;color:var(--valide);font-weight:700;"></div>
        </div>
        <div class="ligne-champs">
          <div class="champ"><label>Nom expéditeur</label><input id="exp-nom" required placeholder="Nom complet"></div>
          <div class="champ"><label>Téléphone expéditeur</label><input id="exp-tel" required placeholder="07..."></div>
        </div>
        <div class="champ champ-adresse-centrale"><label>Adresse de ramassage</label><input id="exp-adresse" placeholder="Quartier, repère" autocomplete="off"><div class="liste-suggestions" id="suggestions-exp-adresse" hidden></div></div>
        <div class="champ"><label>Zone de ramassage</label><div class="selecteur-zone" id="selecteur-exp-zone"></div></div>
        <div class="champ">
          <label>Paiement</label>
          <select id="mode-paiement">
            <option value="A_LA_LIVRAISON">À la livraison</option>
            <option value="PAR_EXPEDITEUR">Par l'expéditeur</option>
            <option value="SANS_PAIEMENT">Facturation (compte client)</option>
          </select>
        </div>
        <div>
          <label style="font-size:12.5px;font-weight:700;color:var(--ink-soft);">Colis</label>
          <div class="liste-colis-form" id="liste-colis">${ligneColisHtml(0)}</div>
          <button type="button" class="btn btn-discret btn-petit" id="btn-ajouter-ligne" style="margin-top:8px;">+ Ajouter un colis</button>
        </div>
        <div class="actions-bas">
          <button type="button" class="btn btn-discret" id="btn-annuler">Annuler</button>
          <button type="submit" class="btn btn-primaire" id="btn-valider-commande">Créer la commande</button>
        </div>
      </form>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      const conteneurExpZone = boite.querySelector("#selecteur-exp-zone");
      conteneurExpZone.innerHTML = construireSelecteurZoneHtml("exp-zone");
      brancherSelecteurZone(conteneurExpZone, zones);
      const zoneDepartEl = boite.querySelector("#exp-zone");

      // Recherche client pro : filtre simple par nom/téléphone au fur et à
      // mesure de la saisie, comme l'autocomplétion d'adresse. Sélectionner
      // un résultat pré-remplit l'expéditeur (toujours modifiable ensuite)
      // et rattache la commande à ce compte (portefeuille auto-débité).
      const champClientRecherche = boite.querySelector("#client-recherche");
      const suggestionsClient = boite.querySelector("#suggestions-client");
      const clientChoisiEl = boite.querySelector("#client-choisi");
      champClientRecherche.addEventListener("input", () => {
        idClientProSelectionne = null;
        clientChoisiEl.style.display = "none";
        const texte = champClientRecherche.value.trim().toLowerCase();
        if (texte.length < 2) { suggestionsClient.hidden = true; return; }
        const resultats = clients.filter((c) =>
          c.nom.toLowerCase().includes(texte) || c.telephone.includes(texte)
        ).slice(0, 8);
        if (!resultats.length) { suggestionsClient.hidden = true; return; }
        suggestionsClient.innerHTML = resultats.map((c, i) =>
          `<button type="button" class="suggestion-adresse" data-index="${i}">${escapeHtml(c.nom)} · ${escapeHtml(c.telephone)}</button>`
        ).join("");
        suggestionsClient.hidden = false;
        suggestionsClient.querySelectorAll("[data-index]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const c = resultats[Number(btn.dataset.index)];
            idClientProSelectionne = c.id_client;
            champClientRecherche.value = "";
            suggestionsClient.hidden = true;
            clientChoisiEl.style.display = "block";
            clientChoisiEl.textContent = `Client rattaché : ${c.nom} (portefeuille : ${formaterFcfa(c.solde_portefeuille)} FCFA)`;
            boite.querySelector("#exp-nom").value = c.nom;
            boite.querySelector("#exp-tel").value = c.telephone;
            if (c.adresse) boite.querySelector("#exp-adresse").value = c.adresse;
            // Suggestion par défaut seulement — l'agent peut la changer,
            // et le mode réellement sélectionné est désormais respecté
            // (avant : la facturation était forcée quel que soit le choix).
            boite.querySelector("#mode-paiement").value = "SANS_PAIEMENT";
          });
        });
      });
      champClientRecherche.addEventListener("blur", () => {
        setTimeout(() => { suggestionsClient.hidden = true; }, 150);
      });

      // Essaie de deviner la zone à partir de la commune détectée par le
      // géocodeur. Se met à jour à chaque nouvelle adresse tant que la
      // personne n'a pas fait un choix manuel elle-même (voir la même
      // logique, plus commentée, dans expediteur.js). Opère sur le
      // CONTENEUR du sélecteur (pas juste un select) : deviserZone() peut
      // renvoyer une sous-zone précise, il faut positionner les deux
      // niveaux (commune + secteur), pas seulement la valeur finale cachée.
      function suggererZone(gps, conteneurEl) {
        if (!gps?.commune) return;
        const champCache = conteneurEl.querySelector("input[type=hidden]");
        if (champCache.value && conteneurEl.dataset.autoSuggere !== "1") return;
        const zoneDevinee = deviserZone(gps.commune, zones);
        if (zoneDevinee) {
          definirZoneSelectionnee(conteneurEl, zoneDevinee, zones);
          conteneurEl.dataset.autoSuggere = "1";
        }
      }
      // Un choix manuel (clic réel sur la commune OU le secteur, jamais
      // un événement déclenché par le code) efface le suivi automatique --
      // la prochaine adresse tapée ne viendra plus écraser ce choix.
      function surveillerChoixManuel(conteneurEl) {
        conteneurEl.querySelectorAll(".commune-select, .secteur-select").forEach((sel) => {
          sel.addEventListener("change", (e) => { if (e.isTrusted) delete conteneurEl.dataset.autoSuggere; });
        });
      }
      surveillerChoixManuel(conteneurExpZone);

      async function estimerPrixLigne(ligneEl) {
        const zoneArrivee = ligneEl.querySelector(".dest-zone").value;
        const prixEl = ligneEl.querySelector("[data-prix-ligne]");
        const montant = await estimerTarif(codeEntreprise, zoneDepartEl.value, zoneArrivee);
        if (montant == null) { prixEl.hidden = true; return; }
        prixEl.textContent = `≈ ${new Intl.NumberFormat("fr-FR").format(montant)} FCFA`;
        prixEl.hidden = false;
      }
      function rebrancherLigneColis(ligneEl) {
        const conteneurZone = ligneEl.querySelector(".selecteur-zone-dest");
        conteneurZone.innerHTML = construireSelecteurZoneHtml(null, "dest-zone");
        brancherSelecteurZone(conteneurZone, zones);
        surveillerChoixManuel(conteneurZone);
        brancherAutocompletion(ligneEl.querySelector(".dest-adresse"), ligneEl.querySelector(".liste-suggestions"),
          (gps) => suggererZone(gps, conteneurZone));
        ligneEl.querySelector(".dest-zone").addEventListener("change", () => estimerPrixLigne(ligneEl));
      }
      brancherAutocompletion(boite.querySelector("#exp-adresse"), boite.querySelector("#suggestions-exp-adresse"),
        (gps) => suggererZone(gps, conteneurExpZone));
      boite.querySelectorAll("[data-ligne]").forEach(rebrancherLigneColis);
      zoneDepartEl.addEventListener("change", () => {
        boite.querySelectorAll("[data-ligne]").forEach(estimerPrixLigne);
      });
      boite.querySelector("#btn-ajouter-ligne").addEventListener("click", () => {
        boite.querySelector("#liste-colis").insertAdjacentHTML("beforeend", ligneColisHtml(compteurLigne++));
        rebrancherLigneColis(boite.querySelector("#liste-colis").lastElementChild);
      });
      boite.querySelector("#liste-colis").addEventListener("click", (e) => {
        if (e.target.matches("[data-retirer-ligne]")) e.target.closest("[data-ligne]").remove();
      });

      boite.querySelector("#form-commande").addEventListener("submit", async (e) => {
        e.preventDefault();
        const erreur = boite.querySelector("#erreur-commande");
        const bouton = boite.querySelector("#btn-valider-commande");

        // Verrou pose EN TOUT PREMIER, avant toute validation : ferme la
        // fenetre de re-entrance au maximum (double clic, Entree + clic...).
        if (bouton.disabled) return;
        bouton.disabled = true;

        function rouvrir(message) {
          erreur.textContent = message; erreur.classList.add("visible");
          bouton.disabled = false; bouton.textContent = "Créer la commande";
        }

        const zoneDepart = boite.querySelector("#exp-zone").value.trim().toUpperCase();
        if (!zoneDepart) return rouvrir("Choisis la zone de ramassage.");

        const expTelValidation = validerTelephone(boite.querySelector("#exp-tel").value);
        if (!expTelValidation.valide) return rouvrir(`Téléphone expéditeur : ${expTelValidation.message}`);

        const lignes = [...boite.querySelectorAll("[data-ligne]")];
        const colis = lignes.map((l) => ({
          destinataire_nom: l.querySelector(".dest-nom").value.trim(),
          destinataire_tel: l.querySelector(".dest-tel").value.trim(),
          destinataire_adresse: l.querySelector(".dest-adresse").value.trim(),
          code_zone: l.querySelector(".dest-zone").value.trim().toUpperCase()
        })).filter((c) => c.destinataire_nom && c.destinataire_tel);

        if (!colis.length) return rouvrir("Ajoute au moins un colis.");
        if (colis.some((c) => !c.code_zone)) return rouvrir("Choisis la zone de livraison de chaque colis.");
        for (const c of colis) {
          const v = validerTelephone(c.destinataire_tel);
          if (!v.valide) return rouvrir(`Téléphone de ${c.destinataire_nom} : ${v.message}`);
          c.destinataire_tel = v.normalise;
        }

        bouton.textContent = "Création…";

        const { data, error } = await creerCommande({
          expediteurNom: boite.querySelector("#exp-nom").value.trim(),
          expediteurTel: expTelValidation.normalise,
          expediteurAdresse: boite.querySelector("#exp-adresse").value.trim(),
          modePaiement: boite.querySelector("#mode-paiement").value,
          colis,
          codeEntreprise,
          zoneDepart,
          idClientPro: idClientProSelectionne
        });

        if (error) {
          rouvrir(error.message || "Erreur lors de la création.");
          return;
        }

        fermerModale();
        notifier("COMMANDE_CREEE", { idCommande: data[0].id_commande });
        const total = data.reduce((s, c) => s + Number(c.montant_livraison || 0), 0);
        afficherFlash(`Commande créée : ${data[0].id_commande} (${data.length} colis · ${new Intl.NumberFormat("fr-FR").format(total)} FCFA)`);

        // Popup automatique (comme sur la page publique) : sinon l'agent
        // risque tout simplement d'oublier de partager la position, puisque
        // ce n'était avant accessible qu'en rouvrant "Liens" plus tard.
        const liens = [
          { type: "POSITION_EXPEDITEUR", token: data[0].token_expediteur },
          ...data.map((c, i) => ({ type: "POSITION_DESTINATAIRE", token: c.token_destinataire, destinataire_nom: colis[i]?.destinataire_nom }))
        ];

        ouvrirModale(`
          <h2>Commande créée · ${escapeHtml(data[0].id_commande)}</h2>
          <p class="sous-titre" style="margin-bottom:10px;">
            Code ramassage : <strong>${escapeHtml(data[0].code_ramassage)}</strong>.
            Partage la position de l'expéditeur au livreur, et le lien "destinataire" à chaque personne.
          </p>
          ${contenuLiens(liens)}
          <div class="actions-bas"><button class="btn btn-primaire" id="btn-fermer-liens">Terminé</button></div>
        `, (boite) => {
          boite.querySelector("#btn-fermer-liens").addEventListener("click", fermerModale);
          attacherPartage(boite);
        });

        rafraichir();
      });
    });
  }

  actionsContainer.querySelector("#btn-nouvelle-commande").addEventListener("click", ouvrirFormulaireCommande);
  await rafraichir();

  return () => fermerModale();
}
