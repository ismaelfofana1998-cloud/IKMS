import {
  listerZones,
  enregistrerZone,
  supprimerZone,
  listerGroupesTarifaires,
  enregistrerGroupeTarifaire,
  supprimerGroupeTarifaire,
  listerTarifsGroupes,
  enregistrerTarifGroupes,
  desactiverTarifGroupes,
  listerTarifsPaires,
  enregistrerTarifPaire,
  desactiverTarifPaire,
  listerHubs
} from "../repository.js";
import { afficherFlash, escapeHtml, formaterFcfa, ouvrirModale, fermerModale } from "../ui.js";

export const titre = "Zones et tarifs";
export const sousTitre = "";

const normaliserRecherche = (valeur) => String(valeur || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .trim();

const libelleZone = (zone) => {
  if (!zone) return "Zone inconnue";
  const secteur = zone.secteur || zone.code_zone;
  return zone.nom_commune && zone.nom_commune !== secteur
    ? `${zone.nom_commune} · ${secteur}`
    : secteur;
};

const libelleGroupe = (groupe) => groupe?.nom || "Non classée";

export async function monter(conteneur, actionsContainer, profil) {
  const hubs = await listerHubs();
  const peutAdministrer = ["admin", "super_admin"].includes(profil.role);
  let ongletActif = "ZONES";

  const filtrerTable = (champ, selecteurLignes, idVide) => {
    champ?.addEventListener("input", () => {
      const terme = normaliserRecherche(champ.value);
      const lignes = [...conteneur.querySelectorAll(selecteurLignes)];
      let visibles = 0;
      lignes.forEach((ligne) => {
        ligne.hidden = !ligne.dataset.recherche.includes(terme);
        if (!ligne.hidden) visibles += 1;
      });
      const vide = conteneur.querySelector(`#${idVide}`);
      if (vide) vide.hidden = visibles !== 0;
    });
  };

  function majActions({ zones, groupes }) {
    if (!peutAdministrer) {
      actionsContainer.innerHTML = "";
      return;
    }

    if (ongletActif === "ZONES") {
      actionsContainer.innerHTML = `<button class="btn btn-primaire" id="btn-nouvelle-zone">+ Nouvelle zone</button>`;
      actionsContainer.querySelector("#btn-nouvelle-zone").addEventListener("click", () => {
        if (!groupes.length) {
          ongletActif = "TARIFICATION";
          afficherFlash("Créez d’abord un groupe tarifaire");
          rafraichir();
          return;
        }
        ouvrirFormulaireZone(null, groupes);
      });
      return;
    }

    if (ongletActif === "TARIFICATION") {
      actionsContainer.innerHTML = `
        <button class="btn btn-discret" id="btn-nouveau-groupe">+ Groupe</button>
        <button class="btn btn-primaire" id="btn-nouveau-tarif-groupe">+ Tarif</button>
      `;
      actionsContainer.querySelector("#btn-nouveau-groupe").addEventListener("click", () => ouvrirFormulaireGroupe());
      actionsContainer.querySelector("#btn-nouveau-tarif-groupe").addEventListener("click", () => {
        if (!groupes.length) {
          ouvrirFormulaireGroupe();
          return;
        }
        ouvrirFormulaireTarifGroupe(null, groupes);
      });
      return;
    }

    actionsContainer.innerHTML = `<button class="btn btn-primaire" id="btn-nouvelle-exception">+ Exception</button>`;
    actionsContainer.querySelector("#btn-nouvelle-exception").addEventListener("click", () => {
      ouvrirFormulaireException(null, zones);
    });
  }

  async function rafraichir() {
    const [toutesZones, tousGroupes, tousTarifsGroupes, toutesExceptions] = await Promise.all([
      listerZones(),
      listerGroupesTarifaires(),
      listerTarifsGroupes(),
      listerTarifsPaires()
    ]);
    const zones = toutesZones.filter((zone) => zone.actif);
    const groupes = tousGroupes.filter((groupe) => groupe.actif);
    const tarifsGroupes = tousTarifsGroupes.filter((tarif) => tarif.actif);
    const exceptions = toutesExceptions.filter((tarif) => tarif.actif);
    const zoneParCode = new Map(zones.map((zone) => [zone.code_zone, zone]));
    const groupeParId = new Map(groupes.map((groupe) => [groupe.id_groupe, groupe]));
    const exceptionLocaleParZone = new Map(
      exceptions
        .filter((tarif) => tarif.zone_a === tarif.zone_b)
        .map((tarif) => [tarif.zone_a, tarif])
    );

    majActions({ zones, groupes });

    conteneur.innerHTML = `
      <div class="onglets-panneau">
        <button class="onglet-panneau" data-onglet="ZONES" aria-current="${ongletActif === "ZONES"}">Zones</button>
        <button class="onglet-panneau" data-onglet="TARIFICATION" aria-current="${ongletActif === "TARIFICATION"}">Tarification</button>
        <button class="onglet-panneau" data-onglet="EXCEPTIONS" aria-current="${ongletActif === "EXCEPTIONS"}">Exceptions</button>
      </div>

      ${ongletActif === "ZONES" ? rendreZones(zones, groupeParId, exceptionLocaleParZone) : ""}
      ${ongletActif === "TARIFICATION" ? rendreTarification(groupes, tarifsGroupes, groupeParId, zones) : ""}
      ${ongletActif === "EXCEPTIONS" ? rendreExceptions(exceptions, zoneParCode) : ""}
    `;

    conteneur.querySelectorAll("[data-onglet]").forEach((bouton) => {
      bouton.addEventListener("click", () => {
        ongletActif = bouton.dataset.onglet;
        rafraichir();
      });
    });

    filtrerTable(
      conteneur.querySelector("#recherche-zones"),
      "#corps-zones tr",
      "aucune-zone-recherche"
    );
    filtrerTable(
      conteneur.querySelector("#recherche-tarifs-groupes"),
      "#corps-tarifs-groupes tr",
      "aucun-tarif-groupe-recherche"
    );
    filtrerTable(
      conteneur.querySelector("#recherche-exceptions"),
      "#corps-exceptions tr",
      "aucune-exception-recherche"
    );

    conteneur.querySelectorAll("[data-modifier-zone]").forEach((bouton) => {
      const zone = zones.find((element) => element.id === Number(bouton.dataset.modifierZone));
      bouton.addEventListener("click", () => ouvrirFormulaireZone(zone, groupes));
    });

    conteneur.querySelectorAll("[data-supprimer-zone]").forEach((bouton) => {
      bouton.addEventListener("click", async () => {
        const zone = zones.find((element) => element.id === Number(bouton.dataset.supprimerZone));
        if (!window.confirm(`Supprimer définitivement la zone ${zone?.code_zone || ""} ?`)) return;
        const resultat = await supprimerZone(Number(bouton.dataset.supprimerZone));
        if (resultat.ok) {
          afficherFlash(resultat.statut === "ARCHIVEE" ? "Zone archivée pour préserver l’historique" : "Zone supprimée");
          rafraichir();
        } else {
          afficherFlash(resultat.message, true);
        }
      });
    });

    conteneur.querySelectorAll("[data-modifier-groupe]").forEach((bouton) => {
      const groupe = groupes.find((element) => element.id_groupe === bouton.dataset.modifierGroupe);
      bouton.addEventListener("click", () => ouvrirFormulaireGroupe(groupe));
    });

    conteneur.querySelectorAll("[data-supprimer-groupe]").forEach((bouton) => {
      bouton.addEventListener("click", async () => {
        const groupe = groupes.find((element) => element.id_groupe === bouton.dataset.supprimerGroupe);
        if (!window.confirm(`Supprimer définitivement le groupe ${groupe?.nom || ""} ?`)) return;
        const resultat = await supprimerGroupeTarifaire(bouton.dataset.supprimerGroupe);
        if (resultat.ok) {
          afficherFlash("Groupe supprimé");
          rafraichir();
        } else {
          afficherFlash(resultat.message, true);
        }
      });
    });

    conteneur.querySelectorAll("[data-modifier-tarif-groupe]").forEach((bouton) => {
      const tarif = tarifsGroupes.find((element) => element.id === Number(bouton.dataset.modifierTarifGroupe));
      bouton.addEventListener("click", () => ouvrirFormulaireTarifGroupe(tarif, groupes));
    });

    conteneur.querySelectorAll("[data-desactiver-tarif-groupe]").forEach((bouton) => {
      bouton.addEventListener("click", async () => {
        const resultat = await desactiverTarifGroupes(Number(bouton.dataset.desactiverTarifGroupe));
        if (resultat.ok) {
          afficherFlash("Tarif désactivé");
          rafraichir();
        } else {
          afficherFlash(resultat.message, true);
        }
      });
    });

    conteneur.querySelectorAll("[data-modifier-exception]").forEach((bouton) => {
      const tarif = exceptions.find((element) => element.id === Number(bouton.dataset.modifierException));
      bouton.addEventListener("click", () => ouvrirFormulaireException(tarif, zones));
    });

    conteneur.querySelectorAll("[data-desactiver-exception]").forEach((bouton) => {
      bouton.addEventListener("click", async () => {
        const resultat = await desactiverTarifPaire(Number(bouton.dataset.desactiverException));
        if (resultat.ok) {
          afficherFlash("Exception désactivée");
          rafraichir();
        } else {
          afficherFlash(resultat.message, true);
        }
      });
    });
  }

  function rendreZones(zones, groupeParId, exceptionLocaleParZone) {
    return `
      <div class="bloc-tableau">
        <div class="tableau-titre titre-avec-recherche">
          <span>${zones.length} zone${zones.length > 1 ? "s" : ""}</span>
          <input id="recherche-zones" class="recherche-zones-tarifs" type="search" placeholder="Rechercher une zone" autocomplete="off">
        </div>
        ${zones.length ? `
          <table class="donnees">
            <thead><tr><th>Zone</th><th>Groupe</th><th>Même zone uniquement</th><th>Hub</th><th></th></tr></thead>
            <tbody id="corps-zones">
              ${zones.map((zone) => {
                const groupe = groupeParId.get(zone.id_groupe_tarifaire);
                const exceptionLocale = exceptionLocaleParZone.get(zone.code_zone);
                const recherche = normaliserRecherche([
                  zone.code_zone,
                  zone.nom_commune,
                  zone.secteur,
                  groupe?.nom,
                  groupe?.code
                ].join(" "));
                return `
                  <tr data-recherche="${escapeHtml(recherche)}">
                    <td>
                      <strong>${escapeHtml(libelleZone(zone))}</strong>
                      <span class="code-zone-secondaire">${escapeHtml(zone.code_zone)}</span>
                    </td>
                    <td>${escapeHtml(libelleGroupe(groupe))}</td>
                    <td>${exceptionLocale
                      ? `${formaterFcfa(exceptionLocale.montant)} FCFA <span class="code-zone-secondaire">Exception</span>`
                      : zone.tarif_intra_zone
                        ? `${formaterFcfa(zone.tarif_intra_zone)} FCFA`
                        : "—"
                    }</td>
                    <td>${escapeHtml(hubs.find((hub) => hub.id_hub === zone.id_hub)?.nom || "—")}</td>
                    <td class="cellule-actions">${peutAdministrer ? `
                      <button class="btn btn-discret btn-petit" data-modifier-zone="${zone.id}">Modifier</button>
                      <button class="btn btn-alerte btn-petit" data-supprimer-zone="${zone.id}">Supprimer</button>
                    ` : ""}</td>
                  </tr>`;
              }).join("")}
            </tbody>
          </table>
          <div class="etat-vide-tableau" id="aucune-zone-recherche" hidden>Aucune zone trouvée.</div>
        ` : `<div class="etat-vide-tableau">Aucune zone.</div>`}
      </div>
    `;
  }

  function rendreTarification(groupes, tarifs, groupeParId, zones) {
    return `
      <div class="logique-tarification">
        <span><strong>Zone → même zone</strong> : tarif local de la fiche zone</span>
        <span><strong>Deux zones d’un même groupe</strong> : tarif du groupe vers lui-même</span>
        <span><strong>Deux groupes différents</strong> : un seul tarif couvre toutes leurs zones</span>
      </div>
      <div class="grille-configuration-tarifs">
        <div class="bloc-tableau">
          <div class="tableau-titre">${groupes.length} groupe${groupes.length > 1 ? "s" : ""}</div>
          ${groupes.length ? `
            <table class="donnees">
              <thead><tr><th>Groupe</th><th>Zones</th><th></th></tr></thead>
              <tbody>
                ${groupes.map((groupe) => `
                  <tr>
                    <td>
                      <strong>${escapeHtml(groupe.nom)}</strong>
                      <span class="code-zone-secondaire">${escapeHtml(groupe.code)}</span>
                    </td>
                    <td>${zones.filter((zone) => zone.id_groupe_tarifaire === groupe.id_groupe).length}</td>
                    <td class="cellule-actions">${peutAdministrer ? `
                      <button class="btn btn-discret btn-petit" data-modifier-groupe="${groupe.id_groupe}">Modifier</button>
                      <button class="btn btn-alerte btn-petit" data-supprimer-groupe="${groupe.id_groupe}">Supprimer</button>
                    ` : ""}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          ` : `<div class="etat-vide-tableau">Créez votre premier groupe tarifaire.</div>`}
        </div>

        <div class="bloc-tableau">
          <div class="tableau-titre titre-avec-recherche">
            <span>Tarifs entre groupes</span>
            <input id="recherche-tarifs-groupes" class="recherche-zones-tarifs" type="search" placeholder="Rechercher un groupe" autocomplete="off">
          </div>
          ${tarifs.length ? `
            <table class="donnees">
              <thead><tr><th>Groupe A</th><th>Groupe B</th><th>Tarif</th><th></th></tr></thead>
              <tbody id="corps-tarifs-groupes">
                ${tarifs.map((tarif) => {
                  const groupeA = groupeParId.get(tarif.groupe_a);
                  const groupeB = groupeParId.get(tarif.groupe_b);
                  const recherche = normaliserRecherche(`${groupeA?.nom} ${groupeA?.code} ${groupeB?.nom} ${groupeB?.code}`);
                  return `
                    <tr data-recherche="${escapeHtml(recherche)}">
                      <td>${escapeHtml(libelleGroupe(groupeA))}</td>
                      <td>${escapeHtml(libelleGroupe(groupeB))}</td>
                      <td class="cellule-donnee">${formaterFcfa(tarif.montant)} FCFA</td>
                      <td class="cellule-actions">${peutAdministrer ? `
                        <button class="btn btn-discret btn-petit" data-modifier-tarif-groupe="${tarif.id}">Modifier</button>
                        <button class="btn btn-alerte btn-petit" data-desactiver-tarif-groupe="${tarif.id}">Désactiver</button>
                      ` : ""}</td>
                    </tr>`;
                }).join("")}
              </tbody>
            </table>
            <div class="etat-vide-tableau" id="aucun-tarif-groupe-recherche" hidden>Aucun tarif trouvé.</div>
          ` : `<div class="etat-vide-tableau">Aucun tarif entre groupes.</div>`}
        </div>
      </div>
    `;
  }

  function rendreExceptions(exceptions, zoneParCode) {
    return `
      <div class="bloc-tableau">
        <div class="tableau-titre titre-avec-recherche">
          <span>${exceptions.length} exception${exceptions.length > 1 ? "s" : ""}</span>
          <input id="recherche-exceptions" class="recherche-zones-tarifs" type="search" placeholder="Rechercher une zone" autocomplete="off">
        </div>
        ${exceptions.length ? `
          <table class="donnees">
            <thead><tr><th>Zone A</th><th>Zone B</th><th>Tarif</th><th></th></tr></thead>
            <tbody id="corps-exceptions">
              ${exceptions.map((tarif) => {
                const zoneA = zoneParCode.get(tarif.zone_a);
                const zoneB = zoneParCode.get(tarif.zone_b);
                const recherche = normaliserRecherche(`${tarif.zone_a} ${tarif.zone_b} ${libelleZone(zoneA)} ${libelleZone(zoneB)}`);
                return `
                  <tr data-recherche="${escapeHtml(recherche)}">
                    <td>${escapeHtml(libelleZone(zoneA))}<span class="code-zone-secondaire">${escapeHtml(tarif.zone_a)}</span></td>
                    <td>${escapeHtml(libelleZone(zoneB))}<span class="code-zone-secondaire">${escapeHtml(tarif.zone_b)}</span></td>
                    <td class="cellule-donnee">${formaterFcfa(tarif.montant)} FCFA</td>
                    <td class="cellule-actions">${peutAdministrer ? `
                      <button class="btn btn-discret btn-petit" data-modifier-exception="${tarif.id}">Modifier</button>
                      <button class="btn btn-alerte btn-petit" data-desactiver-exception="${tarif.id}">Désactiver</button>
                    ` : ""}</td>
                  </tr>`;
              }).join("")}
            </tbody>
          </table>
          <div class="etat-vide-tableau" id="aucune-exception-recherche" hidden>Aucune exception trouvée.</div>
        ` : `<div class="etat-vide-tableau">Aucune exception. Les tarifs de groupe s’appliquent.</div>`}
      </div>
    `;
  }

  function ouvrirFormulaireGroupe(groupe = null) {
    ouvrirModale(`
      <h2>${groupe ? "Modifier le groupe" : "Nouveau groupe tarifaire"}</h2>
      <p class="message-erreur" id="erreur-groupe"></p>
      <div class="formulaire">
        <div class="champ"><label>Code</label><input id="g-code" value="${escapeHtml(groupe?.code || "")}" placeholder="CENTRE"></div>
        <div class="champ"><label>Nom</label><input id="g-nom" value="${escapeHtml(groupe?.nom || "")}" placeholder="Abidjan centre"></div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler-groupe">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer-groupe">Enregistrer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler-groupe").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer-groupe").addEventListener("click", async (evenement) => {
        const code = boite.querySelector("#g-code").value.trim().toUpperCase();
        const nom = boite.querySelector("#g-nom").value.trim();
        const erreur = boite.querySelector("#erreur-groupe");
        if (!code || !nom) {
          erreur.textContent = "Le code et le nom sont obligatoires.";
          erreur.classList.add("visible");
          return;
        }
        evenement.currentTarget.disabled = true;
        const resultat = await enregistrerGroupeTarifaire({
          idGroupe: groupe?.id_groupe,
          code,
          nom
        }, profil.id_entreprise);
        if (resultat.ok) {
          afficherFlash("Groupe enregistré");
          fermerModale();
          rafraichir();
        } else {
          erreur.textContent = resultat.message;
          erreur.classList.add("visible");
          evenement.currentTarget.disabled = false;
        }
      });
    });
  }

  function ouvrirFormulaireTarifGroupe(tarif, groupes) {
    const options = (selection) => groupes.map((groupe) =>
      `<option value="${groupe.id_groupe}" ${groupe.id_groupe === selection ? "selected" : ""}>${escapeHtml(groupe.nom)}</option>`
    ).join("");
    ouvrirModale(`
      <h2>${tarif ? "Modifier le tarif" : "Tarif entre groupes"}</h2>
      <p class="message-erreur" id="erreur-tarif-groupe"></p>
      <div class="formulaire">
        <div class="champ"><label>Groupe A</label><select id="tg-a">${options(tarif?.groupe_a)}</select></div>
        <div class="champ"><label>Groupe B</label><select id="tg-b">${options(tarif?.groupe_b)}</select></div>
        <div class="champ"><label>Montant (FCFA)</label><input id="tg-montant" type="number" min="1" inputmode="numeric" value="${tarif?.montant || ""}"></div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler-tarif-groupe">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer-tarif-groupe">Enregistrer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler-tarif-groupe").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer-tarif-groupe").addEventListener("click", async (evenement) => {
        const groupeDepart = boite.querySelector("#tg-a").value;
        const groupeArrivee = boite.querySelector("#tg-b").value;
        const montant = Number(boite.querySelector("#tg-montant").value);
        const erreur = boite.querySelector("#erreur-tarif-groupe");
        if (!groupeDepart || !groupeArrivee || montant <= 0) {
          erreur.textContent = "Les deux groupes et un montant supérieur à zéro sont obligatoires.";
          erreur.classList.add("visible");
          return;
        }
        evenement.currentTarget.disabled = true;
        const resultat = await enregistrerTarifGroupes(
          { groupeDepart, groupeArrivee, montant },
          profil.id_entreprise
        );
        if (resultat.ok) {
          afficherFlash("Tarif enregistré");
          fermerModale();
          rafraichir();
        } else {
          erreur.textContent = resultat.message;
          erreur.classList.add("visible");
          evenement.currentTarget.disabled = false;
        }
      });
    });
  }

  function ouvrirFormulaireException(tarif, zones) {
    const options = (selection) => zones.map((zone) =>
      `<option value="${zone.code_zone}" ${zone.code_zone === selection ? "selected" : ""}>${escapeHtml(libelleZone(zone))}</option>`
    ).join("");
    ouvrirModale(`
      <h2>${tarif ? "Modifier l’exception" : "Nouvelle exception"}</h2>
      <p class="message-erreur" id="erreur-exception"></p>
      <div class="formulaire">
        <div class="champ"><label>Zone A</label><select id="e-zone-a">${options(tarif?.zone_a)}</select></div>
        <div class="champ"><label>Zone B</label><select id="e-zone-b">${options(tarif?.zone_b)}</select></div>
        <div class="champ"><label>Montant (FCFA)</label><input id="e-montant" type="number" min="1" inputmode="numeric" value="${tarif?.montant || ""}"></div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler-exception">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer-exception">Enregistrer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler-exception").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer-exception").addEventListener("click", async (evenement) => {
        const zoneDepart = boite.querySelector("#e-zone-a").value;
        const zoneArrivee = boite.querySelector("#e-zone-b").value;
        const montant = Number(boite.querySelector("#e-montant").value);
        const erreur = boite.querySelector("#erreur-exception");
        if (!zoneDepart || !zoneArrivee || montant <= 0) {
          erreur.textContent = "Les deux zones et un montant supérieur à zéro sont obligatoires.";
          erreur.classList.add("visible");
          return;
        }
        if (!tarif && zoneDepart === zoneArrivee) {
          erreur.textContent = "Le tarif local se règle directement dans la fiche de la zone.";
          erreur.classList.add("visible");
          return;
        }
        evenement.currentTarget.disabled = true;
        const resultat = await enregistrerTarifPaire(
          { zoneDepart, zoneArrivee, montant },
          profil.id_entreprise
        );
        if (resultat.ok) {
          afficherFlash("Exception enregistrée");
          fermerModale();
          rafraichir();
        } else {
          erreur.textContent = resultat.message;
          erreur.classList.add("visible");
          evenement.currentTarget.disabled = false;
        }
      });
    });
  }

  function ouvrirFormulaireZone(zone, groupes) {
    ouvrirModale(`
      <h2>${zone ? "Modifier la zone" : "Nouvelle zone"}</h2>
      <p class="message-erreur" id="erreur-zone"></p>
      <div class="formulaire">
        <div class="champ"><label>Code zone</label><input id="z-code" value="${escapeHtml(zone?.code_zone || "")}" placeholder="YOP-NIANGON"></div>
        <div class="champ"><label>Commune</label><input id="z-nom-commune" value="${escapeHtml(zone?.nom_commune || "")}" placeholder="Yopougon"></div>
        <div class="champ"><label>Secteur</label><input id="z-secteur" value="${escapeHtml(zone?.secteur || "")}" placeholder="Niangon"></div>
        <div class="champ"><label>Groupe tarifaire</label><select id="z-groupe">
          <option value="">Choisir un groupe</option>
          ${groupes.map((groupe) => `<option value="${groupe.id_groupe}" ${groupe.id_groupe === zone?.id_groupe_tarifaire ? "selected" : ""}>${escapeHtml(groupe.nom)}</option>`).join("")}
        </select></div>
        <div class="champ"><label>Tarif local : cette zone → cette même zone (FCFA)</label><input id="z-tarif-intra" type="number" min="1" inputmode="numeric" value="${zone?.tarif_intra_zone || ""}" placeholder="1000"></div>
        <div class="champ"><label>Mots-clés</label><input id="z-mots-cles" value="${escapeHtml((zone?.mots_cles || []).join(", "))}" placeholder="Niangon Nord, Niangon Sud"></div>
        <div class="champ">
          <label>Hub de ramassage</label>
          <select id="z-hub">
            <option value="">Aucun</option>
            ${hubs.map((hub) => `<option value="${hub.id_hub}" ${hub.id_hub === zone?.id_hub ? "selected" : ""}>${escapeHtml(hub.nom)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler-zone">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer-zone">Enregistrer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler-zone").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer-zone").addEventListener("click", async (evenement) => {
        const codeZone = boite.querySelector("#z-code").value.trim().toUpperCase();
        const nomCommune = boite.querySelector("#z-nom-commune").value.trim();
        const secteur = boite.querySelector("#z-secteur").value.trim() || nomCommune;
        const idGroupeTarifaire = boite.querySelector("#z-groupe").value;
        const tarifIntraZone = Number(boite.querySelector("#z-tarif-intra").value);
        const erreur = boite.querySelector("#erreur-zone");
        if (!codeZone || !nomCommune || !idGroupeTarifaire || tarifIntraZone <= 0) {
          erreur.textContent = "Le code, la commune, le groupe et le tarif local sont obligatoires.";
          erreur.classList.add("visible");
          return;
        }

        evenement.currentTarget.disabled = true;
        const motsCles = boite.querySelector("#z-mots-cles").value
          .split(",")
          .map((mot) => mot.trim())
          .filter(Boolean);
        const resultat = await enregistrerZone({
          idZone: zone?.id,
          codeZone,
          secteur,
          nomCommune,
          motsCles,
          idHub: boite.querySelector("#z-hub").value || null,
          idGroupeTarifaire,
          tarifIntraZone
        }, profil.id_entreprise);

        if (resultat.ok) {
          afficherFlash(zone ? "Zone modifiée" : "Zone créée");
          fermerModale();
          rafraichir();
        } else {
          erreur.textContent = resultat.message;
          erreur.classList.add("visible");
          evenement.currentTarget.disabled = false;
        }
      });
    });
  }

  await rafraichir();
  return () => fermerModale();
}
