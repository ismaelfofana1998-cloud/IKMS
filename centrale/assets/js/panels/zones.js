import { listerZones, enregistrerZone, desactiverZone, listerTarifsPaires, enregistrerTarifPaire, desactiverTarifPaire, listerHubs } from "../repository.js";
import { afficherFlash, escapeHtml, formaterFcfa, ouvrirModale, fermerModale } from "../ui.js";

export const titre = "Zones et tarifs";
export const sousTitre = "Les zones sont une liste de référence ; le tarif ne vient que du tableau des paires ci-dessous.";

export async function monter(conteneur, actionsContainer, profil) {
  const hubs = await listerHubs();
  // "Zone" (le prix, l'usage courant) et "Paramétrage Zone" (créer/organiser
  // les secteurs, plus rare) : deux préoccupations très différentes en
  // fréquence d'usage, mélangées dans un seul écran avant -- d'où "le
  // bordel" à mesure que la liste de secteurs s'allonge.
  let ongletActif = "ZONE";

  function majActions() {
    actionsContainer.innerHTML = ongletActif === "PARAMETRAGE"
      ? `<button class="btn btn-primaire" id="btn-nouvelle-zone">+ Nouvelle zone</button>`
      : `<button class="btn btn-primaire" id="btn-nouveau-tarif-paire">+ Tarif entre deux zones</button>`;
    actionsContainer.querySelector("#btn-nouvelle-zone")?.addEventListener("click", () => ouvrirFormulaire(null));
    actionsContainer.querySelector("#btn-nouveau-tarif-paire")?.addEventListener("click", async () => {
      ouvrirFormulairePaire(null, (await listerZones()).filter((z) => z.actif));
    });
  }

  async function rafraichir() {
    const zones = (await listerZones()).filter((z) => z.actif);
    const paires = (await listerTarifsPaires()).filter((p) => p.actif);
    const nomZone = (code) => zones.find((z) => z.code_zone === code)?.secteur || code;
    majActions();

    conteneur.innerHTML = `
      <div class="onglets-panneau">
        <button class="onglet-panneau" data-onglet="ZONE" aria-current="${ongletActif === "ZONE"}">Zone</button>
        <button class="onglet-panneau" data-onglet="PARAMETRAGE" aria-current="${ongletActif === "PARAMETRAGE"}">Paramétrage Zone</button>
      </div>

      ${ongletActif === "ZONE" ? `
      <div class="bloc-tableau">
        <div class="tableau-titre">Tarifs entre deux zones (source unique du prix)</div>
        <p class="sous-titre" style="margin-bottom:10px;">
          Une paire vaut dans les deux sens : Cocody ↔ Marcory n'a qu'un seul tarif, quel que soit le sens du trajet.
          Une zone vers elle-même (ex. Yopougon ↔ Yopougon) sert pour les livraisons locales.
          <strong>Toute combinaison de zones utilisée dans une commande doit avoir une ligne ici</strong> —
          sinon la commande est refusée avec un message explicite (il n'y a plus de tarif "par défaut" en repli).
          Pour créer ou organiser des secteurs, c'est dans l'onglet "Paramétrage Zone".
        </p>
        ${paires.length ? `
          <table class="donnees">
            <thead><tr><th>Zone X</th><th>Zone Y</th><th>Montant</th><th></th></tr></thead>
            <tbody>
              ${paires.map((p) => `
                <tr>
                  <td class="cellule-donnee">${escapeHtml(nomZone(p.zone_a))}</td>
                  <td class="cellule-donnee">${escapeHtml(nomZone(p.zone_b))}</td>
                  <td class="cellule-donnee">${formaterFcfa(p.montant)} FCFA</td>
                  <td class="cellule-actions">
                    <button class="btn btn-discret btn-petit" data-modifier-paire="${p.id}">Modifier</button>
                    <button class="btn btn-alerte btn-petit" data-desactiver-paire="${p.id}">Désactiver</button>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="etat-vide-tableau">Aucun tarif défini. Tant qu'aucune paire n'est configurée, aucune commande ne peut être créée pour les zones concernées.</div>`}
      </div>` : `
      <div class="bloc-tableau">
        <div class="tableau-titre">Zones (liste de référence — aucun prix ici)</div>
        <p class="sous-titre" style="margin-bottom:10px;">
          Le code et le secteur d'abord : c'est l'unité qui sert au calcul du tarif et que le client verra en
          second (après avoir choisi sa commune). Plusieurs secteurs peuvent partager la même commune —
          c'est ce qui permet au client de la choisir d'abord, puis d'affiner si tu en as défini plusieurs.
        </p>
        ${zones.length ? `
          <table class="donnees">
            <thead><tr><th>Code (interne)</th><th>Secteur</th><th>Commune</th><th>Mots-clés</th><th>Hub de ramassage</th><th></th></tr></thead>
            <tbody>
              ${zones.map((z) => `
                <tr>
                  <td class="cellule-donnee">${escapeHtml(z.code_zone)}</td>
                  <td class="cellule-donnee">${escapeHtml(z.secteur || "—")}</td>
                  <td>${escapeHtml(z.nom_commune || "—")}</td>
                  <td>${(z.mots_cles || []).length ? escapeHtml(z.mots_cles.join(", ")) : `<span style="color:var(--ink-soft);">aucun (= toute la commune)</span>`}</td>
                  <td>${hubs.find((h) => h.id_hub === z.id_hub)?.nom || "—"}</td>
                  <td class="cellule-actions">
                    <button class="btn btn-discret btn-petit" data-modifier="${z.id}">Modifier</button>
                    <button class="btn btn-alerte btn-petit" data-desactiver="${z.id}">Désactiver</button>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="etat-vide-tableau">Aucune zone définie.</div>`}
      </div>`}`;

    conteneur.querySelectorAll("[data-onglet]").forEach((btn) => {
      btn.addEventListener("click", () => { ongletActif = btn.dataset.onglet; rafraichir(); });
    });
    conteneur.querySelectorAll("[data-modifier]").forEach((btn) => {
      const z = zones.find((x) => x.id === Number(btn.dataset.modifier));
      btn.addEventListener("click", () => ouvrirFormulaire(z));
    });
    conteneur.querySelectorAll("[data-desactiver]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const r = await desactiverZone(Number(btn.dataset.desactiver));
        if (r.ok) { afficherFlash("Zone désactivée"); rafraichir(); } else afficherFlash(r.message, true);
      });
    });
    conteneur.querySelectorAll("[data-modifier-paire]").forEach((btn) => {
      const p = paires.find((x) => x.id === Number(btn.dataset.modifierPaire));
      btn.addEventListener("click", () => ouvrirFormulairePaire(p, zones));
    });
    conteneur.querySelectorAll("[data-desactiver-paire]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const r = await desactiverTarifPaire(Number(btn.dataset.desactiverPaire));
        if (r.ok) { afficherFlash("Tarif désactivé"); rafraichir(); } else afficherFlash(r.message, true);
      });
    });
  }

  function ouvrirFormulairePaire(paire, zones) {
    const optionsZonesHtml = (valeurSelectionnee) => zones.map((z) =>
      `<option value="${z.code_zone}" ${z.code_zone === valeurSelectionnee ? "selected" : ""}>${escapeHtml(z.secteur || z.code_zone)}</option>`
    ).join("");
    ouvrirModale(`
      <h2>${paire ? "Modifier le tarif" : "Nouveau tarif entre deux zones"}</h2>
      <p class="sous-titre" style="margin-bottom:10px;">
        Zone X et Zone Y, pas "départ" et "arrivée" : ce tarif s'applique dans les deux sens.
        Les deux peuvent être la même zone (livraison locale).
      </p>
      <p class="message-erreur" id="erreur-paire"></p>
      <div class="formulaire">
        <div class="champ"><label>Zone X</label><select id="p-zone-a">${optionsZonesHtml(paire?.zone_a)}</select></div>
        <div class="champ"><label>Zone Y</label><select id="p-zone-b">${optionsZonesHtml(paire?.zone_b)}</select></div>
        <div class="champ"><label>Montant (FCFA)</label><input id="p-montant" type="number" value="${paire?.montant || ""}" required></div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler-paire">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer-paire">Enregistrer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler-paire").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer-paire").addEventListener("click", async (e) => {
        const zoneX = boite.querySelector("#p-zone-a").value;
        const zoneY = boite.querySelector("#p-zone-b").value;
        const montant = Number(boite.querySelector("#p-montant").value);
        const erreur = boite.querySelector("#erreur-paire");
        if (!zoneX || !zoneY || !montant) { erreur.textContent = "Les deux zones et le montant sont obligatoires."; erreur.classList.add("visible"); return; }
        e.currentTarget.disabled = true;
        const r = await enregistrerTarifPaire({ zoneDepart: zoneX, zoneArrivee: zoneY, montant }, profil.id_entreprise);
        if (r.ok) { afficherFlash("Tarif enregistré"); fermerModale(); rafraichir(); }
        else { erreur.textContent = r.message; erreur.classList.add("visible"); e.currentTarget.disabled = false; }
      });
    });
  }

  function ouvrirFormulaire(zone) {
    ouvrirModale(`
      <h2>${zone ? "Modifier la zone" : "Nouvelle zone"}</h2>
      <p class="message-erreur" id="erreur-zone"></p>
      <div class="formulaire">
        <div class="champ"><label>Code zone (interne, jamais montré au client)</label><input id="z-code" value="${zone?.code_zone || ""}" ${zone ? "disabled" : ""} placeholder="YOP-NIANGON"></div>
        <div class="champ">
          <label>Nom de la commune</label>
          <input id="z-nom-commune" value="${zone?.nom_commune || ""}" placeholder="Yopougon">
          <p class="sous-titre" style="margin-top:4px;font-size:12px;">
            Ce que le client voit et choisit en premier. Donne le MÊME nom de commune à plusieurs zones
            pour créer des sous-zones sous la même entrée (ex. Yopougon → Niangon, Gesco, Siporex).
          </p>
        </div>
        <div class="champ"><label>Secteur (nom affiché de cette zone précise)</label><input id="z-secteur" value="${zone?.secteur || ""}" placeholder="Niangon, ou Yopougon si zone unique"></div>
        <div class="champ">
          <label>Mots-clés de reconnaissance (optionnel)</label>
          <input id="z-mots-cles" value="${(zone?.mots_cles || []).join(", ")}" placeholder="Niangon, Niangon Nord, Niangon Sud">
          <p class="sous-titre" style="margin-top:4px;font-size:12px;">
            Séparés par des virgules. Laisse vide si cette zone couvre toute la commune sans découpage —
            le nom de la commune suffit alors à la reconnaissance automatique.
          </p>
        </div>
        <div class="champ">
          <label>Hub de ramassage</label>
          <select id="z-hub">
            <option value="">Aucun (pas encore assigné)</option>
            ${hubs.map((h) => `<option value="${h.id_hub}" ${h.id_hub === zone?.id_hub ? "selected" : ""}>${escapeHtml(h.nom)}</option>`).join("")}
          </select>
          <p class="sous-titre" style="margin-top:4px;font-size:12px;">
            Le hub qui recevra les colis ramassés dans cette zone — se déduit automatiquement à la création de chaque commande.
          </p>
        </div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer">Enregistrer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer").addEventListener("click", async (e) => {
        const codeZone = boite.querySelector("#z-code").value.trim();
        const nomCommune = boite.querySelector("#z-nom-commune").value.trim();
        const erreur = boite.querySelector("#erreur-zone");
        if (!codeZone) { erreur.textContent = "Le code zone est obligatoire."; erreur.classList.add("visible"); return; }
        if (!nomCommune) { erreur.textContent = "Le nom de la commune est obligatoire — c'est ce que le client verra en premier."; erreur.classList.add("visible"); return; }
        e.currentTarget.disabled = true;
        const motsCles = boite.querySelector("#z-mots-cles").value.split(",").map((m) => m.trim()).filter(Boolean);
        const r = await enregistrerZone({
          codeZone, secteur: boite.querySelector("#z-secteur").value.trim() || nomCommune, nomCommune, motsCles,
          idHub: boite.querySelector("#z-hub").value || null
        }, profil.id_entreprise);
        if (r.ok) { afficherFlash("Zone enregistrée"); fermerModale(); rafraichir(); }
        else { erreur.textContent = r.message; erreur.classList.add("visible"); e.currentTarget.disabled = false; }
      });
    });
  }

  await rafraichir();
  return () => fermerModale();
}
