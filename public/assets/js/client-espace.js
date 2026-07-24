import { getSupabaseClient } from "./supabase-client.js";
import { localiserMoi, brancherAutocompletion, deviserZone, rechercherAdresses } from "./geo.js";
import { resoudreCodeEntreprise, lienPage } from "./entreprise-contexte.js";

const codeEntreprise = resoudreCodeEntreprise();
const conteneur = document.querySelector("#contenu");
const supabase = getSupabaseClient();

let compteurLigne = 0;
let zones = [];
let client = null;
let gpsClient = null;
let ongletActif = "COMMANDE";

function escapeHtml(texte) {
  const div = document.createElement("div");
  div.textContent = String(texte ?? "");
  return div.innerHTML;
}
function formaterFcfa(montant) {
  return new Intl.NumberFormat("fr-FR").format(Number(montant || 0));
}

function urlSuivi(token) {
  const base = window.APP_CONFIG?.APP_BASE_URL || window.location.origin;
  return `${base}${window.location.pathname.replace(/[^/]*$/, "")}suivi.html?token=${token}`;
}

async function partager(texte, url, bouton) {
  const texteComplet = `${texte} ${url}`;
  if (navigator.share) {
    try { await navigator.share({ text: texte, url }); return; } catch { return; }
  }
  try {
    await navigator.clipboard.writeText(texteComplet);
    const original = bouton.textContent;
    bouton.textContent = "Copié";
    setTimeout(() => { bouton.textContent = original; }, 1800);
  } catch { /* silencieux */ }
}
function validerTelephone(valeur) {
  const local = String(valeur || "").replace(/[\s.\-]/g, "").replace(/^(\+225|00225|225)/, "");
  if (!/^0\d{9}$/.test(local)) {
    return { valide: false, message: "numéro invalide (10 chiffres attendus, ex. 07 00 00 00 00)." };
  }
  return { valide: true, normalise: local };
}

function majContenu(html) {
  conteneur.innerHTML = html;
  conteneur.classList.remove("entree-contenu");
  void conteneur.offsetWidth;
  conteneur.classList.add("entree-contenu");
}

async function demarrer() {
  if (!codeEntreprise) {
    majContenu(`
      <div class="chargement-pub">
        Aucune entreprise identifiée. Ouvre d'abord le lien complet fourni par ton entreprise de livraison
        (avec <code>?entreprise=CODE</code>) — il sera ensuite mémorisé sur cet appareil.
      </div>`);
    return;
  }

  // Marque blanche : cette page appartient à l'entreprise de livraison, pas
  // à la plateforme IKMS elle-même — invisible pour ses clients. Distinct de
  // #nom-client plus bas, qui affiche l'identité du client connecté.
  supabase.rpc("rpc_nom_entreprise", { p_code_entreprise: codeEntreprise }).then(({ data: nomEntreprise }) => {
    const elMarque = document.querySelector("#marque-tenant");
    if (elMarque) elMarque.textContent = nomEntreprise || "Mon espace";
  });

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = lienPage("client-connexion.html", codeEntreprise);
    return;
  }

  const { data: clientData, error: erreurClient } = await supabase
    .from("clients_pro")
    .select("id_client, nom, telephone, adresse, solde_portefeuille, facturation_activee")
    .eq("id_auth", session.user.id)
    .maybeSingle();
  if (erreurClient) {
    majContenu(`<div class="chargement-pub">Une erreur est survenue (${escapeHtml(erreurClient.message)}). Réessaie dans un instant.</div>`);
    return;
  }
  if (!clientData) {
    // La session existe mais ne correspond à aucun compte client de CETTE
    // entreprise (ex. session d'une autre entreprise testée avant sur ce
    // même appareil) -- déconnexion silencieuse puis retour à la vraie
    // page de connexion, jamais un message d'erreur qui ressemble à un
    // compte cassé.
    await supabase.auth.signOut();
    window.location.href = lienPage("client-connexion.html", codeEntreprise);
    return;
  }
  client = clientData;
  document.querySelector("#nom-client").textContent = client.nom;

  document.querySelector("#btn-deconnexion").addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = lienPage("client-connexion.html", codeEntreprise);
  });

  const { data: zonesData } = await supabase.rpc("rpc_lister_zones_publiques", { p_code_entreprise: codeEntreprise });
  zones = zonesData || [];

  rendrePage();
}

function rendrePage() {
  majContenu(`
    <div class="barre-client">
      <span>Portefeuille</span>
      <span class="solde ${client.solde_portefeuille < 0 ? "negatif" : ""}">${formaterFcfa(client.solde_portefeuille)} FCFA</span>
    </div>
    <div class="onglets-client">
      <button class="onglet-client" data-onglet="COMMANDE" aria-current="${ongletActif === "COMMANDE"}">Nouvelle commande</button>
      <button class="onglet-client" data-onglet="HISTORIQUE" aria-current="${ongletActif === "HISTORIQUE"}">Historique</button>
      <button class="onglet-client" data-onglet="API" aria-current="${ongletActif === "API"}">API</button>
    </div>
    <div id="zone-onglet"></div>
  `);
  document.querySelectorAll(".onglet-client").forEach((btn) => {
    btn.addEventListener("click", () => {
      ongletActif = btn.dataset.onglet;
      rendrePage();
    });
  });
  if (ongletActif === "COMMANDE") rendreFormulaireCommande();
  else if (ongletActif === "API") rendreApi();
  else rendreHistorique();
}

function optionsZones(classe) {
  return `
    <select class="${classe}" required>
      <option value="">Choisir la zone…</option>
      ${zones.map((z) => `<option value="${z.code_zone}">${escapeHtml(z.secteur || z.code_zone)}</option>`).join("")}
    </select>`;
}

function ligneColisHtml(index) {
  return `
    <div class="carte-colis-pub" data-ligne="${index}">
      ${index > 0 ? '<button type="button" class="retirer-colis" data-retirer>Retirer</button>' : ""}
      <div class="champ-pub"><label>Nom du destinataire</label><input class="dest-nom" required placeholder="Nom complet"></div>
      <div class="champ-pub"><label>Téléphone du destinataire</label><input class="dest-tel" type="tel" inputmode="numeric" required placeholder="07 00 00 00 00" maxlength="14"></div>
      <div class="champ-pub champ-adresse-pub">
        <label>Adresse</label>
        <input class="dest-adresse" placeholder="Quartier, repère" autocomplete="off">
        <div class="liste-suggestions" hidden></div>
      </div>
      <div class="champ-pub">
        <label>Zone de livraison</label>
        ${optionsZones("dest-zone")}
        <div class="prix-estime" data-prix-ligne hidden></div>
      </div>
    </div>`;
}

async function estimerPrixLigne(ligneEl, zoneDepart) {
  const zoneArrivee = ligneEl.querySelector(".dest-zone").value;
  const prixEl = ligneEl.querySelector("[data-prix-ligne]");
  if (!zoneDepart || !zoneArrivee) { prixEl.hidden = true; return; }
  const { data, error } = await supabase.rpc("rpc_estimer_tarif", {
    p_code_entreprise: codeEntreprise, p_zone_depart: zoneDepart, p_zone_arrivee: zoneArrivee
  });
  if (error || data == null) { prixEl.hidden = true; return; }
  prixEl.textContent = `≈ ${formaterFcfa(data)} FCFA`;
  prixEl.hidden = false;
}

function rendreFormulaireCommande() {
  document.querySelector("#zone-onglet").innerHTML = `
    <p class="message-erreur-pub" id="erreur-form"></p>
    <form id="form-commande-client">
      <div class="champ-pub champ-adresse-pub">
        <label>Adresse de ramassage</label>
        <div class="ligne-adresse-geoloc">
          <input id="exp-adresse" placeholder="Quartier, repère" autocomplete="off" value="${escapeHtml(client.adresse || "")}">
          <button type="button" class="btn-geoloc" id="btn-ma-position" title="Utiliser ma position">📍 Ma position</button>
        </div>
        <div class="liste-suggestions" id="suggestions-exp" hidden></div>
      </div>

      <div class="champ-pub">
        <label>Zone de ramassage</label>
        ${optionsZones("exp-zone")}
      </div>

      <div class="champ-pub">
        <label>Paiement</label>
        <select id="mode-paiement">
          ${client.facturation_activee ? `<option value="SANS_PAIEMENT">Facturation (débité de mon portefeuille)</option>` : ""}
          <option value="PAR_EXPEDITEUR">Je paie maintenant (espèces/Wave au ramassage)</option>
          <option value="A_LA_LIVRAISON">Le destinataire paie à la livraison</option>
        </select>
        ${!client.facturation_activee ? `<p style="font-size:11px;color:var(--sur-sombre-doux);margin-top:6px;">La facturation différée n'est pas encore activée pour ce compte — contacte l'entreprise si besoin.</p>` : ""}
      </div>

      <div id="liste-colis">${ligneColisHtml(0)}</div>
      <button type="button" class="btn-pub btn-pub-discret" id="btn-ajouter-colis" style="margin-bottom:18px;">+ Ajouter un destinataire</button>

      <button type="submit" class="btn-pub btn-pub-primaire" id="btn-envoyer">Envoyer le colis</button>
      <p style="font-size:12.5px;color:var(--ink-soft);text-align:center;margin-top:10px;">
        Le montant sera débité directement de votre portefeuille — aucun paiement à faire ici.
      </p>
    </form>
  `;
  compteurLigne = 1;

  const champAdresseExp = document.querySelector("#exp-adresse");
  const suggestionsExp = document.querySelector("#suggestions-exp");
  const zoneDepartEl = document.querySelector(".exp-zone");

  function suggererZone(gps, selectEl) {
    if (!gps?.commune) return;
    if (selectEl.value && selectEl.dataset.autoSuggere !== "1") return;
    const zoneDevinee = deviserZone(gps.commune, zones, gps.label);
    if (zoneDevinee) { selectEl.value = zoneDevinee; selectEl.dataset.autoSuggere = "1"; selectEl.dispatchEvent(new Event("change")); }
  }
  zoneDepartEl.addEventListener("change", (e) => { if (e.isTrusted) delete zoneDepartEl.dataset.autoSuggere; });

  brancherAutocompletion(champAdresseExp, suggestionsExp, (gps) => { gpsClient = gps; suggererZone(gps, zoneDepartEl); });
  document.querySelector("#btn-ma-position").addEventListener("click", (e) => {
    localiserMoi(e.currentTarget, champAdresseExp, (gps) => { gpsClient = gps; suggererZone(gps, zoneDepartEl); });
  });

  // L'adresse enregistrée est déjà pré-remplie (texte) — mais sans position
  // GPS tant que la personne ne retouche pas le champ, la suggestion de
  // zone ne se déclencherait pas. On géocode cette adresse tout de suite,
  // silencieusement, exactement comme si elle venait d'être sélectionnée
  // dans l'autocomplétion.
  if (client.adresse) {
    rechercherAdresses(client.adresse).then(([premier]) => {
      if (!premier) return;
      gpsClient = { lat: premier.lat, lng: premier.lon, commune: premier.commune };
      suggererZone(gpsClient, zoneDepartEl);
    });
  }

  function rebrancherLigneColis(ligneEl) {
    const zoneEl = ligneEl.querySelector(".dest-zone");
    zoneEl.addEventListener("change", (e) => {
      if (e.isTrusted) delete zoneEl.dataset.autoSuggere;
      estimerPrixLigne(ligneEl, zoneDepartEl.value);
    });
    brancherAutocompletion(ligneEl.querySelector(".dest-adresse"), ligneEl.querySelector(".liste-suggestions"),
      (gps) => suggererZone(gps, zoneEl));
  }
  document.querySelectorAll("[data-ligne]").forEach(rebrancherLigneColis);
  zoneDepartEl.addEventListener("change", () => {
    document.querySelectorAll("[data-ligne]").forEach((l) => estimerPrixLigne(l, zoneDepartEl.value));
  });

  document.querySelector("#btn-ajouter-colis").addEventListener("click", () => {
    document.querySelector("#liste-colis").insertAdjacentHTML("beforeend", ligneColisHtml(compteurLigne++));
    rebrancherLigneColis(document.querySelector("#liste-colis").lastElementChild);
  });
  document.querySelector("#liste-colis").addEventListener("click", (e) => {
    if (e.target.matches("[data-retirer]")) e.target.closest("[data-ligne]").remove();
  });

  document.querySelector("#form-commande-client").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erreur = document.querySelector("#erreur-form");
    erreur.classList.remove("visible");

    const zoneDepart = zoneDepartEl.value.trim().toUpperCase();
    if (!zoneDepart) { erreur.textContent = "Choisissez votre zone de ramassage."; erreur.classList.add("visible"); return; }

    const lignes = [...document.querySelectorAll("[data-ligne]")];
    const colis = lignes.map((l) => ({
      destinataire_nom: l.querySelector(".dest-nom").value.trim(),
      destinataire_tel: l.querySelector(".dest-tel").value.trim(),
      destinataire_adresse: l.querySelector(".dest-adresse").value.trim(),
      code_zone: (l.querySelector(".dest-zone")?.value || "").trim().toUpperCase()
    })).filter((c) => c.destinataire_nom && c.destinataire_tel);

    if (!colis.length) { erreur.textContent = "Ajoutez au moins un destinataire."; erreur.classList.add("visible"); return; }
    if (colis.some((c) => !c.code_zone)) { erreur.textContent = "Choisissez la zone de livraison pour chaque destinataire."; erreur.classList.add("visible"); return; }
    for (const c of colis) {
      const v = validerTelephone(c.destinataire_tel);
      if (!v.valide) { erreur.textContent = `Téléphone de ${c.destinataire_nom} : ${v.message}`; erreur.classList.add("visible"); return; }
      c.destinataire_tel = v.normalise;
    }

    const bouton = document.querySelector("#btn-envoyer");
    bouton.disabled = true; bouton.textContent = "Envoi…";

    const { data: resultat, error: err } = await supabase.rpc("rpc_creer_commande", {
      p_code_entreprise: codeEntreprise,
      p_expediteur_nom: client.nom,
      p_expediteur_tel: client.telephone,
      p_expediteur_adresse: champAdresseExp.value.trim() || null,
      p_gps_expediteur: gpsClient,
      p_mode_paiement: document.querySelector("#mode-paiement").value,
      p_colis: colis,
      p_canal: "CLIENT_PRO",
      p_zone_depart: zoneDepart
    });

    if (err || !resultat?.length) {
      erreur.textContent = err?.message || "Une erreur est survenue. Réessaie.";
      erreur.classList.add("visible");
      bouton.disabled = false; bouton.textContent = "Envoyer le colis";
      return;
    }

    const total = resultat.reduce((s, c) => s + Number(c.montant_livraison || 0), 0);
    const modePaiementChoisi = document.querySelector("#mode-paiement").value;
    const estFacture = modePaiementChoisi === "SANS_PAIEMENT";
    if (estFacture) client.solde_portefeuille -= total;

    const messagesParMode = {
      SANS_PAIEMENT: `${formaterFcfa(total)} FCFA débités de votre portefeuille`,
      PAR_EXPEDITEUR: `${formaterFcfa(total)} FCFA à régler au livreur au ramassage`,
      A_LA_LIVRAISON: `${formaterFcfa(total)} FCFA à régler par le destinataire à la livraison`
    };

    majContenu(`
      <div class="recap-code">
        <div class="label">Commande envoyée · ${messagesParMode[modePaiementChoisi] || formaterFcfa(total) + " FCFA"}</div>
        <div class="code">${escapeHtml(resultat[0].code_ramassage)}</div>
      </div>
      <p style="font-size:13px;color:var(--ink-soft);text-align:center;margin-top:14px;">
        Code à donner au livreur au ramassage.${estFacture ? ` Nouveau solde : ${formaterFcfa(client.solde_portefeuille)} FCFA.` : ""}
      </p>
      <div class="bloc-recap" style="margin-top:16px;">
        <h3>${resultat.length > 1 ? `${resultat.length} colis créés` : "Colis créé"}</h3>
        ${resultat.map((l, i) => `
          <div class="ligne-lien">
            <span>Colis ${i + 1} · code ${escapeHtml(l.code_livraison)}</span>
            <button class="btn-pub btn-pub-secondaire" style="width:auto;min-height:36px;padding:0 14px;" data-partager="${urlSuivi(l.token_destinataire)}" data-texte="Voici le lien pour partager votre position au livreur">Lien destinataire</button>
          </div>`).join("")}
      </div>
      <p style="font-size:12.5px;color:var(--ink-soft);text-align:center;margin-top:8px;">
        Envoyez le lien "destinataire" à chaque personne : il lui permet de partager sa position au livreur.
      </p>
      <button class="btn-pub btn-pub-primaire" id="btn-nouvelle-commande" style="margin-top:18px;">Nouvelle commande</button>
    `);
    document.querySelectorAll("[data-partager]").forEach((b) => {
      b.addEventListener("click", () => partager(b.dataset.texte, b.dataset.partager, b));
    });
    document.querySelector("#btn-nouvelle-commande").addEventListener("click", rendrePage);
  });
}

async function rendreApi() {
  const zoneOnglet = document.querySelector("#zone-onglet");
  zoneOnglet.innerHTML = `<div class="chargement-pub">Chargement…</div>`;

  const { data: cles, error } = await supabase.rpc("rpc_lister_cles_api");
  if (error) {
    zoneOnglet.innerHTML = `<div class="chargement-pub">Erreur : ${escapeHtml(error.message)}</div>`;
    return;
  }

  zoneOnglet.innerHTML = `
    <div class="bloc-recap">
      <h3>Clés API</h3>
      <p style="font-size:13px;color:var(--sur-sombre-doux);margin-bottom:14px;">
        Pour que ton propre système (ERP, site...) crée des commandes et consulte leur statut
        directement, sans passer par cette page. Une fois créée, la clé n'est plus jamais
        réaffichée — note-la tout de suite dans un endroit sûr.
      </p>
      <p class="message-erreur-pub" id="erreur-api"></p>
      ${cles?.length ? cles.map((c) => `
        <div class="ligne-lien">
          <span>${escapeHtml(c.prefixe)}… ${c.nom ? `(${escapeHtml(c.nom)})` : ""} ${c.actif ? "" : '<span style="color:var(--sur-sombre-doux);">révoquée</span>'}</span>
          ${c.actif ? `<button class="btn-pub btn-pub-secondaire" style="width:auto;min-height:32px;padding:0 12px;font-size:12px;" data-revoquer="${c.id}">Révoquer</button>` : ""}
        </div>`).join("") : `<p style="font-size:13px;color:var(--sur-sombre-doux);">Aucune clé pour l'instant.</p>`}
      <div class="champ-pub" style="margin-top:16px;">
        <label>Nom (optionnel, pour t'y retrouver)</label>
        <input id="nom-nouvelle-cle" placeholder="Ex. Serveur production">
      </div>
      <button class="btn-pub btn-pub-primaire" id="btn-nouvelle-cle">Créer une nouvelle clé</button>
      <div id="cle-generee"></div>
    </div>`;

  zoneOnglet.querySelectorAll("[data-revoquer]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Révoquer cette clé ? Tout système qui l'utilise cessera de fonctionner immédiatement.")) return;
      const { error } = await supabase.rpc("rpc_revoquer_cle_api", { p_id: btn.dataset.revoquer });
      if (error) { document.querySelector("#erreur-api").textContent = error.message; document.querySelector("#erreur-api").classList.add("visible"); return; }
      rendreApi();
    });
  });

  zoneOnglet.querySelector("#btn-nouvelle-cle").addEventListener("click", async (e) => {
    const nom = zoneOnglet.querySelector("#nom-nouvelle-cle").value.trim();
    e.currentTarget.disabled = true;
    const { data: cle, error } = await supabase.rpc("rpc_creer_cle_api", { p_nom: nom || null });
    if (error) {
      document.querySelector("#erreur-api").textContent = error.message;
      document.querySelector("#erreur-api").classList.add("visible");
      e.currentTarget.disabled = false;
      return;
    }
    document.querySelector("#cle-generee").innerHTML = `
      <div class="recap-code" style="margin-top:14px;">
        <div class="label">Ta clé — copie-la maintenant, elle ne sera plus jamais affichée</div>
        <div class="code" id="texte-cle-generee" style="font-size:14px;word-break:break-all;user-select:text;font-family:monospace;line-height:1.5;letter-spacing:normal;">${escapeHtml(cle)}</div>
        <button type="button" class="btn-pub btn-pub-secondaire" id="btn-copier-cle" style="margin-top:12px;">Copier la clé</button>
      </div>
      <button type="button" class="btn-pub btn-pub-primaire" id="btn-cle-confirmee" style="margin-top:10px;">J'ai copié ma clé — continuer</button>
    `;
    // Surtout PAS de rendreApi() ici : ça effacerait la clé affichée
    // ci-dessus avant que la personne ait pu la copier (c'était le bug —
    // la clé disparaissait instantanément). La liste ne se rafraîchit
    // qu'une fois la clé explicitement confirmée copiée.
    document.querySelector("#btn-copier-cle").addEventListener("click", async (e) => {
      try {
        await navigator.clipboard.writeText(cle);
        e.currentTarget.textContent = "Copiée ✓";
      } catch {
        // Presse-papier indisponible (permissions, contexte non sécurisé...) :
        // repli sur la sélection manuelle du texte, toujours possible.
        const plage = document.createRange();
        plage.selectNodeContents(document.querySelector("#texte-cle-generee"));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(plage);
        e.currentTarget.textContent = "Sélectionnée — Ctrl/Cmd+C pour copier";
      }
    });
    document.querySelector("#btn-cle-confirmee").addEventListener("click", () => rendreApi());
  });
}

async function rendreHistorique() {
  const zoneOnglet = document.querySelector("#zone-onglet");
  zoneOnglet.innerHTML = `<div class="chargement-pub">Chargement…</div>`;

  const { data: commandes } = await supabase
    .from("commandes")
    .select("id_commande, expediteur_adresse, cree_le")
    .eq("id_client_pro", client.id_client)
    .order("cree_le", { ascending: false });

  const { data: mouvements } = await supabase
    .from("mouvements_portefeuille")
    .select("type, montant, id_commande, note, cree_le")
    .eq("id_client", client.id_client)
    .order("cree_le", { ascending: false });

  zoneOnglet.innerHTML = `
    <div class="bloc-recap">
      <h3>Mes commandes (${commandes?.length || 0})</h3>
      ${commandes?.length ? commandes.map((c) => `
        <div class="ligne-historique">
          <span>${escapeHtml(c.id_commande)} · ${new Date(c.cree_le).toLocaleDateString("fr-FR")}</span>
        </div>`).join("") : `<p style="color:var(--ink-soft);font-size:13px;">Aucune commande pour le moment.</p>`}
    </div>
    <div class="bloc-recap" style="margin-top:16px;">
      <h3>Mouvements du portefeuille</h3>
      ${mouvements?.length ? mouvements.map((m) => `
        <div class="ligne-historique">
          <span>${new Date(m.cree_le).toLocaleDateString("fr-FR")} · ${escapeHtml(m.id_commande || m.note || "—")}</span>
          <strong style="color:${m.montant < 0 ? "var(--alerte)" : "var(--valide)"};">${formaterFcfa(m.montant)} FCFA</strong>
        </div>`).join("") : `<p style="color:var(--ink-soft);font-size:13px;">Aucun mouvement.</p>`}
    </div>
  `;
}

demarrer();
