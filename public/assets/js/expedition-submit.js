// ============================================================================
// expedition-submit.js
// Responsabilité : conserver la création actuelle dans Supabase, empêcher
// les doubles soumissions, afficher l'état de chargement, gérer les erreurs,
// afficher le numéro de commande après succès.
//
// L'appel rpc_creer_commande et ses paramètres sont IDENTIQUES à l'ancien
// expediteur.js — aucun nom de colonne, aucune règle multi-tenant, aucune
// logique RLS touchée ici.
// ============================================================================

let soumissionEnCours = false;

export async function soumettreCommande(supabase, { codeEntreprise, expediteur, gpsExpediteur, modePaiement, colis, zoneDepart, canal = "DIRECT", alerteZoneExpediteur = null }) {
  if (soumissionEnCours) return { ok: false, message: "Envoi déjà en cours." };
  soumissionEnCours = true;
  try {
    const { data: resultat, error } = await supabase.rpc("rpc_creer_commande", {
      p_code_entreprise: codeEntreprise,
      p_expediteur_nom: expediteur.nom,
      p_expediteur_tel: expediteur.tel,
      p_expediteur_adresse: expediteur.adresse || null,
      p_gps_expediteur: gpsExpediteur,
      p_mode_paiement: modePaiement,
      p_colis: colis,
      p_canal: canal,
      p_zone_depart: zoneDepart,
      p_id_client_pro: null,
      p_alerte_zone_expediteur: alerteZoneExpediteur
    });

    if (error || !resultat?.length) {
      return { ok: false, message: error?.message || "Une erreur est survenue. Réessaie." };
    }

    // Notification "à froid" : jamais bloquante et jamais fatale — un souci
    // de SMS ne doit jamais empêcher d'afficher le récapitulatif de commande.
    supabase.functions.invoke("notifier-sms", {
      body: { evenement: "COMMANDE_CREEE", id_commande: resultat[0].id_commande }
    }).catch(() => {});

    return { ok: true, resultat };
  } finally {
    soumissionEnCours = false;
  }
}

export function urlSuivi(token) {
  const base = window.APP_CONFIG?.APP_BASE_URL || window.location.origin;
  return `${base}${window.location.pathname.replace(/[^/]*$/, "")}suivi.html?token=${token}`;
}

// Partage direct (feuille de partage native : WhatsApp, SMS, etc.) plutôt
// qu'un simple copier-coller — beaucoup plus rapide sur mobile. On retombe
// sur le presse-papiers uniquement si le navigateur ne sait pas partager
// (essentiellement le web desktop).
export async function partager(texte, url, bouton) {
  const texteComplet = `${texte} ${url}`;
  if (navigator.share) {
    try { await navigator.share({ text: texte, url }); return; } catch { return; }
  }
  try {
    await navigator.clipboard.writeText(texteComplet);
    const original = bouton.textContent;
    bouton.textContent = "Copié";
    setTimeout(() => { bouton.textContent = original; }, 1800);
  } catch { /* silencieux : le lien reste affichable manuellement */ }
}
