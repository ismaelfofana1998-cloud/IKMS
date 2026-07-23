import { getSupabaseClient } from "./supabase-client.js";

const sb = () => getSupabaseClient();

// ---------------------------------------------------------------------------
// Commandes / flux
// ---------------------------------------------------------------------------

export async function creerNotification(idUtilisateur, idHub, type, message, lien) {
  const { error } = await sb().rpc("rpc_creer_notification", {
    p_id_utilisateur: idUtilisateur || null, p_id_hub: idHub || null, p_type: type, p_message: message, p_lien: lien || null
  });
  return { ok: !error, message: error?.message };
}

export async function listerMesNotifications() {
  const { data, error } = await sb().rpc("rpc_lister_mes_notifications");
  if (error) throw error;
  return data || [];
}

export async function compterNotificationsNonLues() {
  const { data, error } = await sb().rpc("rpc_compter_notifications_non_lues");
  if (error) return 0;
  return data || 0;
}

export async function marquerNotificationLue(id) {
  await sb().rpc("rpc_marquer_notification_lue", { p_id: id });
}

export async function marquerToutesNotificationsLues() {
  await sb().rpc("rpc_marquer_toutes_notifications_lues");
}

export async function lireCodeEntreprise(idEntreprise) {
  const { data, error } = await sb().from("entreprises").select("code_entreprise").eq("id_entreprise", idEntreprise).maybeSingle();
  if (error) throw error;
  return data?.code_entreprise;
}

export async function lireEtatPaiementWave() {
  const { data, error } = await sb().rpc("rpc_etat_paiement_wave");
  if (error) throw error;
  return data?.[0] || { configure: false, jeton_webhook: null };
}

// Passe par une fonction Edge (jamais un insert direct) : c'est elle qui
// chiffre les clés avant stockage et ne les renvoie plus jamais ensuite.
export async function configurerPaiementWave(apiKey, signingSecret) {
  const { data, error } = await sb().functions.invoke("configurer-paiement-wave", {
    body: { api_key: apiKey, signing_secret: signingSecret }
  });
  if (error || data?.error) return { ok: false, message: await extraireErreurFonction(error, data) };
  return { ok: true, urlWebhook: data.data.url_webhook };
}


export async function lireMonEssai() {
  const { data, error } = await sb().rpc("rpc_mon_essai");
  if (error) throw error;
  return data?.[0] || null;
}

export async function creerCommande({ expediteurNom, expediteurTel, expediteurAdresse, modePaiement, colis, codeEntreprise, acteur, zoneDepart, idClientPro }) {
  const { data, error } = await sb().rpc("rpc_creer_commande", {
    p_code_entreprise: codeEntreprise,
    p_expediteur_nom: expediteurNom,
    p_expediteur_tel: expediteurTel,
    p_expediteur_adresse: expediteurAdresse || null,
    p_gps_expediteur: null,
    p_mode_paiement: modePaiement,
    p_colis: colis,
    p_canal: "INTERNE",
    p_acteur: acteur,
    p_zone_depart: zoneDepart || null,
    p_id_client_pro: idClientPro || null
  });
  return { data, error };
}

export async function estimerTarif(codeEntreprise, zoneDepart, zoneArrivee) {
  if (!zoneDepart || !zoneArrivee) return null;
  const { data, error } = await sb().rpc("rpc_estimer_tarif", {
    p_code_entreprise: codeEntreprise,
    p_zone_depart: zoneDepart,
    p_zone_arrivee: zoneArrivee
  });
  return error ? null : data;
}

// ---------------------------------------------------------------------------
// Clients pro (comptes clients de l'entreprise cliente du SaaS — ex. une
// boutique qui expédie régulièrement via IKIGAI Livraison — à distinguer des
// entreprises clientes du SaaS lui-même, gérées dans plateforme.js).
// ---------------------------------------------------------------------------
export async function listerClientsPro() {
  const { data, error } = await sb()
    .from("clients_pro")
    .select("id_client, nom, telephone, email, adresse, solde_portefeuille, actif, cree_le, facturation_activee")
    .order("nom", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function definirFacturationClientPro(idClient, actif) {
  const { error } = await sb().rpc("rpc_definir_facturation_client_pro", { p_id_client: idClient, p_active: actif });
  return { ok: !error, message: error?.message };
}

// Ancienne fonction : crée seulement l'enregistrement métier, SANS compte
// de connexion. Gardée pour compatibilité mais plus utilisée par le
// panneau — voir creerClientProAvecCompte, qui corrige exactement ce
// problème (signalé : impossible de se connecter après une création interne).
export async function creerClientPro({ nom, telephone, email, adresse }, idEntreprise) {
  const { error } = await sb().from("clients_pro").insert({
    id_entreprise: idEntreprise, nom, telephone, email: email || null, adresse: adresse || null
  });
  return { ok: !error, message: error?.message };
}

// Crée le client pro AVEC un vrai compte de connexion (même mécanisme que
// l'auto-inscription) — un mot de passe est généré et renvoyé une seule
// fois, à transmettre au client (voir le popup de partage dans clients-pro.js).
export async function creerClientProAvecCompte({ nom, telephone, email, adresse }) {
  const { data, error } = await sb().functions.invoke("creer-client-pro-interne", {
    body: { nom, telephone, email, adresse }
  });
  if (error || data?.error) return { ok: false, message: await extraireErreurFonction(error, data) };
  return { ok: true, ...data.data };
}

export async function desactiverClientPro(idClient) {
  const { error } = await sb().from("clients_pro").update({ actif: false }).eq("id_client", idClient);
  return { ok: !error, message: error?.message };
}

export async function reactiverClientPro(idClient) {
  const { error } = await sb().from("clients_pro").update({ actif: true }).eq("id_client", idClient);
  return { ok: !error, message: error?.message };
}

export async function crediterClient(idClient, montant, note) {
  const { error } = await sb().rpc("rpc_crediter_client", { p_id_client: idClient, p_montant: montant, p_note: note || null });
  return { ok: !error, message: error?.message };
}

export async function listerMouvementsClient(idClient) {
  const { data, error } = await sb()
    .from("mouvements_portefeuille")
    .select("id, type, montant, id_commande, note, cree_le")
    .eq("id_client", idClient)
    .order("cree_le", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Notification "à froid" (fire-and-forget) : un souci d'envoi de SMS ne doit
// jamais faire échouer l'action métier qui l'a déclenché.
export function notifier(evenement, { idCommande, idColis } = {}) {
  sb().functions.invoke("notifier-sms", {
    body: { evenement, id_commande: idCommande, id_colis: idColis }
  }).catch(() => {});
}

// Compteurs pour les bulles de notification sur les onglets — une requête
// "count exact, head:true" par catégorie (ne récupère aucune ligne, juste
// le nombre), largement plus léger que de recharger les listes complètes.
export async function compterActionsEnAttente(idHubAgent = null) {
  // Ramassage compte des COMMANDES (une commande peut regrouper plusieurs
  // colis pour plusieurs destinataires) -- jamais des colis, sinon la bulle
  // ne correspond plus au nombre de lignes affichées dans l'onglet.
  let requeteRamassage = sb().from("colis").select("id_commande, commandes!inner(id_hub_prevu)").in("statut", ["CREE", "A_RAMASSER"]);
  let requeteReception = sb().from("colis").select("id_colis", { count: "exact", head: true }).in("statut", ["DEPOT_DEMANDE", "RETOUR_DEMANDE"]);
  let requeteRetoursRecus = sb().from("colis").select("id_colis", { count: "exact", head: true }).eq("statut", "RETOUR_RECU");
  let requeteRetoursAAssigner = sb().from("colis").select("id_colis", { count: "exact", head: true }).eq("statut", "A_RETOURNER");
  let requeteLots = sb().from("colis").select("id_colis", { count: "exact", head: true }).eq("statut", "AU_HUB");

  // Un agent rattaché à un hub ne compte que ce qu'il peut réellement
  // traiter — sinon la bulle affiche un nombre qui ne correspond à rien
  // d'actionnable pour lui (signalé : "les bulles ne comptent pas
  // réellement le nombre d'actions en attente").
  if (idHubAgent) {
    requeteRamassage = requeteRamassage.eq("commandes.id_hub_prevu", idHubAgent);
    requeteReception = requeteReception.eq("id_hub_reel", idHubAgent);
    requeteRetoursRecus = requeteRetoursRecus.eq("id_hub_reel", idHubAgent);
    requeteRetoursAAssigner = requeteRetoursAAssigner.eq("id_hub_reel", idHubAgent);
    requeteLots = requeteLots.eq("id_hub_reel", idHubAgent);
  }

  const [ramassage, reception, retoursRecus, retoursAAssigner, lots] = await Promise.all([
    requeteRamassage, requeteReception, requeteRetoursRecus, requeteRetoursAAssigner, requeteLots
  ]);
  const nbCommandesRamassage = new Set((ramassage.data || []).map((c) => c.id_commande)).size;
  return {
    ramassage: nbCommandesRamassage,
    reception: reception.count || 0,
    lots: lots.count || 0,
    retours: (retoursRecus.count || 0) + (retoursAAssigner.count || 0)
  };
}

export async function listerCommandesEnRamassage(idHubAgent = null) {
  const { data: colisEnCours, error: err1 } = await sb()
    .from("colis")
    .select("id_commande")
    .in("statut", ["CREE", "A_RAMASSER"]);
  if (err1) throw err1;
  const idsCommande = [...new Set((colisEnCours || []).map((c) => c.id_commande))];
  if (!idsCommande.length) return [];

  let requete = sb()
    .from("commandes")
    .select("id_commande, expediteur_nom, expediteur_tel, expediteur_adresse, code_ramassage, id_livreur_ramassage, cree_le, id_hub_prevu, alerte_zone_expediteur, hubs(nom)")
    .in("id_commande", idsCommande)
    .order("cree_le", { ascending: true });
  if (idHubAgent) requete = requete.eq("id_hub_prevu", idHubAgent);
  const { data, error } = await requete;
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------------
// Tableau de bord — vue d'ensemble du jour, pensée pour un coup d'oeil au
// lancement de l'espace centrale (voir Refonte_graphique_IKMS.zip). Réutilise
// des sources déjà existantes (v_performance_entreprise_jour, v_statut_lot,
// listerCommandesEnRamassage) plutôt que de dupliquer leur logique.
// ---------------------------------------------------------------------------

export async function lireKpiTableauDeBord(idHubAgent = null) {
  let requeteAttente = sb().from("colis").select("id_colis, commandes!inner(id_hub_prevu)", { count: "exact", head: true }).in("statut", ["CREE", "A_RAMASSER"]);
  if (idHubAgent) requeteAttente = requeteAttente.eq("commandes.id_hub_prevu", idHubAgent);

  const aujourdhui = new Date().toISOString().slice(0, 10);
  const [attente, lots, perf] = await Promise.all([
    requeteAttente,
    listerLots(idHubAgent),
    lirePerformanceEntreprise(aujourdhui)
  ]);

  return {
    colisEnAttente: attente.count || 0,
    lotsEnTransit: lots.filter((l) => l.statut !== "TERMINE").length,
    livraisonsDuJour: perf.livraisons || 0,
    encaisseAujourdhui: perf.ca || 0,
    margeAujourdhui: perf.marge || 0
  };
}

// Les commandes les plus récentes en attente ou en cours de ramassage,
// avec la (ou les) zone(s) de destination et le montant total des colis
// qu'elles contiennent — listerCommandesEnRamassage() ne les inclut pas
// puisqu'ils vivent sur colis, pas sur commandes (une commande peut avoir
// plusieurs colis vers des zones différentes).
export async function lireRamassagesRecents(idHubAgent = null, limite = 6) {
  const commandes = await listerCommandesEnRamassage(idHubAgent);
  const recentes = commandes.slice(-limite).reverse();
  if (!recentes.length) return [];

  const { data: colis } = await sb()
    .from("colis")
    .select("id_commande, code_zone, montant_livraison")
    .in("id_commande", recentes.map((c) => c.id_commande));

  const parCommande = {};
  (colis || []).forEach((c) => {
    if (!parCommande[c.id_commande]) parCommande[c.id_commande] = { zones: new Set(), montant: 0 };
    if (c.code_zone) parCommande[c.id_commande].zones.add(c.code_zone);
    parCommande[c.id_commande].montant += Number(c.montant_livraison || 0);
  });

  return recentes.map((c) => ({
    ...c,
    zone: [...(parCommande[c.id_commande]?.zones || [])].join(", ") || "—",
    montant: parCommande[c.id_commande]?.montant || 0
  }));
}

// Les lots pas encore terminés, triés par avancement croissant (les plus
// proches d'être complets en dernier) — c'est ceux qui restent à préparer
// qui méritent l'attention en priorité.
export async function lireLotsEnPreparation(idHubAgent = null, limite = 3) {
  const lots = await listerLots(idHubAgent);
  return lots
    .filter((l) => l.statut !== "TERMINE")
    .slice(0, limite);
}

export async function listerCommandes({ idHubAgent = null, aujourdhuiSeulement = true, recherche = "", limite = 200 } = {}) {
  let requete = sb()
    .from("commandes")
    .select("id_commande, expediteur_nom, expediteur_tel, code_ramassage, mode_paiement, id_livreur_ramassage, cree_le, id_hub_prevu, alerte_zone_expediteur, hubs(nom)")
    .order("cree_le", { ascending: false })
    .limit(limite);
  if (idHubAgent) requete = requete.eq("id_hub_prevu", idHubAgent);
  if (aujourdhuiSeulement && !recherche) {
    const debutJour = new Date(); debutJour.setHours(0, 0, 0, 0);
    requete = requete.gte("cree_le", debutJour.toISOString());
  }
  if (recherche.trim()) {
    const q = recherche.trim();
    requete = requete.or(`id_commande.ilike.%${q}%,expediteur_nom.ilike.%${q}%,expediteur_tel.ilike.%${q}%`);
  }
  const { data, error } = await requete;
  if (error) throw error;
  return data || [];
}

export async function listerColisDeCommande(idCommande) {
  const { data, error } = await sb()
    .from("colis")
    .select("id_colis, destinataire_nom, destinataire_tel, destinataire_adresse, code_zone, statut, montant_livraison, code_livraison, alerte_zone")
    .eq("id_commande", idCommande)
    .order("id_colis", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function lireStatutsCommandes(idsCommande) {
  if (!idsCommande.length) return {};
  const { data, error } = await sb()
    .from("v_statut_commande")
    .select("id_commande, statut, nb_colis, nb_livres, nb_retournes")
    .in("id_commande", idsCommande);
  if (error) throw error;
  const parId = {};
  (data || []).forEach((s) => { parId[s.id_commande] = s; });
  return parId;
}

export async function assignerRamassage(idCommande, idLivreur) {
  const { error } = await sb().rpc("rpc_assigner_ramassage", { p_id_commande: idCommande, p_id_livreur: idLivreur });
  return { ok: !error, message: error?.message };
}

export async function listerHubs() {
  const { data, error } = await sb().from("hubs").select("id_hub, nom, adresse, actif").order("nom");
  if (error) throw error;
  return data || [];
}

export async function creerHub(idEntreprise, nom, adresse) {
  const { error } = await sb().from("hubs").insert({ id_entreprise: idEntreprise, nom, adresse: adresse || null });
  return { ok: !error, message: error?.message };
}

export async function modifierHub(idHub, champs) {
  const { error } = await sb().from("hubs").update(champs).eq("id_hub", idHub);
  return { ok: !error, message: error?.message };
}

// Dépôt avec choix du hub réel (et motif si différent du hub prévu) --
// remplace l'ancien demanderDepot() sans hub côté espace livreur.
export async function demanderDepotAvecHub(idColis, idHubReel, motif) {
  const { error } = await sb().rpc("avancer_colis", {
    p_id_colis: idColis, p_evenement: "DEMANDER_DEPOT",
    p_motif: motif || null, p_details: idHubReel ? { id_hub_reel: idHubReel } : {}
  });
  return { ok: !error, message: error?.message };
}

// Colis en attente de validation au hub (dépôts et retours)
export async function listerColisAValider(idHubAgent = null) {
  let requete = sb()
    .from("colis")
    .select("id_colis, id_commande, destinataire_nom, statut, motif_retour, code_zone, cree_le, alerte_zone, commandes(alerte_zone_expediteur)")
    .in("statut", ["DEPOT_DEMANDE", "RETOUR_DEMANDE"])
    .order("cree_le", { ascending: true });
  if (idHubAgent) requete = requete.eq("id_hub_reel", idHubAgent);
  const { data, error } = await requete;
  if (error) throw error;
  return data || [];
}

export async function validerDepot(idColis) {
  const { error } = await sb().rpc("avancer_colis", { p_id_colis: idColis, p_evenement: "VALIDER_DEPOT" });
  return { ok: !error, message: error?.message };
}

// Confirme l'arrivée physique d'un retour au hub — avant : absente, l'agent
// avait directement le choix reprogrammer/retour expéditeur sans jamais
// confirmer que le colis était réellement là.
export async function validerRetourRecu(idColis) {
  const { error } = await sb().rpc("avancer_colis", { p_id_colis: idColis, p_evenement: "VALIDER_RETOUR_RECU" });
  return { ok: !error, message: error?.message };
}

export async function validerRetour(idColis, decision) {
  // decision : "REPROGRAMMER" ou "EXPEDITEUR"
  const evenement = decision === "REPROGRAMMER" ? "VALIDER_RETOUR_REPROGRAMMER" : "VALIDER_RETOUR_EXPEDITEUR";
  const { error } = await sb().rpc("avancer_colis", { p_id_colis: idColis, p_evenement: evenement });
  return { ok: !error, message: error?.message };
}

// Version atomique : décision + lecture du lien de code en un seul appel,
// même transaction — pour "retour à l'expéditeur" spécifiquement, qui a
// besoin du lien juste après. Remplace l'ancien enchaînement en deux temps
// (validerRetour puis obtenirLienCodeRetour), plus robuste par construction.
export async function deciderRetour(idColis, decision, supplement) {
  const { data, error } = await sb().rpc("rpc_decider_retour", {
    p_id_colis: idColis, p_decision: decision, p_supplement: supplement || null
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, statut: data?.[0]?.statut, tokenCodeRetour: data?.[0]?.token_code_retour || null };
}

// Décision "point relais" : avancer_colis puis SMS au destinataire (le SMS
// n'est jamais bloquant — un souci d'envoi ne doit jamais empêcher la
// décision elle-même d'être enregistrée).
export async function validerPointRelais(idColis) {
  const { error } = await sb().rpc("avancer_colis", { p_id_colis: idColis, p_evenement: "VALIDER_POINT_RELAIS" });
  if (error) return { ok: false, message: error.message };
  sb().functions.invoke("notifier-sms", { body: { evenement: "COLIS_POINT_RELAIS", id_colis: idColis } }).catch(() => {});
  return { ok: true };
}

// Retrait au point relais par le destinataire : même code que la livraison
// normale, même règle de paiement côté serveur (voir avancer_colis).
export async function validerRetraitPointRelais(idColis, code) {
  const { error } = await sb().rpc("avancer_colis", { p_id_colis: idColis, p_evenement: "RETIRER_POINT_RELAIS", p_code: code });
  return { ok: !error, message: error?.message };
}

export async function attendreConfirmationWave(idPaiement, tentativesMax = 15) {
  for (let i = 0; i < tentativesMax; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data } = await sb().from("paiements").select("statut").eq("id", idPaiement).maybeSingle();
    if (data?.statut === "PAYE") return true;
    if (data?.statut === "ECHOUE") return false;
  }
  return null;
}

export async function lireMontantDu(idColis) {
  const { data, error } = await sb().rpc("montant_du", { p_id_colis: idColis });
  if (error) throw error;
  return Number(data) || 0;
}

export async function encaisserEspecesPointRelais(idColis) {
  const { data, error } = await sb().rpc("rpc_encaisser_especes_point_relais", { p_id_colis: idColis });
  return { ok: !error, message: error?.message, idPaiement: data };
}

export async function initierPaiementWavePointRelais(idColis) {
  const { data, error } = await sb().functions.invoke("wave-initier-paiement", {
    body: { id_colis: idColis, type: "point_relais" }
  });
  if (error || data?.error) return { ok: false, message: await extraireErreurFonction(error, data) };
  return { ok: true, idPaiement: data.data.id_paiement, waveLaunchUrl: data.data.wave_launch_url };
}

export async function listerColisPointRelais(idHubAgent = null) {
  let requete = sb()
    .from("colis")
    .select("id_colis, destinataire_nom, destinataire_tel, code_livraison, id_hub_reel, hubs(nom)")
    .eq("statut", "POINT_RELAIS")
    .order("maj_le", { ascending: true });
  if (idHubAgent) requete = requete.eq("id_hub_reel", idHubAgent);
  const { data, error } = await requete;
  if (error) throw error;
  return data || [];
}

export async function annulerColis(idColis) {
  const { error } = await sb().rpc("avancer_colis", { p_id_colis: idColis, p_evenement: "ANNULER" });
  return { ok: !error, message: error?.message };
}

// ---------------------------------------------------------------------------
// Lots de livraison
// ---------------------------------------------------------------------------

export async function listerColisDisponiblesPourLot(idHubAgent = null) {
  let requete = sb()
    .from("colis")
    .select("id_colis, destinataire_nom, destinataire_adresse, code_zone, montant_livraison, alerte_zone")
    .eq("statut", "AU_HUB")
    .order("code_zone", { ascending: true });
  if (idHubAgent) requete = requete.eq("id_hub_reel", idHubAgent);
  const { data, error } = await requete;
  if (error) throw error;
  return data || [];
}

export async function listerLots(idHubAgent = null) {
  let requete = sb()
    .from("lots_livraison")
    .select("id_lot, note, id_livreur, cree_le, id_hub")
    .order("cree_le", { ascending: false });
  if (idHubAgent) requete = requete.eq("id_hub", idHubAgent);
  const { data: lots, error } = await requete;
  if (error) throw error;

  const { data: statuts } = await sb()
    .from("v_statut_lot")
    .select("id_lot, statut, fige, nb_colis");
  const parId = {};
  (statuts || []).forEach((s) => { parId[s.id_lot] = s; });

  return (lots || []).map((l) => ({ ...l, ...(parId[l.id_lot] || {}) }));
}

// Colis en attente de récupération, directement (sans passer par le lot) —
// la validation se fait colis par colis, jamais d'un coup pour tout le lot.
export async function listerColisEnRecuperation() {
  const { data, error } = await sb()
    .from("colis")
    .select("id_colis, destinataire_nom, code_zone, id_lot, lots_livraison(id_livreur)")
    .eq("statut", "RECUP_DEMANDEE");
  if (error) throw error;
  return (data || []).map((c) => ({ ...c, id_livreur: c.lots_livraison?.id_livreur }));
}

export async function listerColisDuLot(idLot) {
  const { data, error } = await sb()
    .from("colis")
    .select("id_colis, destinataire_nom, destinataire_adresse, code_zone, montant_livraison, statut, alerte_zone")
    .eq("id_lot", idLot);
  if (error) throw error;
  return data || [];
}

export async function creerLot(idsColis, note) {
  const { data, error } = await sb().rpc("rpc_creer_lot", { p_colis: idsColis, p_note: note || null });
  return { ok: !error, idLot: data, message: error?.message };
}

export async function modifierLot(idLot, ajouter, retirer) {
  const { error } = await sb().rpc("rpc_modifier_lot", {
    p_id_lot: idLot, p_ajouter: ajouter || [], p_retirer: retirer || []
  });
  return { ok: !error, message: error?.message };
}

export async function assignerLot(idLot, idLivreur) {
  const { error } = await sb().rpc("rpc_assigner_lot", { p_id_lot: idLot, p_id_livreur: idLivreur });
  return { ok: !error, message: error?.message };
}

export async function validerRecuperationLot(idLot) {
  const { error } = await sb().rpc("rpc_valider_recuperation", { p_id_lot: idLot });
  return { ok: !error, message: error?.message };
}

// Validation colis par colis (alternative à la validation groupée du lot
// entier) : utile quand certains colis du lot doivent être traités à part.
export async function validerRecuperationColis(idColis) {
  const { error } = await sb().rpc("avancer_colis", { p_id_colis: idColis, p_evenement: "VALIDER_RECUPERATION" });
  return { ok: !error, message: error?.message };
}

export async function assignerRetour(idColis, idLivreur) {
  const { error } = await sb().rpc("rpc_assigner_retour", { p_id_colis: idColis, p_id_livreur: idLivreur });
  return { ok: !error, message: error?.message };
}

export async function listerColisARetourner(idHubAgent = null) {
  let requete = sb()
    .from("colis")
    .select("id_colis, destinataire_nom, motif_retour, cree_le")
    .eq("statut", "A_RETOURNER");
  if (idHubAgent) requete = requete.eq("id_hub_reel", idHubAgent);
  const { data, error } = await requete;
  if (error) throw error;
  return data || [];
}

// Retours confirmés reçus au hub, en attente de décision (reprogrammer ou
// retourner à l'expéditeur) — l'étape qui manquait avant.
export async function listerColisRetourRecu(idHubAgent = null) {
  let requete = sb()
    .from("colis")
    .select("id_colis, destinataire_nom, motif_retour, cree_le")
    .eq("statut", "RETOUR_RECU");
  if (idHubAgent) requete = requete.eq("id_hub_reel", idHubAgent);
  const { data, error } = await requete;
  if (error) throw error;
  return data || [];
}

// Lien de partage du code de retour, à donner à l'expéditeur au moment où
// la décision "retour à l'expéditeur" vient d'être prise (le code est
// généré à cet instant précis, voir avancer_colis).
export async function obtenirLienCodeRetour(idColis) {
  const { data, error } = await sb()
    .from("liens_partage")
    .select("token")
    .eq("id_colis", idColis).eq("type", "CODE_RETOUR")
    .order("cree_le", { ascending: false })
    .limit(1).maybeSingle();
  if (error) throw error;
  return data?.token || null;
}

// Retours déjà assignés à un livreur, en attente de la récupération
// physique au hub (RETOUR_ASSIGNE = assigné pas encore réclamé,
// RETOUR_RECUP_DEMANDEE = le livreur a demandé, en attente de validation agent).
export async function listerRetoursEnRecuperation() {
  const { data, error } = await sb()
    .from("colis")
    .select("id_colis, destinataire_nom, statut, id_livreur_retour")
    .in("statut", ["RETOUR_ASSIGNE", "RETOUR_RECUP_DEMANDEE"]);
  if (error) throw error;
  return data || [];
}

export async function validerRecuperationRetour(idColis) {
  const { error } = await sb().rpc("avancer_colis", { p_id_colis: idColis, p_evenement: "VALIDER_RECUPERATION_RETOUR" });
  return { ok: !error, message: error?.message };
}

// ---------------------------------------------------------------------------
// Utilisateurs, véhicules
// ---------------------------------------------------------------------------

export async function listerLivreursActifs() {
  const { data, error } = await sb()
    .from("utilisateurs")
    .select("id_utilisateur, nom")
    .eq("role", "livreur")
    .eq("actif", true)
    .order("nom", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listerUtilisateurs() {
  const { data, error } = await sb()
    .from("utilisateurs")
    .select("id_utilisateur, nom, telephone, email, role, actif, salaire_jour, charges_jour, id_vehicule, id_hub_affecte")
    .order("nom", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Piège connu de supabase-js : quand une fonction Edge répond avec un statut
// non-2xx, error.message reste un message générique ("Edge Function returned
// a non-2xx status code") — le VRAI message qu'on a mis dans le corps de la
// réponse est dans error.context (l'objet Response brut), qu'il faut parser
// soi-même. Sans ça, toute erreur métier (ex. "ce code existe déjà") est
// invisible et remplacée par "non-2xx status code".
async function extraireErreurFonction(error, data) {
  if (data?.error) return data.error;
  if (error?.context && typeof error.context.json === "function") {
    try {
      const corps = await error.context.json();
      if (corps?.error) return corps.error;
    } catch { /* corps non-JSON ou déjà consommé : on retombe sur error.message */ }
  }
  return error?.message || "Une erreur est survenue.";
}

export async function creerUtilisateur(payload) {
  const { data, error } = await sb().functions.invoke("creer-utilisateur", { body: payload });
  if (error || data?.error) return { ok: false, message: await extraireErreurFonction(error, data) };
  return { ok: true, data: data?.data };
}

export async function modifierUtilisateur(idUtilisateur, champs) {
  const { error } = await sb().from("utilisateurs").update(champs).eq("id_utilisateur", idUtilisateur);
  return { ok: !error, message: error?.message };
}

export async function listerVehicules() {
  const { data, error } = await sb()
    .from("vehicules")
    .select("id_vehicule, type, immatriculation, statut, charges_jour")
    .order("type", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function creerVehicule(vehicule) {
  const { error } = await sb().from("vehicules").insert(vehicule);
  return { ok: !error, message: error?.message };
}

export async function modifierVehicule(idVehicule, champs) {
  const { error } = await sb().from("vehicules").update(champs).eq("id_vehicule", idVehicule);
  return { ok: !error, message: error?.message };
}

// ---------------------------------------------------------------------------
// Zones et tarifs
// ---------------------------------------------------------------------------

export async function listerZones() {
  const { data, error } = await sb()
    .from("zones_tarification")
    .select("id, code_zone, secteur, nom_commune, mots_cles, actif, id_hub")
    .order("nom_commune", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function enregistrerZone({ codeZone, secteur, nomCommune, motsCles, idHub }, idEntreprise) {
  const { error } = await sb().from("zones_tarification").upsert(
    {
      id_entreprise: idEntreprise, code_zone: codeZone.toUpperCase(), secteur,
      nom_commune: nomCommune, mots_cles: motsCles || [], id_hub: idHub || null, actif: true
    },
    { onConflict: "id_entreprise,code_zone" }
  );
  return { ok: !error, message: error?.message };
}

export async function desactiverZone(id) {
  const { error } = await sb().from("zones_tarification").update({ actif: false }).eq("id", id);
  return { ok: !error, message: error?.message };
}

// ---------------------------------------------------------------------------
// Tarifs par paire de zones (depart -> arrivee). zone1->zone2 et zone2->zone1
// partagent la même ligne : on normalise toujours en (zone_a <= zone_b) avant
// d'écrire, pour matcher la contrainte côté base (voir 17_zones_paires_et_obligatoires.sql).
// ---------------------------------------------------------------------------
export async function listerTarifsPaires() {
  const { data, error } = await sb()
    .from("zones_tarifs_paires")
    .select("id, zone_a, zone_b, montant, actif")
    .order("zone_a", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function enregistrerTarifPaire({ zoneDepart, zoneArrivee, montant }, idEntreprise) {
  const a = zoneDepart.toUpperCase();
  const b = zoneArrivee.toUpperCase();
  const zoneA = a <= b ? a : b;
  const zoneB = a <= b ? b : a;
  const { error } = await sb().from("zones_tarifs_paires").upsert(
    { id_entreprise: idEntreprise, zone_a: zoneA, zone_b: zoneB, montant, actif: true },
    { onConflict: "id_entreprise,zone_a,zone_b" }
  );
  return { ok: !error, message: error?.message };
}

export async function desactiverTarifPaire(id) {
  const { error } = await sb().from("zones_tarifs_paires").update({ actif: false }).eq("id", id);
  return { ok: !error, message: error?.message };
}

// ---------------------------------------------------------------------------
// Performance et caisse
// ---------------------------------------------------------------------------

export async function lirePerformanceDuJour(jour) {
  const { data, error } = await sb()
    .from("v_performance_livreur_jour")
    .select("id_livreur, nom, nb_ramassages, nb_livraisons, ca_livre, salaire_jour, charges_livreur, charges_vehicule, type_vehicule, marge_jour")
    .eq("jour", jour)
    .order("marge_jour", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function lirePerformanceEntreprise(jour) {
  const { data, error } = await sb()
    .from("v_performance_entreprise_jour")
    .select("ramassages, livraisons, ca, charges, marge")
    .eq("jour", jour)
    .maybeSingle();
  if (error) throw error;
  return data || { ramassages: 0, livraisons: 0, ca: 0, charges: 0, marge: 0 };
}

export async function lireCaisseTousLivreurs() {
  const { data, error } = await sb()
    .from("v_caisse_livreur")
    .select("id_livreur, nom, solde_especes, role, id_hub_affecte")
    .order("solde_especes", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function verserCaisse(montant) {
  const { error } = await sb().rpc("rpc_verser_caisse", { p_montant: montant });
  return { ok: !error, message: error?.message };
}

export async function lireHistoriqueVersements(idLivreur = null) {
  let requete = sb()
    .from("v_historique_versements")
    .select("id, montant, cree_le, id_livreur, nom_personne, role_personne, id_hub, nom_hub, valide_par, nom_validateur")
    .order("cree_le", { ascending: false });
  if (idLivreur) requete = requete.eq("id_livreur", idLivreur);
  const { data, error } = await requete;
  if (error) throw error;
  return data || [];
}

export async function lireCaisseParHub() {
  const { data, error } = await sb()
    .from("v_caisse_hub")
    .select("id_hub, nom_hub, solde_especes_hub, nb_personnes_avec_cash")
    .order("solde_especes_hub", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listerVersementsEnAttente() {
  const { data, error } = await sb()
    .from("versements_livreur")
    .select("id, id_livreur, montant, valide_par, cree_le")
    .is("valide_par", null)
    .order("cree_le", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function validerVersement(id) {
  const { error } = await sb().rpc("rpc_valider_versement", { p_id: id });
  return { ok: !error, message: error?.message };
}

// ---------------------------------------------------------------------------
// Liens partagés (retrouver/renvoyer à tout moment)
// ---------------------------------------------------------------------------

export async function lireLiensCommande(idCommande) {
  const [{ data: lienExp, error: erreurExp }, { data: colis, error: erreurColis }] = await Promise.all([
    sb().from("liens_partage").select("token, type, id_colis").eq("id_commande", idCommande).eq("type", "POSITION_EXPEDITEUR"),
    sb().from("colis").select("id_colis, destinataire_nom").eq("id_commande", idCommande)
  ]);
  if (erreurExp) throw erreurExp;
  if (erreurColis) throw erreurColis;

  const idsColis = (colis || []).map((c) => c.id_colis);
  let liensDest = [];
  if (idsColis.length) {
    // BUG CORRIGÉ : les liens "position destinataire" sont rattachés par
    // id_colis, jamais par id_commande (une ligne par colis) — la requête
    // précédente, filtrée uniquement sur id_commande, ne les trouvait donc
    // jamais et le bouton "Liens" n'affichait que la position expéditeur.
    const { data, error } = await sb()
      .from("liens_partage").select("token, type, id_colis")
      .in("id_colis", idsColis).eq("type", "POSITION_DESTINATAIRE");
    if (error) throw error;
    liensDest = (data || []).map((l) => ({
      ...l, destinataire_nom: colis.find((c) => c.id_colis === l.id_colis)?.destinataire_nom
    }));
  }
  return [...(lienExp || []), ...liensDest];
}

export function construireUrlPartage(token, baseUrl) {
  return `${baseUrl || window.APP_CONFIG?.APP_BASE_URL || window.location.origin}/suivi.html?token=${token}`;
}

// ---------------------------------------------------------------------------
// Entreprises clientes (onboarding SaaS — reservé au rôle super_admin, la
// RLS empêche de toute façon tout autre rôle d'écrire dans cette table).
// ---------------------------------------------------------------------------

export async function listerEntreprises() {
  const { data, error } = await sb()
    .from("v_entreprises_apercu")
    .select("id_entreprise, code_entreprise, nom, actif, cree_le, nb_utilisateurs, nb_commandes, essai_expire_le")
    .order("cree_le", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Reserve au super-admin : prolonge/fixe l'essai (p_jours) ou le retire
// (jours=null, plan payant actif — plus de limite a surveiller).
export async function definirEssai(idEntreprise, jours) {
  const { error } = await sb().rpc("rpc_definir_essai", { p_id_entreprise: idEntreprise, p_jours: jours });
  return { ok: !error, message: error?.message };
}

// URL publique d'une image de personnalisation -- ne fait aucun appel
// réseau (getPublicUrl est purement local, construit juste l'URL à partir
// du chemin), donc jamais besoin d'attendre pour l'afficher.
export function urlPersonnalisation(codeEntreprise, variant, cle) {
  return sb().storage.from("personnalisation").getPublicUrl(`${codeEntreprise}/${variant}/${cle}.webp`).data.publicUrl;
}

export async function listerPersonnalisation(codeEntreprise) {
  const { data, error } = await sb().rpc("rpc_lister_personnalisation", { p_code_entreprise: codeEntreprise });
  if (error) throw error;
  return (data || []).map((r) => r.chemin);
}

// Upload une image de personnalisation (page expéditeur) — le chemin
// respecte la convention {code_entreprise}/{desktop|mobile}/{cle}.webp,
// vérifiée côté RLS (voir 34_stockage_personnalisation.sql).
export async function uploaderPersonnalisation(codeEntreprise, variant, cle, fichier) {
  const chemin = `${codeEntreprise}/${variant}/${cle}.webp`;
  const { error } = await sb().storage.from("personnalisation").upload(chemin, fichier, { upsert: true, contentType: fichier.type });
  if (error) return { ok: false, message: error.message };
  const { data } = sb().storage.from("personnalisation").getPublicUrl(chemin);
  return { ok: true, url: data.publicUrl };
}

// Retire une image personnalisée — la page expéditeur retombe alors sur
// l'image par défaut (elle ne fait que vérifier ce qui existe encore).
export async function supprimerPersonnalisation(codeEntreprise, variant, cle) {
  const chemin = `${codeEntreprise}/${variant}/${cle}.webp`;
  const { error } = await sb().storage.from("personnalisation").remove([chemin]);
  return { ok: !error, message: error?.message };
}

export async function lireTextesPersonnalisesEntreprise() {
  const { data, error } = await sb().from("textes_personnalises").select("cle, titre, sous_titre");
  if (error) throw error;
  return data || [];
}

export async function definirTextePersonnalise(cle, titre, sousTitre) {
  const { error } = await sb().rpc("rpc_definir_texte_personnalise", { p_cle: cle, p_titre: titre, p_sous_titre: sousTitre });
  return { ok: !error, message: error?.message };
}

export async function retirerTextePersonnalise(cle) {
  const { error } = await sb().rpc("rpc_retirer_texte_personnalise", { p_cle: cle });
  return { ok: !error, message: error?.message };
}

// Crée l'entreprise ET son premier compte admin en une seule opération : une
// entreprise sans aucun utilisateur admin serait inutilisable telle quelle
// (personne ne pourrait s'y connecter pour la configurer davantage).
// ---------------------------------------------------------------------------
// Personnalisation de la page d'inscription entreprise (superadmin) --
// distincte de la personnalisation par tenant : aucun id_entreprise, un seul
// jeu de paramètres pour toute la plateforme (voir plateforme.js).
// ---------------------------------------------------------------------------
export async function lireParametresPlateforme() {
  const { data, error } = await sb().rpc("rpc_lire_parametres_plateforme");
  if (error) throw error;
  return Object.fromEntries((data || []).map((r) => [r.cle, r.valeur]));
}

export async function definirParametrePlateforme(cle, valeur) {
  const { error } = await sb().rpc("rpc_definir_parametre_plateforme", { p_cle: cle, p_valeur: valeur });
  return { ok: !error, message: error?.message };
}

export async function uploaderImagePlateforme(fichier) {
  const chemin = "hero.webp";
  const { error } = await sb().storage.from("plateforme").upload(chemin, fichier, { upsert: true, contentType: fichier.type });
  if (error) return { ok: false, message: error.message };
  return { ok: true, chemin };
}

export async function supprimerImagePlateforme() {
  const { error } = await sb().storage.from("plateforme").remove(["hero.webp"]);
  return { ok: !error, message: error?.message };
}

export function urlImagePlateforme() {
  return sb().storage.from("plateforme").getPublicUrl("hero.webp").data.publicUrl;
}

export async function listerFichiersPlateforme() {
  const { data, error } = await sb().storage.from("plateforme").list();
  if (error) return [];
  return (data || []).map((f) => f.name);
}

export async function creerEntreprise({ codeEntreprise, nom, adminNom, adminEmail, adminTelephone, adminMotDePasse }) {
  const { data: entreprise, error: erreurEntreprise } = await sb()
    .from("entreprises")
    .insert({ code_entreprise: codeEntreprise.toUpperCase(), nom })
    .select("id_entreprise, code_entreprise")
    .single();
  if (erreurEntreprise) return { ok: false, message: erreurEntreprise.message };

  const { data, error } = await sb().functions.invoke("creer-utilisateur", {
    body: {
      nom: adminNom, email: adminEmail, password: adminMotDePasse,
      telephone: adminTelephone, role: "admin", id_entreprise: entreprise.id_entreprise
    }
  });
  if (error || data?.error) {
    // L'entreprise existe mais n'a pas d'admin : on le signale clairement
    // plutôt que de laisser une entreprise fantôme sans explication.
    const messageErreur = await extraireErreurFonction(error, data);
    return {
      ok: false,
      message: `Entreprise "${entreprise.code_entreprise}" créée, mais le compte admin a échoué : ${messageErreur}. Réessaie de créer l'admin depuis le panneau Utilisateurs une fois basculé sur cette entreprise, ou contacte le support.`
    };
  }
  return { ok: true, entreprise };
}

export async function desactiverEntreprise(idEntreprise) {
  const { error } = await sb().from("entreprises").update({ actif: false }).eq("id_entreprise", idEntreprise);
  return { ok: !error, message: error?.message };
}

export async function reactiverEntreprise(idEntreprise) {
  const { error } = await sb().from("entreprises").update({ actif: true }).eq("id_entreprise", idEntreprise);
  return { ok: !error, message: error?.message };
}
