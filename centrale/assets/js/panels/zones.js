import {
  listerZones,
  enregistrerZone,
  desactiverZone,
  listerTarifsPaires,
  enregistrerTarifPaire,
  enregistrerTarifsPairesPourZone,
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

export async function monter(conteneur, actionsContainer, profil) {
  const hubs = await listerHubs();
  let ongletActif = "ZONES";

  function majActions() {
    actionsContainer.innerHTML = ongletActif === "PARAMETRAGE"
      ? `<button class="btn btn-primaire" id="btn-nouvelle-zone">+ Nouvelle zone</button>`
      : `<button class="btn btn-primaire" id="btn-nouveau-tarif-paire">+ Tarif par paire</button>`;

    actionsContainer.querySelector("#btn-nouvelle-zone")?.addEventListener("click", () => ouvrirFormulaireZone(null));
    actionsContainer.querySelector("#btn-nouveau-tarif-paire")?.addEventListener("click", async () => {
      ouvrirFormulairePaire(null, (await listerZones()).filter((zone) => zone.actif));
    });
  }

  async function rafraichir() {
    const [toutesZones, tousTarifs] = await Promise.all([listerZones(), listerTarifsPaires()]);
    const zones = toutesZones.filter((zone) => zone.actif);
    const paires = tousTarifs.filter((paire) => paire.actif);
    const zoneParCode = new Map(zones.map((zone) => [zone.code_zone, zone]));
    majActions();

    conteneur.innerHTML = `
      <div class="onglets-panneau">
        <button class="onglet-panneau" data-onglet="ZONES" aria-current="${ongletActif === "ZONES"}">Zones</button>
        <button class="onglet-panneau" data-onglet="PARAMETRAGE" aria-current="${ongletActif === "PARAMETRAGE"}">Paramétrer Zones</button>
      </div>

      ${ongletActif === "ZONES" ? `
        <div class="bloc-tableau">
          <div class="tableau-titre titre-avec-recherche">
            <span>Zones et tarifs par paire</span>
            <input
              id="recherche-zones-tarifs"
              class="recherche-zones-tarifs"
              type="search"
              placeholder="Rechercher une zone"
              autocomplete="off"
            >
          </div>
          ${paires.length ? `
            <table class="donnees">
              <thead><tr><th>Zone A</th><th>Zone B</th><th>Tarif</th><th></th></tr></thead>
              <tbody id="corps-tarifs-paires">
                ${paires.map((paire) => {
                  const zoneA = zoneParCode.get(paire.zone_a);
                  const zoneB = zoneParCode.get(paire.zone_b);
                  const recherche = normaliserRecherche([
                    paire.zone_a,
                    paire.zone_b,
                    zoneA?.nom_commune,
                    zoneA?.secteur,
                    zoneB?.nom_commune,
                    zoneB?.secteur
                  ].join(" "));
                  return `
                    <tr data-recherche="${escapeHtml(recherche)}">
                      <td>
                        <strong>${escapeHtml(libelleZone(zoneA))}</strong>
                        <span class="code-zone-secondaire">${escapeHtml(paire.zone_a)}</span>
                      </td>
                      <td>
                        <strong>${escapeHtml(libelleZone(zoneB))}</strong>
                        <span class="code-zone-secondaire">${escapeHtml(paire.zone_b)}</span>
                      </td>
                      <td class="cellule-donnee">${formaterFcfa(paire.montant)} FCFA</td>
                      <td class="cellule-actions">
                        <button class="btn btn-discret btn-petit" data-modifier-paire="${paire.id}">Modifier</button>
                        <button class="btn btn-alerte btn-petit" data-desactiver-paire="${paire.id}">Désactiver</button>
                      </td>
                    </tr>`;
                }).join("")}
              </tbody>
            </table>
            <div class="etat-vide-tableau" id="aucun-resultat-zone" hidden>Aucune zone ne correspond à cette recherche.</div>
          ` : `<div class="etat-vide-tableau">Aucun tarif par paire.</div>`}
        </div>
      ` : `
        <div class="bloc-tableau">
          <div class="tableau-titre">Zones</div>
          ${zones.length ? `
            <table class="donnees">
              <thead><tr><th>Code</th><th>Secteur</th><th>Commune</th><th>Mots-clés</th><th>Hub</th><th></th></tr></thead>
              <tbody>
                ${zones.map((zone) => `
                  <tr>
                    <td class="cellule-donnee">${escapeHtml(zone.code_zone)}</td>
                    <td class="cellule-donnee">${escapeHtml(zone.secteur || "—")}</td>
                    <td>${escapeHtml(zone.nom_commune || "—")}</td>
                    <td>${(zone.mots_cles || []).length ? escapeHtml(zone.mots_cles.join(", ")) : "—"}</td>
                    <td>${escapeHtml(hubs.find((hub) => hub.id_hub === zone.id_hub)?.nom || "—")}</td>
                    <td class="cellule-actions">
                      <button class="btn btn-discret btn-petit" data-modifier="${zone.id}">Modifier</button>
                      <button class="btn btn-alerte btn-petit" data-desactiver="${zone.id}">Désactiver</button>
                    </td>
                  </tr>`).join("")}
              </tbody>
            </table>
          ` : `<div class="etat-vide-tableau">Aucune zone.</div>`}
        </div>
      `}
    `;

    conteneur.querySelectorAll("[data-onglet]").forEach((bouton) => {
      bouton.addEventListener("click", () => {
        ongletActif = bouton.dataset.onglet;
        rafraichir();
      });
    });

    const recherche = conteneur.querySelector("#recherche-zones-tarifs");
    recherche?.addEventListener("input", () => {
      const terme = normaliserRecherche(recherche.value);
      const lignes = [...conteneur.querySelectorAll("#corps-tarifs-paires tr")];
      let visibles = 0;
      lignes.forEach((ligne) => {
        ligne.hidden = !ligne.dataset.recherche.includes(terme);
        if (!ligne.hidden) visibles += 1;
      });
      const vide = conteneur.querySelector("#aucun-resultat-zone");
      if (vide) vide.hidden = visibles !== 0;
    });

    conteneur.querySelectorAll("[data-modifier]").forEach((bouton) => {
      const zone = zones.find((element) => element.id === Number(bouton.dataset.modifier));
      bouton.addEventListener("click", () => ouvrirFormulaireZone(zone));
    });

    conteneur.querySelectorAll("[data-desactiver]").forEach((bouton) => {
      bouton.addEventListener("click", async () => {
        const resultat = await desactiverZone(Number(bouton.dataset.desactiver));
        if (resultat.ok) {
          afficherFlash("Zone désactivée");
          rafraichir();
        } else {
          afficherFlash(resultat.message, true);
        }
      });
    });

    conteneur.querySelectorAll("[data-modifier-paire]").forEach((bouton) => {
      const paire = paires.find((element) => element.id === Number(bouton.dataset.modifierPaire));
      bouton.addEventListener("click", () => ouvrirFormulairePaire(paire, zones));
    });

    conteneur.querySelectorAll("[data-desactiver-paire]").forEach((bouton) => {
      bouton.addEventListener("click", async () => {
        const resultat = await desactiverTarifPaire(Number(bouton.dataset.desactiverPaire));
        if (resultat.ok) {
          afficherFlash("Tarif désactivé");
          rafraichir();
        } else {
          afficherFlash(resultat.message, true);
        }
      });
    });
  }

  function ouvrirFormulairePaire(paire, zones) {
    const optionsZones = (selection) => zones.map((zone) =>
      `<option value="${zone.code_zone}" ${zone.code_zone === selection ? "selected" : ""}>${escapeHtml(libelleZone(zone))}</option>`
    ).join("");

    ouvrirModale(`
      <h2>${paire ? "Modifier le tarif" : "Nouveau tarif par paire"}</h2>
      <p class="message-erreur" id="erreur-paire"></p>
      <div class="formulaire">
        <div class="champ"><label>Zone A</label><select id="p-zone-a">${optionsZones(paire?.zone_a)}</select></div>
        <div class="champ"><label>Zone B</label><select id="p-zone-b">${optionsZones(paire?.zone_b)}</select></div>
        <div class="champ"><label>Montant (FCFA)</label><input id="p-montant" type="number" min="1" value="${paire?.montant || ""}" required></div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler-paire">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer-paire">Enregistrer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler-paire").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer-paire").addEventListener("click", async (evenement) => {
        const zoneA = boite.querySelector("#p-zone-a").value;
        const zoneB = boite.querySelector("#p-zone-b").value;
        const montant = Number(boite.querySelector("#p-montant").value);
        const erreur = boite.querySelector("#erreur-paire");
        if (!zoneA || !zoneB || montant <= 0) {
          erreur.textContent = "Les deux zones et un montant supérieur à zéro sont obligatoires.";
          erreur.classList.add("visible");
          return;
        }
        evenement.currentTarget.disabled = true;
        const resultat = await enregistrerTarifPaire(
          { zoneDepart: zoneA, zoneArrivee: zoneB, montant },
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

  async function ouvrirTarifsNouvelleZone(nouvelleZone) {
    const [zonesActives, pairesActives] = await Promise.all([
      listerZones().then((zones) => zones.filter((zone) => zone.actif)),
      listerTarifsPaires().then((paires) => paires.filter((paire) => paire.actif))
    ]);
    const montantParPaire = new Map(pairesActives.map((paire) => [
      [paire.zone_a, paire.zone_b].sort().join("|"),
      paire.montant
    ]));
    const zonesTriees = zonesActives
      .filter((zone) => zone.code_zone !== nouvelleZone.code_zone)
      .sort((a, b) =>
      libelleZone(a).localeCompare(libelleZone(b), "fr", { sensitivity: "base" })
    );

    if (!zonesTriees.length) {
      afficherFlash("Zone créée");
      fermerModale();
      rafraichir();
      return;
    }

    ouvrirModale(`
      <h2>Tarifs de ${escapeHtml(libelleZone(nouvelleZone))}</h2>
      <p class="message-erreur" id="erreur-grille-tarifs"></p>
      <div class="outils-grille-tarifs">
        <div class="champ">
          <label>Montant commun</label>
          <div class="ligne-montant-commun">
            <input id="montant-commun-zone" type="number" min="1" placeholder="FCFA">
            <button class="btn btn-discret" id="appliquer-montant-commun" type="button">Appliquer à toutes</button>
          </div>
        </div>
        <div class="champ">
          <label>Rechercher</label>
          <input id="recherche-grille-tarifs" type="search" placeholder="Commune, secteur ou code">
        </div>
        <div class="progression-tarifs" id="progression-tarifs"></div>
      </div>
      <div class="grille-tarifs-zone" id="grille-tarifs-zone">
        ${zonesTriees.map((zone) => {
          const cle = [nouvelleZone.code_zone, zone.code_zone].sort().join("|");
          const valeur = montantParPaire.get(cle) || "";
          const recherche = normaliserRecherche(`${zone.code_zone} ${zone.nom_commune} ${zone.secteur}`);
          return `
            <label class="ligne-tarif-zone" data-recherche="${escapeHtml(recherche)}">
              <span>
                <strong>${escapeHtml(libelleZone(zone))}</strong>
                <small>${escapeHtml(zone.code_zone)}</small>
              </span>
              <input
                class="montant-paire-zone"
                data-zone="${escapeHtml(zone.code_zone)}"
                type="number"
                min="1"
                inputmode="numeric"
                value="${escapeHtml(valeur)}"
                placeholder="FCFA"
              >
            </label>`;
        }).join("")}
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-plus-tard-tarifs">Plus tard</button>
        <button class="btn btn-primaire" id="btn-enregistrer-grille-tarifs">Enregistrer tous les tarifs</button>
      </div>
    `, (boite) => {
      const champs = [...boite.querySelectorAll(".montant-paire-zone")];
      const progression = boite.querySelector("#progression-tarifs");
      const mettreAJourProgression = () => {
        const remplis = champs.filter((champ) => Number(champ.value) > 0).length;
        progression.textContent = `${remplis} / ${champs.length} tarifs renseignés`;
      };

      champs.forEach((champ) => champ.addEventListener("input", mettreAJourProgression));
      mettreAJourProgression();

      boite.querySelector("#appliquer-montant-commun").addEventListener("click", () => {
        const montant = Number(boite.querySelector("#montant-commun-zone").value);
        if (montant <= 0) return;
        champs.forEach((champ) => { champ.value = montant; });
        mettreAJourProgression();
      });

      boite.querySelector("#recherche-grille-tarifs").addEventListener("input", (evenement) => {
        const terme = normaliserRecherche(evenement.target.value);
        boite.querySelectorAll(".ligne-tarif-zone").forEach((ligne) => {
          ligne.hidden = !ligne.dataset.recherche.includes(terme);
        });
      });

      boite.querySelector("#btn-plus-tard-tarifs").addEventListener("click", () => {
        fermerModale();
        afficherFlash("Zone créée — tarifs à compléter");
        rafraichir();
      });

      boite.querySelector("#btn-enregistrer-grille-tarifs").addEventListener("click", async (evenement) => {
        const incomplets = champs.filter((champ) => Number(champ.value) <= 0);
        const erreur = boite.querySelector("#erreur-grille-tarifs");
        if (incomplets.length) {
          erreur.textContent = `${incomplets.length} tarif${incomplets.length > 1 ? "s sont" : " est"} encore à renseigner.`;
          erreur.classList.add("visible");
          incomplets[0].focus();
          return;
        }

        evenement.currentTarget.disabled = true;
        const resultat = await enregistrerTarifsPairesPourZone({
          codeZone: nouvelleZone.code_zone,
          tarifs: champs.map((champ) => ({
            codeZone: champ.dataset.zone,
            montant: Number(champ.value)
          }))
        }, profil.id_entreprise);

        if (resultat.ok) {
          afficherFlash("Zone et tarifs configurés");
          fermerModale();
          ongletActif = "ZONES";
          rafraichir();
        } else {
          erreur.textContent = resultat.message;
          erreur.classList.add("visible");
          evenement.currentTarget.disabled = false;
        }
      });
    });
  }

  function ouvrirFormulaireZone(zone) {
    ouvrirModale(`
      <h2>${zone ? "Modifier la zone" : "Nouvelle zone"}</h2>
      <p class="message-erreur" id="erreur-zone"></p>
      <div class="formulaire">
        <div class="champ"><label>Code zone</label><input id="z-code" value="${zone?.code_zone || ""}" ${zone ? "disabled" : ""} placeholder="YOP-NIANGON"></div>
        <div class="champ"><label>Commune</label><input id="z-nom-commune" value="${zone?.nom_commune || ""}" placeholder="Yopougon"></div>
        <div class="champ"><label>Secteur</label><input id="z-secteur" value="${zone?.secteur || ""}" placeholder="Niangon"></div>
        <div class="champ"><label>Mots-clés</label><input id="z-mots-cles" value="${(zone?.mots_cles || []).join(", ")}" placeholder="Niangon Nord, Niangon Sud"></div>
        <div class="champ">
          <label>Hub de ramassage</label>
          <select id="z-hub">
            <option value="">Aucun</option>
            ${hubs.map((hub) => `<option value="${hub.id_hub}" ${hub.id_hub === zone?.id_hub ? "selected" : ""}>${escapeHtml(hub.nom)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer">Enregistrer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer").addEventListener("click", async (evenement) => {
        const codeZone = boite.querySelector("#z-code").value.trim().toUpperCase();
        const nomCommune = boite.querySelector("#z-nom-commune").value.trim();
        const secteur = boite.querySelector("#z-secteur").value.trim() || nomCommune;
        const erreur = boite.querySelector("#erreur-zone");
        if (!codeZone || !nomCommune) {
          erreur.textContent = "Le code et la commune sont obligatoires.";
          erreur.classList.add("visible");
          return;
        }

        evenement.currentTarget.disabled = true;
        const motsCles = boite.querySelector("#z-mots-cles").value
          .split(",")
          .map((mot) => mot.trim())
          .filter(Boolean);
        const resultat = await enregistrerZone({
          codeZone,
          secteur,
          nomCommune,
          motsCles,
          idHub: boite.querySelector("#z-hub").value || null
        }, profil.id_entreprise);

        if (!resultat.ok) {
          erreur.textContent = resultat.message;
          erreur.classList.add("visible");
          evenement.currentTarget.disabled = false;
          return;
        }

        if (zone) {
          afficherFlash("Zone modifiée");
          fermerModale();
          rafraichir();
          return;
        }

        ouvrirTarifsNouvelleZone({
          code_zone: codeZone,
          nom_commune: nomCommune,
          secteur
        });
      });
    });
  }

  await rafraichir();
  return () => fermerModale();
}
