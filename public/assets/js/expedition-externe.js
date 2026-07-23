// ============================================================================
// expedition-externe.js — flux en étapes : zones + prix d'abord (avant tout
// le reste), puis expéditeur, destinataire(s), paiement.
//
// Repensé pour la simplicité : plus de "devinette" de zone depuis une
// adresse (l'ancienne source de friction n°1) puisque les zones sont
// choisies dès le départ, avant même de savoir qui envoie ou reçoit.
//
// Compte : un expéditeur qui se connecte utilise EXACTEMENT le même compte
// qu'un client pro (table clients_pro) -- pas de système séparé. La seule
// différence entre un client "simple" et un client "pro" (facturation
// différée) est un interrupteur activé par un administrateur une fois la
// confiance établie, jamais à l'auto-inscription.
// ============================================================================

import { getSupabaseClient } from "./supabase-client.js";
import { localiserMoi, localiserSilencieusement, brancherAutocompletion, deviserZone, construireSelecteurZoneHtml, brancherSelecteurZone } from "./geo.js";
import { validerExpediteur, validerDestinataire, effacerErreur, brancherValidationDirecte, formaterTelephoneAffichage, validerTelephone, afficherErreurToast } from "./expedition-validation.js";
import { estimerTarif } from "./expedition-pricing.js";
import { soumettreCommande, urlSuivi, partager } from "./expedition-submit.js";
import { resoudreCodeEntreprise, traduireErreurAuth } from "./entreprise-contexte.js";

const codeEntreprise = resoudreCodeEntreprise();
const supabase = getSupabaseClient();

function emailSynthetique(code, telephone) {
  return `client-${code}-${telephone}@clients.ikigai.internal`.toLowerCase();
}

let zones = [];
let nbTrajets = 1;
let prixParTrajet = {};
let gpsExpediteur = null;
let compteConnecte = null; // { id_client, nom, telephone, adresse, facturation_activee } si connecté

function escapeHtml(texte) {
  const div = document.createElement("div");
  div.textContent = String(texte ?? "");
  return div.innerHTML;
}

// ----------------------------------------------------------------------------
// Navigation entre étapes : une seule visible à la fois, l'arrière-plan
// bascule directement (plus besoin d'observer le scroll).
// ----------------------------------------------------------------------------
function allerEtape(n) {
  document.querySelectorAll(".etape").forEach((el) => { el.hidden = el.dataset.etape !== String(n); });
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  if (n === 2) declencherGeolocSiBesoin();
}

// ----------------------------------------------------------------------------
// Personnalisation : textes (titre/sous-titre) et images. Rien de
// personnalisé ? Le texte/l'image par défaut reste inchangé.
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// Carrousel d'accroches (phrase + photo) tout en haut de l'étape 1 --
// jusqu'à 3 créneaux génériques ("accroche-1/2/3", voir le panneau
// Personnalisation), chacun optionnel. Rien à afficher si le tenant n'a
// rien personnalisé : le carrousel reste cité et invisible plutôt que de
// montrer un espace vide.
// ----------------------------------------------------------------------------
const SLOTS_ACCROCHE = ["accroche-1", "accroche-2", "accroche-3"];

async function appliquerAccroches() {
  const [{ data: textes }, { data: chemins }] = await Promise.all([
    supabase.rpc("rpc_lire_textes_personnalises", { p_code_entreprise: codeEntreprise }),
    supabase.rpc("rpc_lister_personnalisation", { p_code_entreprise: codeEntreprise })
  ]);
  const cheminsConnus = new Set((chemins || []).map((c) => c.chemin));
  const cartes = SLOTS_ACCROCHE.map((cle) => {
    const phrase = (textes || []).find((t) => t.cle === cle)?.titre || "";
    const cheminAttendu = `${codeEntreprise}/photo/${cle}.webp`;
    const aPhoto = cheminsConnus.has(cheminAttendu);
    if (!phrase && !aPhoto) return null;
    const url = aPhoto ? supabase.storage.from("personnalisation").getPublicUrl(cheminAttendu).data.publicUrl : null;
    return { phrase, url };
  }).filter(Boolean);

  if (!cartes.length) return;
  const conteneur = document.querySelector("#carrousel-accroches");
  conteneur.innerHTML = cartes.map((c) => `
    <div class="carte-accroche-pub" ${c.url ? `style="background-image:url('${c.url}')"` : ""}>
      ${c.phrase ? `<div class="carte-accroche-pub-voile"></div><p>${escapeHtml(c.phrase)}</p>` : ""}
    </div>`).join("");
  conteneur.hidden = false;
}

// ----------------------------------------------------------------------------
// Zones
// ----------------------------------------------------------------------------
// Avertit (sans jamais bloquer ni corriger à la place de la personne) si
// l'adresse tapée a l'air d'être dans une zone différente de celle choisie
// à l'étape 1. Le comparateur reste le même que par le passé (imparfait
// pour deviner une zone automatiquement) -- utilisé ici en mode "alerte
// douce" seulement : un raté ne coûte rien (pas d'alerte), une fausse
// alerte ne fait que demander une vérification, jamais un blocage.
function avertirSiZoneIncoherente(gps, zoneAttendue, elAvertissement) {
  if (!elAvertissement) return;
  if ((!gps?.commune && !gps?.label) || !zoneAttendue) {
    elAvertissement.hidden = true;
    delete elAvertissement.dataset.alerteTexte;
    elAvertissement.innerHTML = "";
    return;
  }
  const zoneDevinee = deviserZone(gps.commune, zones, gps.label);
  // Avant : seul "zoneDevinee existe ET diffère" déclenchait l'alerte -- une
  // adresse hors des zones connues du tenant (zoneDevinee = null, ex. un
  // test hors Abidjan) tombait dans le "sinon" et ne montrait RIEN, alors
  // que c'est le cas le plus suspect de tous. Les deux cas sont maintenant
  // traités, avec un message différent pour rester honnête sur ce qu'on sait.
  const incoherente = zoneDevinee ? zoneDevinee !== zoneAttendue : true;
  if (incoherente) {
    const libelleAttendu = zones.find((z) => z.code_zone === zoneAttendue)?.secteur || zoneAttendue;
    const texte = zoneDevinee
      ? `Adresse détectée du côté de ${zones.find((z) => z.code_zone === zoneDevinee)?.secteur || zoneDevinee}, mais la zone choisie est ${libelleAttendu}.`
      : `Commune ou secteur non vérifié dans l'adresse (${gps.commune || gps.label}), alors que la zone choisie est ${libelleAttendu}.`;
    elAvertissement.dataset.alerteTexte = texte; // capturé à l'envoi, pour que ce soit visible côté hub aussi
    elAvertissement.hidden = false;
    // Reconstruit systématiquement (texte + case à cocher) plutôt que de
    // réutiliser une case existante : un nouveau mésappariement (nouvelle
    // adresse, nouvelle zone) doit toujours repartir décoché, jamais
    // hériter d'une confirmation donnée pour une situation différente.
    elAvertissement.innerHTML = `
      <span>⚠️ ${escapeHtml(texte)} Vérifie avant d'envoyer.</span>
      <label class="confirmation-alerte-zone">
        <input type="checkbox" class="case-confirmation-zone">
        Je confirme quand même, la zone choisie est correcte.
      </label>`;
  } else {
    elAvertissement.hidden = true;
    delete elAvertissement.dataset.alerteTexte;
    elAvertissement.innerHTML = "";
  }
}

// Une alerte masquée (pas de mésappariement) est considérée confirmée
// d'office. Une alerte visible ne l'est que si la case a été cochée --
// c'est ce qui transforme le bandeau, jusqu'ici simplement informatif, en
// un vrai geste conscient avant de pouvoir continuer.
function alerteZoneEstConfirmee(elAvertissement) {
  if (!elAvertissement || elAvertissement.hidden) return true;
  return !!elAvertissement.querySelector(".case-confirmation-zone")?.checked;
}

function peuplerSelectsZones() {
  const conteneurDepart = document.querySelector("#selecteur-zone-depart");
  conteneurDepart.innerHTML = construireSelecteurZoneHtml("zone-depart");
  brancherSelecteurZone(conteneurDepart, zones);

  document.querySelectorAll(".selecteur-zone-arrivee").forEach((conteneur) => {
    const index = conteneur.dataset.trajetSelect;
    conteneur.innerHTML = construireSelecteurZoneHtml(`zone-arrivee-${index}`, "zone-arrivee");
    brancherSelecteurZone(conteneur, zones);
  });
}

// ----------------------------------------------------------------------------
// Étape 1 : zones + prix. Chaque trajet supplémentaire = un colis de plus.
// ----------------------------------------------------------------------------
function carteTrajetHtml(index) {
  return `
    <div class="carte-trajet" data-trajet="${index}">
      ${index > 0 ? `<button type="button" class="retirer-trajet" data-retirer-trajet>Retirer</button>` : ""}
      <div class="champ-pub">
        <label for="zone-arrivee-${index}">Zone d'arrivée</label>
        <div class="selecteur-zone selecteur-zone-arrivee" data-trajet-select="${index}"></div>
      </div>
      <div class="prix-estime" data-prix-trajet="${index}" hidden></div>
    </div>`;
}

function ajouterTrajet() {
  const index = nbTrajets++;
  document.querySelector("#liste-trajets").insertAdjacentHTML("beforeend", carteTrajetHtml(index));
  const carte = document.querySelector(`[data-trajet="${index}"]`);
  const conteneurZone = carte.querySelector(".selecteur-zone-arrivee");
  conteneurZone.innerHTML = construireSelecteurZoneHtml(`zone-arrivee-${index}`, "zone-arrivee");
  brancherSelecteurZone(conteneurZone, zones);
  carte.querySelector("[data-retirer-trajet]").addEventListener("click", () => {
    delete prixParTrajet[index];
    carte.remove();
    majTotalEtape1();
  });
}

async function estimerTousLesTrajets() {
  const zoneDepart = document.querySelector("#zone-depart").value;
  const cartes = [...document.querySelectorAll("#liste-trajets [data-trajet]")];
  if (!zoneDepart) return; // silencieux : se declenche automatiquement, pas la peine d'interrompre avant que tout soit choisi
  effacerErreur();
  for (const carte of cartes) {
    const index = carte.dataset.trajet;
    const zoneArrivee = carte.querySelector(".zone-arrivee").value;
    const prixEl = carte.querySelector("[data-prix-trajet]");
    if (!zoneArrivee) { prixEl.hidden = true; continue; }
    const montant = await estimerTarif(supabase, codeEntreprise, zoneDepart, zoneArrivee);
    if (montant == null) { prixEl.hidden = true; delete prixParTrajet[index]; continue; }
    prixParTrajet[index] = montant;
    prixEl.textContent = `≈ ${new Intl.NumberFormat("fr-FR").format(montant)} FCFA`;
    prixEl.hidden = false;
  }
  majTotalEtape1();
}

function majTotalEtape1() {
  const valeurs = Object.values(prixParTrajet);
  const totalEl = document.querySelector("#prix-total");
  const btnContinuer = document.querySelector("#btn-etape1-continuer");
  if (!valeurs.length) { totalEl.hidden = true; btnContinuer.disabled = true; return; }
  const total = valeurs.reduce((s, m) => s + m, 0);
  totalEl.textContent = valeurs.length > 1
    ? `Total estimé pour ${valeurs.length} colis : ${new Intl.NumberFormat("fr-FR").format(total)} FCFA`
    : `Prix estimé : ${new Intl.NumberFormat("fr-FR").format(total)} FCFA`;
  totalEl.hidden = false;
  btnContinuer.disabled = false;
}

function initialiserEtape1() {
  document.querySelector("#btn-ajouter-trajet").addEventListener("click", ajouterTrajet);
  // Calcul automatique dès qu'une zone change — plus besoin de cliquer sur
  // un bouton "Estimer". Délégation sur les conteneurs parents : couvre
  // aussi bien la zone de départ que chaque zone d'arrivée, y compris
  // celles ajoutées dynamiquement par "+ Colis supplémentaire".
  document.querySelector("#zone-depart").addEventListener("change", estimerTousLesTrajets);
  // Le destinataire est re-vérifié automatiquement à chaque passage à
  // l'étape 3 (construireEtape3() reconstruit tout à neuf) -- l'expéditeur
  // n'a pas cet avantage puisque son formulaire n'est construit qu'une
  // fois. Sans ce second écouteur, changer la zone de départ après avoir
  // déjà capturé une position ne relance jamais la comparaison : l'alerte
  // (ou son absence) reste figée sur le premier choix de zone.
  document.querySelector("#zone-depart").addEventListener("change", () => recalculerAlerteZoneExpediteur());
  document.querySelector("#liste-trajets").addEventListener("change", (e) => {
    if (e.target.classList.contains("zone-arrivee")) estimerTousLesTrajets();
  });
  document.querySelector("#btn-etape1-continuer").addEventListener("click", () => {
    construireEtape3();
    allerEtape(2);
  });
}

// ----------------------------------------------------------------------------
// Étape 2 : expéditeur — pré-rempli si un compte est connecté, sinon champs
// vides + proposition de connexion/inscription en ligne (jamais un passage
// obligé).
// ----------------------------------------------------------------------------

// Point d'entrée UNIQUE de la comparaison zone/GPS côté expéditeur -- relit
// l'état courant (gpsExpediteur, #zone-depart) à chaque appel plutôt que de
// dépendre de ce qui a été capturé au moment précis de l'appel. Avant, la
// comparaison était appelée séparément depuis 4 endroits différents avec des
// valeurs capturées à des moments différents -- un ordre d'événements un peu
// inhabituel (adresse déjà connue + géoloc silencieuse, ou texte tapé puis
// suggestion choisie après coup) pouvait laisser l'alerte sur un état
// périmé. Un seul point d'entrée, toujours relu à froid, élimine la classe
// de bug plutôt qu'un cas précis.
function recalculerAlerteZoneExpediteur() {
  avertirSiZoneIncoherente(gpsExpediteur, document.querySelector("#zone-depart").value, document.querySelector("#avertissement-zone-exp"));
}

let geolocDejaDeclenchee = false;
function declencherGeolocSiBesoin() {
  if (geolocDejaDeclenchee) return;
  geolocDejaDeclenchee = true;
  const champAdresseExp = document.querySelector("#exp-adresse");
  if (champAdresseExp.value.trim()) {
    // Adresse déjà connue (compte connecté ou mémoire) : on ne l'écrase
    // JAMAIS, mais on vérifie quand même en silence qu'elle correspond
    // toujours à la zone de départ choisie -- sinon un compte enregistré
    // échappe entièrement au contrôle, quelle que soit la zone choisie.
    localiserSilencieusement((gps) => {
      gpsExpediteur = gps;
      recalculerAlerteZoneExpediteur();
    });
    return;
  }
  localiserMoi(document.querySelector("#btn-ma-position"), champAdresseExp, (gps) => {
    gpsExpediteur = gps;
    recalculerAlerteZoneExpediteur();
  });
}

async function chargerCompteConnecte() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data } = await supabase
    .from("clients_pro")
    .select("id_client, nom, telephone, adresse, facturation_activee")
    .eq("id_auth", session.user.id)
    .maybeSingle();
  return data || null;
}

function afficherBandeauConnecte() {
  const bandeau = document.querySelector("#bandeau-compte-connecte");
  if (!compteConnecte) { bandeau.hidden = true; return; }
  bandeau.hidden = false;
  bandeau.className = "bandeau-compte";
  bandeau.innerHTML = `
    <span>Connecté comme <strong>${escapeHtml(compteConnecte.nom)}</strong></span>
    <button type="button" id="btn-deconnexion-inline">Pas moi / se déconnecter</button>`;
  bandeau.querySelector("#btn-deconnexion-inline").addEventListener("click", async () => {
    await supabase.auth.signOut();
    compteConnecte = null;
    document.querySelector("#exp-nom").value = "";
    document.querySelector("#exp-tel").value = "";
    document.querySelector("#exp-adresse").value = "";
    afficherBandeauConnecte();
    afficherPropositionCompte();
  });
}

function afficherPropositionCompte() {
  const zone = document.querySelector("#proposition-compte");
  if (compteConnecte) { zone.innerHTML = ""; return; }
  zone.innerHTML = `
    <div class="proposition-compte-carte">
      <p>Un compte pour ne plus jamais retaper tes informations ?</p>
      <button type="button" class="lien-connexion-inline" id="btn-ouvrir-connexion">J'ai déjà un compte — me connecter</button>
      <span style="color:var(--sur-sombre-doux);margin:0 6px;">·</span>
      <button type="button" class="lien-connexion-inline" id="btn-ouvrir-inscription">Créer un compte</button>
      <div id="zone-formulaire-compte"></div>
    </div>`;
  zone.querySelector("#btn-ouvrir-connexion").addEventListener("click", () => afficherFormulaireConnexion());
  zone.querySelector("#btn-ouvrir-inscription").addEventListener("click", () => afficherFormulaireInscription());
}

function afficherFormulaireConnexion() {
  const zone = document.querySelector("#zone-formulaire-compte");
  zone.innerHTML = `
    <div class="champ-pub" style="margin-top:12px;"><label>Téléphone</label><input id="conn-tel" type="tel" inputmode="numeric" placeholder="07 00 00 00 00" maxlength="14"></div>
    <div class="champ-pub"><label>Mot de passe</label><input id="conn-mdp" type="password"></div>
    <button type="button" class="btn-pub btn-pub-primaire" id="btn-conn-valider" style="margin-top:4px;">Se connecter</button>`;
  zone.querySelector("#btn-conn-valider").addEventListener("click", async (e) => {
    const tel = validerTelephone(document.querySelector("#conn-tel").value);
    if (!tel.valide) { afficherErreurCompte(tel.message); return; }
    e.currentTarget.disabled = true; e.currentTarget.textContent = "Connexion…";
    const { error } = await supabase.auth.signInWithPassword({
      email: emailSynthetique(codeEntreprise, tel.normalise),
      password: document.querySelector("#conn-mdp").value
    });
    if (error) {
      afficherErreurCompte(traduireErreurAuth(error.message));
      e.currentTarget.disabled = false; e.currentTarget.textContent = "Se connecter";
      return;
    }
    compteConnecte = await chargerCompteConnecte();
    appliquerCompteAuxChamps();
    afficherBandeauConnecte();
    afficherPropositionCompte();
  });
}

function afficherFormulaireInscription() {
  const zone = document.querySelector("#zone-formulaire-compte");
  const nomActuel = document.querySelector("#exp-nom").value.trim();
  const telActuel = document.querySelector("#exp-tel").value.trim();
  zone.innerHTML = `
    <div class="champ-pub" style="margin-top:12px;"><label>Nom</label><input id="insc-nom" value="${escapeHtml(nomActuel)}"></div>
    <div class="champ-pub"><label>Téléphone</label><input id="insc-tel" type="tel" inputmode="numeric" value="${escapeHtml(telActuel)}" placeholder="07 00 00 00 00" maxlength="14"></div>
    <div class="champ-pub"><label>Mot de passe</label><input id="insc-mdp" type="password" placeholder="8 caractères minimum"></div>
    <button type="button" class="btn-pub btn-pub-primaire" id="btn-insc-valider" style="margin-top:4px;">Créer mon compte</button>`;
  zone.querySelector("#btn-insc-valider").addEventListener("click", async (e) => {
    const nom = document.querySelector("#insc-nom").value.trim();
    const tel = validerTelephone(document.querySelector("#insc-tel").value);
    const mdp = document.querySelector("#insc-mdp").value;
    if (!nom) { afficherErreurCompte("Indique ton nom."); return; }
    if (!tel.valide) { afficherErreurCompte(tel.message); return; }
    if (mdp.length < 8) { afficherErreurCompte("Le mot de passe doit contenir au moins 8 caractères."); return; }
    e.currentTarget.disabled = true; e.currentTarget.textContent = "Création…";
    const { data, error } = await supabase.functions.invoke("inscrire-client-pro", {
      body: { code_entreprise: codeEntreprise, nom, telephone: tel.normalise, password: mdp,
              adresse: document.querySelector("#exp-adresse").value.trim() || null }
    });
    if (error || data?.error) {
      afficherErreurCompte(data?.error || traduireErreurAuth(error?.message) || "Compte non créé.");
      e.currentTarget.disabled = false; e.currentTarget.textContent = "Créer mon compte";
      return;
    }
    await supabase.auth.signInWithPassword({ email: emailSynthetique(codeEntreprise, tel.normalise), password: mdp });
    compteConnecte = await chargerCompteConnecte();
    appliquerCompteAuxChamps();
    afficherBandeauConnecte();
    afficherPropositionCompte();
  });
}

function afficherErreurCompte(message) {
  afficherErreurToast(message);
}

function appliquerCompteAuxChamps() {
  if (!compteConnecte) return;
  document.querySelector("#exp-nom").value = compteConnecte.nom || "";
  document.querySelector("#exp-tel").value = formaterTelephoneAffichage(compteConnecte.telephone || "");
  if (compteConnecte.adresse) document.querySelector("#exp-adresse").value = compteConnecte.adresse;
}

function initialiserEtape2() {
  brancherValidationDirecte(document.querySelector("#exp-tel"));
  const champAdresseExp = document.querySelector("#exp-adresse");
  const suggestionsExp = document.querySelector("#suggestions-exp");
  brancherAutocompletion(champAdresseExp, suggestionsExp, (gps) => {
    gpsExpediteur = gps;
    recalculerAlerteZoneExpediteur();
  });
  document.querySelector("#btn-ma-position").addEventListener("click", (e) => {
    localiserMoi(e.currentTarget, champAdresseExp, (gps) => {
      gpsExpediteur = gps;
      recalculerAlerteZoneExpediteur();
    });
  });
  document.querySelector('[data-retour="1"]').addEventListener("click", () => allerEtape(1));
  document.querySelector("#btn-etape2-continuer").addEventListener("click", () => {
    const r = validerExpediteur(document.querySelector("#exp-nom"), document.querySelector("#exp-tel"));
    if (!r.ok) return;
    const avertissementExp = document.querySelector("#avertissement-zone-exp");
    if (!alerteZoneEstConfirmee(avertissementExp)) {
      afficherErreurToast("La zone de départ semble ne pas correspondre à ton adresse. Coche la case pour confirmer, ou corrige la zone.");
      avertissementExp.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    allerEtape(3);
  });
}

// ----------------------------------------------------------------------------
// Étape 3 : un bloc destinataire par trajet choisi à l'étape 1 — la zone est
// déjà connue, plus besoin de la redemander ni de la deviner.
// ----------------------------------------------------------------------------
function carteDestinataireHtml(index, libelleZone) {
  return `
    <div class="carte-colis-pub" data-destinataire="${index}">
      <p style="font-size:12px;color:var(--peche);font-weight:700;margin:0 0 10px;">Vers ${escapeHtml(libelleZone)}</p>
      <div class="champ-pub"><label>Nom du destinataire</label><input class="dest-nom" required placeholder="Nom complet"></div>
      <div class="champ-pub"><label>Téléphone du destinataire</label><input class="dest-tel" type="tel" inputmode="numeric" required placeholder="07 00 00 00 00" maxlength="14"></div>
      <div class="champ-pub champ-adresse-pub">
        <label>Adresse <span class="mention-optionnelle">(utile, pas obligatoire)</span></label>
        <input class="dest-adresse" placeholder="Quartier, repère" autocomplete="off">
        <div class="liste-suggestions" hidden></div>
        <div class="avertissement-zone avertissement-zone-dest" hidden></div>
      </div>
    </div>`;
}

function construireEtape3() {
  const zoneDepart = document.querySelector("#zone-depart").value;
  const conteneur = document.querySelector("#liste-destinataires");
  conteneur.innerHTML = "";
  const indexTrajets = Object.keys(prixParTrajet);
  indexTrajets.forEach((idx) => {
    const zoneArrivee = document.querySelector(`#zone-arrivee-${idx}`)?.value
      || document.querySelector(`[data-trajet="${idx}"] .zone-arrivee`)?.value;
    const libelle = zones.find((z) => z.code_zone === zoneArrivee)?.secteur || zoneArrivee;
    conteneur.insertAdjacentHTML("beforeend", carteDestinataireHtml(idx, libelle));
    const carte = conteneur.lastElementChild;
    carte.dataset.zone = zoneArrivee;
    brancherValidationDirecte(carte.querySelector(".dest-tel"));
    const champAdresse = carte.querySelector(".dest-adresse");
    const suggestions = carte.querySelector(".liste-suggestions");
    const avertissement = carte.querySelector(".avertissement-zone-dest");
    brancherAutocompletion(champAdresse, suggestions, (gps) => {
      avertirSiZoneIncoherente(gps, zoneArrivee, avertissement);
    });
  });
}

function initialiserEtape3() {
  document.querySelector('[data-retour="2"]').addEventListener("click", () => allerEtape(2));
  document.querySelector("#btn-etape3-continuer").addEventListener("click", () => {
    const cartes = [...document.querySelectorAll("#liste-destinataires [data-destinataire]")];
    for (const carte of cartes) {
      const r = validerDestinataire(carte.querySelector(".dest-nom"), carte.querySelector(".dest-tel"), "du destinataire");
      if (!r.ok) return;
    }
    for (const carte of cartes) {
      const avertissement = carte.querySelector(".avertissement-zone-dest");
      if (!alerteZoneEstConfirmee(avertissement)) {
        afficherErreurToast("L'adresse d'un destinataire semble ne pas correspondre à sa zone. Coche la case pour confirmer, ou corrige l'adresse.");
        avertissement.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    majEtape4();
    allerEtape(4);
  });
}

// ----------------------------------------------------------------------------
// Étape 4 : paiement + envoi.
// ----------------------------------------------------------------------------
function majEtape4() {
  const total = Object.values(prixParTrajet).reduce((s, m) => s + m, 0);
  document.querySelector("#prix-total-final").textContent = `Total : ${new Intl.NumberFormat("fr-FR").format(total)} FCFA`;

  const selectPaiement = document.querySelector("#mode-paiement");
  const optionFacturation = selectPaiement.querySelector('option[value="SANS_PAIEMENT"]');
  if (compteConnecte?.facturation_activee && !optionFacturation) {
    selectPaiement.insertAdjacentHTML("afterbegin", `<option value="SANS_PAIEMENT">Facturation (débité de mon compte)</option>`);
  } else if (!compteConnecte?.facturation_activee && optionFacturation) {
    optionFacturation.remove();
  }
}

function initialiserEtape4() {
  document.querySelector('[data-retour="3"]').addEventListener("click", () => allerEtape(3));
}

// ----------------------------------------------------------------------------
// Confirmation
// ----------------------------------------------------------------------------
function rendreConfirmation(resultat) {
  const premiere = resultat[0];
  const total = resultat.reduce((s, l) => s + Number(l.montant_livraison || 0), 0);
  document.querySelector('.etape[data-etape="4"] .chapitre-form').style.display = "none";
  const conteneur = document.querySelector("#confirmation-contenu");
  conteneur.innerHTML = `
    <div class="recap-code">
      <div class="label">Code à donner au livreur au ramassage</div>
      <div class="code">${escapeHtml(premiere.code_ramassage)}</div>
    </div>
    <div class="bloc-recap">
      <h3>Votre position (à partager si besoin)</h3>
      <div class="ligne-lien">
        <span>Lien de position</span>
        <button class="btn-pub btn-pub-secondaire" style="width:auto;min-height:36px;padding:0 14px;" data-partager="${urlSuivi(premiere.token_expediteur)}" data-texte="Voici ma position pour le ramassage de mon colis">Partager</button>
      </div>
    </div>
    <div class="bloc-recap">
      <h3>${resultat.length > 1 ? `${resultat.length} colis créés` : "Colis créé"} · ${new Intl.NumberFormat("fr-FR").format(total)} FCFA</h3>
      ${resultat.map((l, i) => `
        <div class="ligne-lien">
          <span>Colis ${i + 1} · code ${escapeHtml(l.code_livraison)} · ${new Intl.NumberFormat("fr-FR").format(l.montant_livraison || 0)} FCFA</span>
          <button class="btn-pub btn-pub-secondaire" style="width:auto;min-height:36px;padding:0 14px;" data-partager="${urlSuivi(l.token_destinataire)}" data-texte="Voici le lien pour partager votre position au livreur">Lien destinataire</button>
        </div>`).join("")}
    </div>
    <p style="font-size:12.5px;color:var(--sur-sombre-doux);text-align:center;margin-top:8px;">Envoyez le lien "destinataire" par WhatsApp à chaque personne.</p>
    ${!compteConnecte ? `
      <div class="proposition-compte-carte">
        <p>Envie de ne plus jamais retaper tes informations la prochaine fois ?</p>
        <button type="button" class="btn-pub btn-pub-secondaire" id="btn-creer-compte-apres">Créer un compte</button>
      </div>` : ""}
    <button class="btn-pub btn-pub-discret" id="btn-nouvelle-commande" style="margin-top:16px;">Envoyer un autre colis</button>
  `;
  conteneur.querySelectorAll("[data-partager]").forEach((b) => {
    b.addEventListener("click", () => partager(b.dataset.texte, b.dataset.partager, b));
  });
  conteneur.querySelector("#btn-nouvelle-commande").addEventListener("click", () => window.location.reload());
  conteneur.querySelector("#btn-creer-compte-apres")?.addEventListener("click", () => {
    allerEtape(2);
    document.querySelector('.etape[data-etape="4"] .chapitre-form').style.display = "";
    conteneur.innerHTML = "";
    afficherFormulaireInscription();
    document.querySelector("#proposition-compte").scrollIntoView({ behavior: "smooth" });
  });
  conteneur.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ----------------------------------------------------------------------------
// Démarrage
// ----------------------------------------------------------------------------
async function demarrer() {
  if (!codeEntreprise) {
    document.querySelector("#form-expedition").innerHTML = `<div class="message-erreur-pub visible" style="margin-top:40vh;">Lien invalide : le code de l'entreprise est manquant.</div>`;
    return;
  }
  appliquerAccroches();

  const { data, error } = await supabase.rpc("rpc_lister_zones_publiques", { p_code_entreprise: codeEntreprise });
  zones = error ? [] : (data || []);
  peuplerSelectsZones();

  compteConnecte = await chargerCompteConnecte();
  appliquerCompteAuxChamps();
  afficherBandeauConnecte();
  afficherPropositionCompte();

  document.querySelector("#btn-fermer-erreur").addEventListener("click", effacerErreur);

  initialiserEtape1();
  initialiserEtape2();
  initialiserEtape3();
  initialiserEtape4();

  document.querySelector("#form-expedition").addEventListener("submit", async (e) => {
    e.preventDefault();
    const bouton = document.querySelector("#btn-envoyer");
    if (bouton.disabled) return;
    bouton.disabled = true;
    effacerErreur();

    const cartes = [...document.querySelectorAll("#liste-destinataires [data-destinataire]")];
    const colis = cartes.map((carte) => ({
      destinataire_nom: carte.querySelector(".dest-nom").value.trim(),
      destinataire_tel: validerTelephone(carte.querySelector(".dest-tel").value).normalise,
      destinataire_adresse: carte.querySelector(".dest-adresse").value.trim(),
      code_zone: carte.dataset.zone,
      alerte_zone: carte.querySelector(".avertissement-zone-dest")?.dataset.alerteTexte || null
    }));

    bouton.textContent = "Création de votre commande…";

    const resultat = await soumettreCommande(supabase, {
      codeEntreprise,
      expediteur: {
        nom: document.querySelector("#exp-nom").value.trim(),
        tel: validerTelephone(document.querySelector("#exp-tel").value).normalise,
        adresse: document.querySelector("#exp-adresse").value.trim()
      },
      gpsExpediteur,
      modePaiement: document.querySelector("#mode-paiement").value,
      colis,
      zoneDepart: document.querySelector("#zone-depart").value,
      canal: compteConnecte ? "CLIENT_PRO" : "DIRECT",
      alerteZoneExpediteur: document.querySelector("#avertissement-zone-exp")?.dataset.alerteTexte || null
    });

    if (!resultat.ok) {
      afficherErreurCompte(resultat.message);
      bouton.disabled = false; bouton.textContent = "Envoyer le colis";
      return;
    }

    rendreConfirmation(resultat.resultat);
  });
}

document.addEventListener("focus", (e) => {
  if (e.target.matches("#exp-adresse, .dest-adresse")) e.target.select();
}, true);

demarrer();
