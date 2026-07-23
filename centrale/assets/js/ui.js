export function formaterFcfa(montant) {
  return new Intl.NumberFormat("fr-FR").format(Math.round(Number(montant) || 0));
}

export function escapeHtml(texte) {
  const div = document.createElement("div");
  div.textContent = String(texte ?? "");
  return div.innerHTML;
}

export function afficherFlash(texte, estErreur = false) {
  const el = document.createElement("div");
  el.className = "message-flash";
  if (estErreur) el.style.background = "var(--alerte)";
  el.textContent = texte;
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

export async function copierTexte(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    afficherFlash("Copié dans le presse-papiers");
    return true;
  } catch {
    afficherFlash("Impossible de copier automatiquement", true);
    return false;
  }
}

export function fermerModale() {
  document.querySelector(".voile")?.remove();
}

export function ouvrirModale(contenuHtml, apresMontage) {
  fermerModale();
  const voile = document.createElement("div");
  voile.className = "voile";
  voile.innerHTML = `<div class="boite-modale">${contenuHtml}</div>`;
  voile.addEventListener("click", (e) => { if (e.target === voile) fermerModale(); });
  document.body.append(voile);
  apresMontage?.(voile.querySelector(".boite-modale"), voile);
  return voile;
}

// Statuts -> classe de tampon + libellé français, factorisé une fois pour tout l'espace.
const LIBELLES_STATUT = {
  CREE: ["neutre", "Créée"],
  A_RAMASSER: ["attente", "À ramasser"],
  RAMASSE: ["ramasse", "Ramassé"],
  DEPOT_DEMANDE: ["ramasse", "Dépôt demandé"],
  AU_HUB: ["transit", "Au hub"],
  EN_LOT: ["transit", "En lot"],
  RECUP_DEMANDEE: ["ramasse", "Récup. demandée"],
  EN_TOURNEE: ["transit", "En tournée"],
  LIVRE: ["valide", "Livré"],
  RETOUR_EN_COURS: ["alerte", "Retour en cours"],
  RETOUR_DEMANDE: ["alerte", "Retour demandé"],
  A_RETOURNER: ["alerte", "À retourner"],
  RETOUR_ASSIGNE: ["alerte", "Retour assigné"],
  RETOUR_RECUP_DEMANDEE: ["alerte", "Récup. retour demandée"],
  EN_RETOUR: ["alerte", "En retour"],
  RETOURNE: ["neutre", "Retourné"],
  ANNULE: ["neutre", "Annulé"],
  EN_ATTENTE: ["attente", "En attente"],
  RAMASSAGE_EN_COURS: ["ramasse", "Ramassage en cours"],
  RAMASSEE: ["transit", "Ramassée"],
  EN_TRAITEMENT: ["attente", "En traitement"],
  TERMINEE: ["valide", "Terminée"],
  PREPARE: ["neutre", "Préparé"],
  RECUPERATION: ["ramasse", "Récupération"],
  TERMINE: ["valide", "Terminé"]
};

export function tampon(statut) {
  const [classe, libelle] = LIBELLES_STATUT[statut] || ["neutre", statut];
  return `<span class="tampon ${classe}">${libelle}</span>`;
}

// Petit badge d'avertissement, réutilisé partout où une alerte de zone
// (calculée côté formulaire public, voir alerte_zone / alerte_zone_expediteur)
// doit rester visible côté hub -- jamais bloquant ici non plus, juste un
// signal à vérifier avant d'assigner. Le texte complet reste dans le title
// (survol/appui long) pour ne pas alourdir des tableaux déjà denses.
export function alerteZone(texte) {
  if (!texte) return "";
  return `<span class="alerte-zone-badge" title="${escapeHtml(texte)}">⚠️ Zone à vérifier</span>`;
}

export function libelleMotif(code) {
  const motifs = {
    DESTINATAIRE_ABSENT: "Destinataire absent", INJOIGNABLE: "Injoignable",
    ADRESSE_INTROUVABLE: "Adresse introuvable", ANNULATION_CLIENT: "Annulé par le client",
    REFUS_COLIS: "Refus du colis", AUTRE: "Autre motif"
  };
  return motifs[code] || code || "";
}
