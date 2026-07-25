import {
  listerCommandesEnRamassage,
  listerLivreursActifs,
  assignerRamassage,
  listerColisAValider,
  validerDepot,
  validerRetourRecu,
  listerColisDisponiblesPourLot,
  listerLots,
  listerColisDuLot,
  listerColisDesLots,
  creerLot,
  assignerLot,
  validerRecuperationColis,
  creerNotification,
  lireLiensCommande,
  construireUrlPartage
} from "../repository.js";
import {
  afficherFlash,
  escapeHtml,
  formaterFcfa,
  tampon,
  alerteZone,
  ouvrirModale,
  fermerModale,
  copierTexte
} from "../ui.js";
import { ouvrirCreationCommande } from "./commande.js";

export const titre = "Opérations";
export const sousTitre = "";

const FILTRES = [
  ["RAMASSAGE", "Ramassages"],
  ["RECEPTION", "Réceptions"],
  ["LOT", "Mise en lot"],
  ["DEPART", "Départs"],
  ["LIVRAISON", "En livraison"]
];

export async function monter(conteneur, actionsContainer, profil) {
  const idHubAgent = profil?.role === "agent" ? profil.id_hub_affecte : null;
  let filtreActif = "RAMASSAGE";
  let livreurs = [];
  let nettoyageCreation = null;
  let chargement = false;
  let filtreInitialise = false;

  actionsContainer.innerHTML = `
    <button class="btn btn-discret" id="btn-actualiser-operations">Actualiser</button>
    <button class="btn btn-primaire" id="btn-nouvelle-commande">+ Nouvelle commande</button>`;

  const visible = (section) => filtreActif === section;

  const nomLivreur = (id) =>
    livreurs.find((livreur) => livreur.id_utilisateur === id)?.nom || "—";

  function enteteSection(libelle, nombre) {
    return `
      <div class="tableau-titre entete-etape-operation">
        <span>${libelle} <small>${nombre}</small></span>
      </div>`;
  }

  function sectionRamassages(commandes) {
    if (!visible("RAMASSAGE")) return "";
    return `
      <section class="bloc-tableau etape-operation" data-section-operation="RAMASSAGE">
        ${enteteSection("Ramassages", commandes.length)}
        ${commandes.length ? `
          <div class="barre-assignation-groupee">
            <select id="select-livreur-ramassages">
              <option value="">Assigner la sélection à…</option>
              ${livreurs.map((livreur) => `<option value="${livreur.id_utilisateur}">${escapeHtml(livreur.nom)}</option>`).join("")}
            </select>
            <button class="btn btn-primaire btn-petit" id="btn-assigner-ramassages" disabled>Assigner</button>
            <span id="compteur-ramassages" class="compteur-selection"></span>
          </div>
          <div class="tableau-defilant">
            <table class="donnees">
              <thead><tr><th></th><th>Ramassage</th><th>Commande</th><th>Expéditeur</th><th>Adresse</th><th>Hub</th><th>Livreur</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                ${commandes.map((commande) => `
                  <tr>
                    <td><input type="checkbox" class="case-operation-ramassage" value="${escapeHtml(commande.id_commande)}"></td>
                    <td class="identifiant-operation identifiant-metier">${escapeHtml(commande.id_ramassage || "—")}</td>
                    <td class="identifiant-operation identifiant-metier">${escapeHtml(commande.id_commande)}</td>
                    <td>${escapeHtml(commande.expediteur_nom)}<br><small>${escapeHtml(commande.expediteur_tel)}</small></td>
                    <td>
                      <span class="adresse-operation" title="${escapeHtml(commande.expediteur_adresse || "—")}">${escapeHtml(commande.expediteur_adresse || "—")}</span>
                      ${alerteZone(commande.alerte_zone_expediteur)}
                    </td>
                    <td>${escapeHtml(commande.hubs?.nom || "—")}</td>
                    <td>${escapeHtml(nomLivreur(commande.id_livreur_ramassage))}</td>
                    <td>${tampon(commande.id_livreur_ramassage ? "A_RAMASSER" : "CREE")}</td>
                    <td class="cellule-actions">
                      <button class="btn btn-discret btn-petit" data-partager-position-expediteur="${escapeHtml(commande.id_commande)}" title="Partager le lien de position de l’expéditeur">
                        Position
                      </button>
                      <button class="btn btn-primaire btn-petit" data-assigner-ramassage="${escapeHtml(commande.id_commande)}">
                        ${commande.id_livreur_ramassage ? "Réassigner" : "Assigner"}
                      </button>
                    </td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>` : `<div class="etat-vide-tableau">Aucun ramassage en attente.</div>`}
      </section>`;
  }

  function sectionReceptions(colis) {
    if (!visible("RECEPTION")) return "";
    return `
      <section class="bloc-tableau etape-operation" data-section-operation="RECEPTION">
        ${enteteSection("Réceptions au hub", colis.length)}
        ${colis.length ? `
          <div class="tableau-defilant">
            <table class="donnees">
              <thead><tr><th>Colis</th><th>Commande</th><th>Destinataire</th><th>Statut annoncé</th><th></th></tr></thead>
              <tbody>
                ${colis.map((element) => {
                  const alerte = element.alerte_zone || element.commandes?.alerte_zone_expediteur;
                  return `
                    <tr${alerte ? ' class="ligne-alerte-zone"' : ""}>
                      <td class="identifiant-operation identifiant-metier">${escapeHtml(element.id_colis)}</td>
                      <td class="identifiant-operation identifiant-metier">${escapeHtml(element.id_commande)}</td>
                      <td>
                        ${escapeHtml(element.destinataire_nom)}
                        ${element.statut === "RETOUR_DEMANDE" && element.motif_choix_hub_retour
                          ? `<small class="motif-hub-retour">Choix du hub : ${escapeHtml(element.motif_choix_hub_retour)}</small>`
                          : ""}
                        ${alerteZone(alerte)}
                      </td>
                      <td>${tampon(element.statut)}</td>
                      <td class="cellule-actions">
                        ${element.statut === "DEPOT_DEMANDE"
                          ? `<button class="btn btn-primaire btn-petit" data-valider-depot="${escapeHtml(element.id_colis)}">Réceptionner le colis</button>`
                          : `<button class="btn btn-primaire btn-petit" data-valider-retour="${escapeHtml(element.id_colis)}">Confirmer le hub et réceptionner</button>`}
                      </td>
                    </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>` : `<div class="etat-vide-tableau">Aucune réception en attente.</div>`}
      </section>`;
  }

  function sectionMiseEnLot(colis) {
    if (!visible("LOT")) return "";
    return `
      <section class="bloc-tableau etape-operation" data-section-operation="LOT">
        ${enteteSection("Colis à mettre en lot", colis.length)}
        ${colis.length ? `
          <div class="barre-selection-operation">
            <label><input type="checkbox" id="case-tous-colis-lot"> Tout sélectionner</label>
            <span id="compteur-colis-lot" class="compteur-selection"></span>
            <button class="btn btn-primaire btn-petit action-selection-operation" id="btn-creer-lot-operation" disabled>Créer le lot</button>
          </div>
          <div class="tableau-defilant">
            <table class="donnees">
              <thead><tr><th></th><th>Colis</th><th>Destinataire</th><th>Zone</th><th>Montant</th></tr></thead>
              <tbody>
                ${colis.map((element) => `
                  <tr>
                    <td><input type="checkbox" class="case-operation-colis-lot" value="${escapeHtml(element.id_colis)}"></td>
                    <td class="identifiant-operation identifiant-metier">${escapeHtml(element.id_colis)}</td>
                    <td>${escapeHtml(element.destinataire_nom)}<br>${alerteZone(element.alerte_zone)}</td>
                    <td>${escapeHtml(element.code_zone || "—")}</td>
                    <td class="cellule-donnee">${formaterFcfa(element.montant_livraison)} FCFA</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>` : `<div class="etat-vide-tableau">Aucun colis disponible pour un lot.</div>`}
      </section>`;
  }

  function sectionLots(lots, section) {
    if (!visible(section)) return "";
    const lotsAffiches = lots.filter((lot) =>
      section === "LIVRAISON" ? lot.statut === "EN_TOURNEE" : lot.statut !== "EN_TOURNEE"
    );
    const titreSection = section === "LIVRAISON" ? "Livraisons en cours" : "Lots et départs du hub";
    const lotsAAssigner = lotsAffiches.filter((lot) => !lot.id_livreur);
    if (section === "DEPART") {
      return `
        <section class="etape-operation" data-section-operation="DEPART">
          <div class="bloc-tableau">
            ${enteteSection(titreSection, lotsAffiches.length)}
            ${lotsAAssigner.length ? `
              <div class="barre-assignation-groupee">
                <select id="select-livreur-lots">
                  <option value="">Assigner les lots sélectionnés à…</option>
                  ${livreurs.map((livreur) => `<option value="${livreur.id_utilisateur}">${escapeHtml(livreur.nom)}</option>`).join("")}
                </select>
                <button class="btn btn-primaire btn-petit" id="btn-assigner-lots" disabled>Assigner</button>
                <span id="compteur-lots" class="compteur-selection"></span>
              </div>` : ""}
          </div>
          ${lotsAffiches.length ? `
            <div class="liste-lots-depart">
              ${lotsAffiches.map((lot) => `
                <article class="bloc-tableau lot-depart-operation">
                  <div class="entete-lot-depart">
                    <div class="lot-depart-identite">
                      ${!lot.id_livreur
                        ? `<input type="checkbox" class="case-operation-lot" value="${escapeHtml(lot.id_lot)}" aria-label="Sélectionner ${escapeHtml(lot.id_lot)}">`
                        : ""}
                      <strong class="identifiant-operation identifiant-metier">${escapeHtml(lot.id_lot)}</strong>
                      <span>${lot.colis?.length || lot.nb_colis || 0} colis</span>
                    </div>
                    <div class="lot-depart-meta">
                      <span>${escapeHtml(nomLivreur(lot.id_livreur))}</span>
                      ${tampon(lot.statut || "PREPARE")}
                      <button class="btn btn-${lot.id_livreur ? "discret" : "primaire"} btn-petit" data-assigner-lot="${escapeHtml(lot.id_lot)}">
                        ${lot.id_livreur ? "Réassigner" : "Assigner la livraison"}
                      </button>
                    </div>
                  </div>
                  ${lot.note ? `<p class="note-lot-depart">${escapeHtml(lot.note)}</p>` : ""}
                  <div class="tableau-defilant">
                    <table class="donnees tableau-colis-depart">
                      <thead><tr><th>Colis</th><th>Destinataire</th><th>Zone</th><th>Statut</th><th></th></tr></thead>
                      <tbody>
                        ${(lot.colis || []).map((element) => `
                          <tr>
                            <td class="identifiant-operation identifiant-metier">${escapeHtml(element.id_colis)}</td>
                            <td>
                              ${escapeHtml(element.destinataire_nom)}
                              <small>${escapeHtml(element.destinataire_adresse || "—")}</small>
                              ${alerteZone(element.alerte_zone)}
                            </td>
                            <td>${escapeHtml(element.code_zone || "—")}</td>
                            <td>${tampon(element.statut)}</td>
                            <td class="cellule-actions">
                              ${element.statut === "RECUP_DEMANDEE"
                                ? `<button class="btn btn-primaire btn-petit" data-valider-depart-colis="${escapeHtml(element.id_colis)}">Confirmer le départ</button>`
                                : `<span class="action-indisponible">${lot.id_livreur ? "En attente du livreur" : "À assigner"}</span>`}
                            </td>
                          </tr>`).join("")}
                      </tbody>
                    </table>
                  </div>
                </article>`).join("")}
            </div>` : `<div class="etat-vide-tableau">Aucun lot en attente de départ.</div>`}
        </section>`;
    }

    return `
      <section class="bloc-tableau etape-operation" data-section-operation="${section}">
        ${enteteSection(titreSection, lotsAffiches.length)}
        ${section === "DEPART" && lotsAAssigner.length ? `
          <div class="barre-assignation-groupee">
            <select id="select-livreur-lots">
              <option value="">Assigner les lots sélectionnés à…</option>
              ${livreurs.map((livreur) => `<option value="${livreur.id_utilisateur}">${escapeHtml(livreur.nom)}</option>`).join("")}
            </select>
            <button class="btn btn-primaire btn-petit" id="btn-assigner-lots" disabled>Assigner</button>
            <span id="compteur-lots" class="compteur-selection"></span>
          </div>` : ""}
        ${lotsAffiches.length ? `
          <div class="tableau-defilant">
            <table class="donnees">
              <thead><tr><th></th><th>Lot</th><th>Colis</th><th>Livreur</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                ${lotsAffiches.map((lot) => `
                  <tr>
                    <td>${section === "DEPART" && !lot.id_livreur
                      ? `<input type="checkbox" class="case-operation-lot" value="${escapeHtml(lot.id_lot)}">`
                      : ""}</td>
                    <td class="identifiant-operation identifiant-metier">${escapeHtml(lot.id_lot)}${lot.note ? `<br><small>${escapeHtml(lot.note)}</small>` : ""}</td>
                    <td>${lot.nb_colis || 0}</td>
                    <td>${escapeHtml(nomLivreur(lot.id_livreur))}</td>
                    <td>${tampon(lot.statut || "PREPARE")}</td>
                    <td class="cellule-actions">
                      ${section === "DEPART" && lot.statut === "RECUPERATION"
                        ? `<button class="btn btn-primaire btn-petit" data-voir-lot="${escapeHtml(lot.id_lot)}">Valider le départ</button>`
                        : `<button class="btn btn-discret btn-petit" data-voir-lot="${escapeHtml(lot.id_lot)}">Voir les colis</button>`}
                      ${section === "DEPART" && lot.statut !== "RECUPERATION"
                        ? `<button class="btn btn-primaire btn-petit" data-assigner-lot="${escapeHtml(lot.id_lot)}">${lot.id_livreur ? "Réassigner" : "Assigner la livraison"}</button>`
                        : ""}
                    </td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>` : `<div class="etat-vide-tableau">${section === "LIVRAISON" ? "Aucune livraison en cours." : "Aucun lot en attente de départ."}</div>`}
      </section>`;
  }

  function rendre(donnees) {
    const lotsActifs = donnees.lots.filter((lot) => lot.statut !== "TERMINE");
    const compteurs = {
      RAMASSAGE: donnees.commandes.length,
      RECEPTION: donnees.receptions.length,
      LOT: donnees.disponibles.length,
      DEPART: lotsActifs.filter((lot) => lot.statut !== "EN_TOURNEE").length,
      LIVRAISON: lotsActifs.filter((lot) => lot.statut === "EN_TOURNEE").length
    };
    if (!filtreInitialise) {
      filtreActif = ["RAMASSAGE", "RECEPTION", "LOT", "DEPART", "LIVRAISON"]
        .find((section) => compteurs[section] > 0) || "RAMASSAGE";
      filtreInitialise = true;
    }

    conteneur.innerHTML = `
      <div class="filtres-operations" role="tablist" aria-label="Étapes opérationnelles">
        ${FILTRES.map(([id, libelle]) => `
          <button class="filtre-operation" role="tab" data-filtre-operation="${id}" aria-selected="${filtreActif === id}" aria-current="${filtreActif === id}">
            <span>${libelle}</span><strong>${compteurs[id]}</strong>
          </button>`).join("")}
      </div>
      <div class="flux-operations">
        ${sectionRamassages(donnees.commandes)}
        ${sectionReceptions(donnees.receptions)}
        ${sectionMiseEnLot(donnees.disponibles)}
        ${sectionLots(lotsActifs, "DEPART")}
        ${sectionLots(lotsActifs, "LIVRAISON")}
      </div>`;

    brancherInteractions(donnees);
  }

  async function rafraichir() {
    if (chargement) return;
    chargement = true;
    conteneur.setAttribute("aria-busy", "true");
    try {
      const [commandes, receptions, disponibles, lots, listeLivreurs] = await Promise.all([
        listerCommandesEnRamassage(idHubAgent),
        listerColisAValider(idHubAgent),
        listerColisDisponiblesPourLot(idHubAgent),
        listerLots(idHubAgent),
        listerLivreursActifs()
      ]);
      const colisLots = await listerColisDesLots(idHubAgent);
      const colisParLot = colisLots.reduce((groupes, colis) => {
        const existants = groupes.get(colis.id_lot) || [];
        existants.push(colis);
        groupes.set(colis.id_lot, existants);
        return groupes;
      }, new Map());
      const lotsAvecColis = lots.map((lot) => ({ ...lot, colis: colisParLot.get(lot.id_lot) || [] }));
      livreurs = listeLivreurs;
      rendre({ commandes, receptions, disponibles, lots: lotsAvecColis });
    } finally {
      chargement = false;
      conteneur.removeAttribute("aria-busy");
    }
  }

  function ouvrirAssignation(type, id) {
    const estRamassage = type === "RAMASSAGE";
    ouvrirModale(`
      <h2>${estRamassage ? "Assigner le ramassage" : "Assigner la livraison"}</h2>
      <p class="message-erreur" id="erreur-assignation-operation"></p>
      <div class="champ">
        <label>Livreur</label>
        <select id="livreur-operation">
          <option value="">Choisir…</option>
          ${livreurs.map((livreur) => `<option value="${livreur.id_utilisateur}">${escapeHtml(livreur.nom)}</option>`).join("")}
        </select>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="annuler-assignation-operation">Annuler</button>
        <button class="btn btn-primaire" id="confirmer-assignation-operation">Assigner</button>
      </div>
    `, (boite) => {
      boite.querySelector("#annuler-assignation-operation").addEventListener("click", fermerModale);
      boite.querySelector("#confirmer-assignation-operation").addEventListener("click", async (evenement) => {
        const idLivreur = boite.querySelector("#livreur-operation").value;
        const erreur = boite.querySelector("#erreur-assignation-operation");
        if (!idLivreur) {
          erreur.textContent = "Choisis un livreur.";
          erreur.classList.add("visible");
          return;
        }
        evenement.currentTarget.disabled = true;
        const resultat = estRamassage
          ? await assignerRamassage(id, idLivreur)
          : await assignerLot(id, idLivreur);
        if (!resultat.ok) {
          erreur.textContent = resultat.message;
          erreur.classList.add("visible");
          evenement.currentTarget.disabled = false;
          return;
        }
        creerNotification(
          idLivreur,
          null,
          estRamassage ? "RAMASSAGE_ASSIGNE" : "LOT_ASSIGNE",
          estRamassage ? `Nouveau ramassage assigné : ${id}` : `Nouveau lot de livraison assigné : ${id}`,
          null
        ).catch(() => {});
        afficherFlash(estRamassage ? "Ramassage assigné" : "Livraison assignée");
        fermerModale();
        rafraichir();
      });
    });
  }

  async function voirLot(idLot) {
    async function rendreColis(boite) {
      const colis = await listerColisDuLot(idLot);
      boite.querySelector("#contenu-lot-operation").innerHTML = `
        <div class="tableau-defilant">
          <table class="donnees">
            <thead><tr><th>Colis</th><th>Destinataire</th><th>Zone</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              ${colis.map((element) => `
                <tr>
                  <td class="identifiant-operation identifiant-metier">${escapeHtml(element.id_colis)}</td>
                  <td>${escapeHtml(element.destinataire_nom)}<br><small>${escapeHtml(element.destinataire_adresse || "—")}</small><br>${alerteZone(element.alerte_zone)}</td>
                  <td>${escapeHtml(element.code_zone || "—")}</td>
                  <td>${tampon(element.statut)}</td>
                  <td class="cellule-actions">${element.statut === "RECUP_DEMANDEE"
                    ? `<button class="btn btn-primaire btn-petit" data-valider-depart-colis="${escapeHtml(element.id_colis)}">Confirmer le départ</button>`
                    : ""}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>`;
      boite.querySelectorAll("[data-valider-depart-colis]").forEach((bouton) => {
        bouton.addEventListener("click", async () => {
          bouton.disabled = true;
          const resultat = await validerRecuperationColis(bouton.dataset.validerDepartColis);
          if (resultat.ok) {
            afficherFlash("Départ du colis confirmé");
            await rendreColis(boite);
            rafraichir();
          } else {
            afficherFlash(resultat.message, true);
            bouton.disabled = false;
          }
        });
      });
    }

    ouvrirModale(`
      <h2>Lot ${escapeHtml(idLot)}</h2>
      <div id="contenu-lot-operation"><div class="etat-vide-tableau">Chargement…</div></div>
      <div class="actions-bas"><button class="btn btn-discret" id="fermer-lot-operation">Fermer</button></div>
    `, async (boite) => {
      boite.closest(".boite-modale")?.classList.add("boite-modale-plein-ecran");
      boite.querySelector("#fermer-lot-operation").addEventListener("click", fermerModale);
      await rendreColis(boite);
    });
  }

  function brancherSelectionGroupee({ cases, selecteur, bouton, compteur, action, message }) {
    if (!selecteur || !bouton) return;
    const elements = () => [...conteneur.querySelectorAll(cases)];
    const mettreAJour = () => {
      const selection = elements().filter((element) => element.checked);
      compteur.textContent = selection.length ? `${selection.length} sélectionné${selection.length > 1 ? "s" : ""}` : "";
      bouton.disabled = !(selection.length && selecteur.value);
    };
    elements().forEach((element) => element.addEventListener("change", mettreAJour));
    selecteur.addEventListener("change", mettreAJour);
    bouton.addEventListener("click", async () => {
      const ids = elements().filter((element) => element.checked).map((element) => element.value);
      const idLivreur = selecteur.value;
      if (!ids.length || !idLivreur) return;
      bouton.disabled = true;
      const resultats = await Promise.all(ids.map((id) => action(id, idLivreur)));
      const echecs = resultats.filter((resultat) => !resultat.ok).length;
      afficherFlash(
        echecs ? `${ids.length - echecs}/${ids.length} opérations réalisées` : message(ids.length),
        echecs > 0
      );
      rafraichir();
    });
  }

  function brancherInteractions(donnees) {
    conteneur.querySelectorAll("[data-filtre-operation]").forEach((bouton) => {
      bouton.addEventListener("click", () => {
        filtreActif = bouton.dataset.filtreOperation;
        rendre(donnees);
      });
    });

    conteneur.querySelectorAll("[data-assigner-ramassage]").forEach((bouton) => {
      bouton.addEventListener("click", () => ouvrirAssignation("RAMASSAGE", bouton.dataset.assignerRamassage));
    });
    conteneur.querySelectorAll("[data-partager-position-expediteur]").forEach((bouton) => {
      bouton.addEventListener("click", async () => {
        bouton.disabled = true;
        try {
          const liens = await lireLiensCommande(bouton.dataset.partagerPositionExpediteur);
          const lienExpediteur = liens.find((lien) => lien.type === "POSITION_EXPEDITEUR");
          if (!lienExpediteur) {
            afficherFlash("Lien de position expéditeur introuvable.", true);
            return;
          }
          const url = construireUrlPartage(lienExpediteur.token);
          if (navigator.share) {
            try {
              await navigator.share({
                text: "Voici le lien pour partager ta position au livreur",
                url
              });
              return;
            } catch {
              return;
            }
          }
          await copierTexte(url);
        } finally {
          bouton.disabled = false;
        }
      });
    });
    conteneur.querySelectorAll("[data-assigner-lot]").forEach((bouton) => {
      bouton.addEventListener("click", () => ouvrirAssignation("LIVRAISON", bouton.dataset.assignerLot));
    });
    conteneur.querySelectorAll("[data-voir-lot]").forEach((bouton) => {
      bouton.addEventListener("click", () => voirLot(bouton.dataset.voirLot));
    });
    conteneur.querySelectorAll("[data-valider-depart-colis]").forEach((bouton) => {
      bouton.addEventListener("click", async () => {
        bouton.disabled = true;
        const resultat = await validerRecuperationColis(bouton.dataset.validerDepartColis);
        if (resultat.ok) {
          afficherFlash("Départ du colis confirmé");
          rafraichir();
        } else {
          afficherFlash(resultat.message, true);
          bouton.disabled = false;
        }
      });
    });

    conteneur.querySelectorAll("[data-valider-depot]").forEach((bouton) => {
      bouton.addEventListener("click", async () => {
        bouton.disabled = true;
        const resultat = await validerDepot(bouton.dataset.validerDepot);
        if (resultat.ok) {
          afficherFlash("Colis réceptionné");
          rafraichir();
        } else {
          afficherFlash(resultat.message, true);
          bouton.disabled = false;
        }
      });
    });
    conteneur.querySelectorAll("[data-valider-retour]").forEach((bouton) => {
      bouton.addEventListener("click", async () => {
        bouton.disabled = true;
        const resultat = await validerRetourRecu(bouton.dataset.validerRetour);
        if (resultat.ok) {
          afficherFlash("Retour réceptionné");
          rafraichir();
        } else {
          afficherFlash(resultat.message, true);
          bouton.disabled = false;
        }
      });
    });

    const casesColis = () => [...conteneur.querySelectorAll(".case-operation-colis-lot")];
    const btnCreerLot = conteneur.querySelector("#btn-creer-lot-operation");
    const compteurColis = conteneur.querySelector("#compteur-colis-lot");
    const caseTous = conteneur.querySelector("#case-tous-colis-lot");
    const majLot = () => {
      const nb = casesColis().filter((element) => element.checked).length;
      if (compteurColis) compteurColis.textContent = nb ? `${nb} colis sélectionné${nb > 1 ? "s" : ""}` : "";
      if (btnCreerLot) btnCreerLot.disabled = nb === 0;
    };
    casesColis().forEach((element) => element.addEventListener("change", majLot));
    caseTous?.addEventListener("change", () => {
      casesColis().forEach((element) => { element.checked = caseTous.checked; });
      majLot();
    });
    btnCreerLot?.addEventListener("click", async () => {
      const ids = casesColis().filter((element) => element.checked).map((element) => element.value);
      if (!ids.length) return;
      btnCreerLot.disabled = true;
      const resultat = await creerLot(ids, null);
      if (resultat.ok) {
        afficherFlash(`Lot ${resultat.idLot} créé`);
        filtreActif = "DEPART";
        rafraichir();
      } else {
        afficherFlash(resultat.message, true);
        btnCreerLot.disabled = false;
      }
    });

    brancherSelectionGroupee({
      cases: ".case-operation-ramassage",
      selecteur: conteneur.querySelector("#select-livreur-ramassages"),
      bouton: conteneur.querySelector("#btn-assigner-ramassages"),
      compteur: conteneur.querySelector("#compteur-ramassages"),
      action: assignerRamassage,
      message: (nombre) => `${nombre} ramassage${nombre > 1 ? "s" : ""} assigné${nombre > 1 ? "s" : ""}`
    });
    brancherSelectionGroupee({
      cases: ".case-operation-lot",
      selecteur: conteneur.querySelector("#select-livreur-lots"),
      bouton: conteneur.querySelector("#btn-assigner-lots"),
      compteur: conteneur.querySelector("#compteur-lots"),
      action: assignerLot,
      message: (nombre) => `${nombre} lot${nombre > 1 ? "s" : ""} assigné${nombre > 1 ? "s" : ""}`
    });
  }

  actionsContainer.querySelector("#btn-actualiser-operations").addEventListener("click", rafraichir);
  actionsContainer.querySelector("#btn-nouvelle-commande").addEventListener("click", async () => {
    nettoyageCreation = await ouvrirCreationCommande(profil, rafraichir);
  });

  await rafraichir();
  return () => {
    nettoyageCreation?.();
    fermerModale();
  };
}
