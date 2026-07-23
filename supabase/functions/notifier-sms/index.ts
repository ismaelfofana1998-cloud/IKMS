// Fonction Edge : notifier-sms
//
// Envoie un SMS automatique a un moment cle du cycle de vie d'une commande
// ou d'un colis (creation, ramassage, mise en tournee, livraison, retour).
//
// SECURITE IMPORTANTE : cette fonction ne fait JAMAIS confiance a un numero
// de telephone ou a un texte de message fournis par le client. Elle recoit
// uniquement un type d'evenement + une reference (id_commande ou id_colis),
// va elle-meme chercher en base (avec la cle service_role) le vrai numero de
// telephone, et construit le message a partir d'un gabarit fixe cote serveur.
// Sans cette regle, n'importe qui pourrait appeler cette fonction pour
// envoyer du texte arbitraire a n'importe quel numero, aux frais de ton
// compte SMS -- c'est un relais SMS ouvert, une vraie faille d'abus.
//
// Un evenement ne peut jamais etre envoye deux fois pour la meme reference
// (contrainte unique sur notifications_log), ce qui protege a la fois contre
// les doublons (double-clic, requete reessayee) et contre le spam repete
// d'un meme destinataire par quelqu'un qui devinerait un id_commande/id_colis.
//
// Fournisseur SMS : Orange SMS Cote d'Ivoire (OAuth2 client_credentials, puis
// envoi au format GSMA OneAPI, standard historique d'Orange). ATTENTION :
// verifie le schema exact sur le Swagger de ton compte Orange Developer
// (My Apps > SMS CI > API reference) avant la mise en production -- ce code
// suit le format standard, mais confirme les noms de champs chez toi.
//
// Secrets requis (a definir avec `supabase secrets set`) :
//   SMS_PROVIDER              "orange" (absent/vide = notifications desactivees sans erreur bloquante)
//   ORANGE_CLIENT_ID          Client ID Orange Developer
//   ORANGE_CLIENT_SECRET      Client Secret Orange Developer
//   ORANGE_SENDER_ADDRESS     numero expediteur autorise, format "tel:+225XXXXXXXXXX"
//
// Deploiement :
//   supabase secrets set SMS_PROVIDER=orange ORANGE_CLIENT_ID=xxx ORANGE_CLIENT_SECRET=xxx ORANGE_SENDER_ADDRESS=tel:+225XXXXXXXXXX
//   supabase functions deploy notifier-sms
//
// Tant que SMS_PROVIDER n'est pas defini, la fonction continue de logger
// (utile pour verifier le declenchement cote base) mais n'envoie rien de
// reel et ne fait jamais echouer l'operation appelante.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// Seul evenement declenchable sans session : la creation, depuis la page
// publique anonyme. Tous les autres (ramassage, tournee, livraison, retour)
// viennent d'un agent ou d'un livreur deja authentifie.
const EVENEMENTS_ANONYMES = new Set(["COMMANDE_CREEE"]);

function reponseJson(corps, status = 200) {
  return new Response(JSON.stringify(corps), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function gabarit(evenement, d) {
  switch (evenement) {
    case "COMMANDE_CREEE":
      return `IKIGAI Livraison : commande enregistree. Code ramassage a donner au livreur : ${d.code_ramassage}.`;
    case "COLIS_RAMASSE":
      return `IKIGAI Livraison : ton colis ${d.id_colis} a ete recupere par le livreur.`;
    case "COLIS_EN_TOURNEE":
      return `IKIGAI Livraison : ton colis ${d.id_colis} est en cours de livraison. Code a donner au livreur : ${d.code_livraison}.`;
    case "COLIS_LIVRE":
      return `IKIGAI Livraison : ton colis ${d.id_colis} a ete livre. Merci de ta confiance !`;
    case "COLIS_RETOUR":
      return `IKIGAI Livraison : la livraison de ton colis ${d.id_colis} n'a pas pu aboutir. Nous te recontactons rapidement.`;
    case "COLIS_POINT_RELAIS":
      return `IKIGAI Livraison : ton colis ${d.id_colis} t'attend au point relais "${d.nom_hub}"${d.adresse_hub ? ` (${d.adresse_hub})` : ""}. Code a presenter : ${d.code_livraison}.`;
    default:
      return null;
  }
}

// Jeton Orange mis en cache le temps de sa validite, pour eviter de
// ré-authentifier a chaque SMS (le token OAuth2 dure typiquement 1h).
let cacheTokenOrange = null; // { valeur, expireA }

async function obtenirTokenOrange(clientId, clientSecret) {
  if (cacheTokenOrange && cacheTokenOrange.expireA > Date.now() + 5000) return cacheTokenOrange.valeur;
  const identifiants = btoa(`${clientId}:${clientSecret}`);
  const reponse = await fetch("https://api.orange.com/oauth/v3/token", {
    method: "POST",
    headers: { "Authorization": `Basic ${identifiants}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  const donnees = await reponse.json();
  if (!reponse.ok || !donnees.access_token) throw new Error(donnees.error_description || "Authentification Orange echouee.");
  cacheTokenOrange = { valeur: donnees.access_token, expireA: Date.now() + Number(donnees.expires_in || 3600) * 1000 };
  return cacheTokenOrange.valeur;
}

async function envoyerViaOrange({ clientId, clientSecret, senderAddress, telephone, message }) {
  const token = await obtenirTokenOrange(clientId, clientSecret);
  const senderEncode = encodeURIComponent(senderAddress);
  const reponse = await fetch(`https://api.orange.com/smsmessaging/v1/outbound/${senderEncode}/requests`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      outboundSMSMessageRequest: {
        address: [`tel:+${String(telephone).replace(/\D/g, "")}`],
        senderAddress,
        outboundSMSTextMessage: { message }
      }
    })
  });
  if (!reponse.ok) {
    const texte = await reponse.text().catch(() => "");
    throw new Error(`Orange SMS a refuse l'envoi (${reponse.status}) : ${texte.slice(0, 200)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return reponseJson({ error: "Methode non autorisee." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SMS_PROVIDER = Deno.env.get("SMS_PROVIDER");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return reponseJson({ error: "Configuration serveur incomplete." }, 500);
  }

  let corps;
  try { corps = await req.json(); } catch { return reponseJson({ error: "Corps de requete invalide." }, 400); }
  const evenement = String(corps.evenement || "").trim();
  const idCommande = corps.id_commande ? String(corps.id_commande).trim() : null;
  const idColis = corps.id_colis ? String(corps.id_colis).trim() : null;

  if (!evenement || (!idCommande && !idColis)) {
    return reponseJson({ error: "evenement et (id_commande ou id_colis) sont requis." }, 400);
  }

  if (!EVENEMENTS_ANONYMES.has(evenement)) {
    const autorisation = req.headers.get("Authorization") || "";
    if (!autorisation) return reponseJson({ error: "Authentification requise pour cet evenement." }, 401);
    const supabaseAppelant = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: autorisation } } });
    const { data: userData, error: userError } = await supabaseAppelant.auth.getUser();
    if (userError || !userData?.user) return reponseJson({ error: "Session invalide." }, 401);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // On va chercher NOUS-MEMES le numero et le contexte en base : jamais
  // fournis par le client (voir note de securite en tete de fichier).
  let idEntreprise, telephone, idReference, donneesGabarit;

  if (idCommande) {
    const { data: commande } = await supabaseAdmin
      .from("commandes")
      .select("id_entreprise, expediteur_tel, code_ramassage, cree_le")
      .eq("id_commande", idCommande).maybeSingle();
    if (!commande) return reponseJson({ error: "Commande introuvable." }, 404);
    if (evenement === "COMMANDE_CREEE" && Date.now() - new Date(commande.cree_le).getTime() > 10 * 60 * 1000) {
      return reponseJson({ error: "Commande trop ancienne pour cet evenement." }, 400);
    }
    idEntreprise = commande.id_entreprise; telephone = commande.expediteur_tel; idReference = idCommande;
    donneesGabarit = { code_ramassage: commande.code_ramassage };
  } else {
    const { data: colis } = await supabaseAdmin
      .from("colis")
      .select("id_entreprise, destinataire_tel, code_livraison, id_colis, id_hub_reel, hubs(nom, adresse)")
      .eq("id_colis", idColis).maybeSingle();
    if (!colis) return reponseJson({ error: "Colis introuvable." }, 404);
    idEntreprise = colis.id_entreprise; telephone = colis.destinataire_tel; idReference = idColis;
    donneesGabarit = {
      id_colis: colis.id_colis, code_livraison: colis.code_livraison,
      nom_hub: colis.hubs?.nom, adresse_hub: colis.hubs?.adresse
    };
  }

  const message = gabarit(evenement, donneesGabarit);
  if (!message || !telephone) return reponseJson({ error: "Evenement ou numero invalide." }, 400);

  // Verrou anti-doublon/anti-abus : impossible d'inserer deux fois la meme
  // ligne (reference, evenement) -- voir contrainte unique en base.
  const { error: erreurLog } = await supabaseAdmin.from("notifications_log").insert({
    id_entreprise: idEntreprise, id_reference: idReference, evenement,
    telephone, statut: "ENVOYE", fournisseur: SMS_PROVIDER || "aucun"
  });
  if (erreurLog) {
    if (erreurLog.code === "23505") return reponseJson({ data: { deja_envoye: true } });
    return reponseJson({ error: erreurLog.message }, 500);
  }

  if (!SMS_PROVIDER) {
    return reponseJson({ data: { simule: true } });
  }

  try {
    if (SMS_PROVIDER === "orange") {
      await envoyerViaOrange({
        clientId: Deno.env.get("ORANGE_CLIENT_ID"),
        clientSecret: Deno.env.get("ORANGE_CLIENT_SECRET"),
        senderAddress: Deno.env.get("ORANGE_SENDER_ADDRESS"),
        telephone, message
      });
    } else {
      throw new Error(`Fournisseur SMS inconnu : ${SMS_PROVIDER}`);
    }
  } catch (err) {
    await supabaseAdmin.from("notifications_log")
      .update({ statut: "ECHEC", erreur: String(err.message || err).slice(0, 500) })
      .eq("id_reference", idReference).eq("evenement", evenement);
    return reponseJson({ error: err.message || "Envoi SMS echoue." }, 502);
  }

  return reponseJson({ data: { envoye: true } });
});
