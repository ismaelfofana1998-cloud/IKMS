// Fonction Edge : wave-initier-paiement
//
// Appelee par l'espace livreur (repository.js) quand le client choisit de
// payer par Wave -- a la livraison (destinataire), au ramassage ou au retour
// (expediteur, selon "type"). Cree la ligne "paiements" (statut INITIE) via
// la RPC correspondante -- qui verifie deja que l'appelant est bien le
// livreur assigne -- PUIS cree une vraie session de paiement aupres de
// l'API Wave et renvoie wave_launch_url au front.
//
// IMPORTANT : chaque entreprise (tenant) a SA PROPRE cle API et SA PROPRE
// cle de signature Wave -- jamais une cle globale de plateforme. Les cles
// sont chiffrees en base (voir 42_wave_par_entreprise.sql) et ne sont
// dechiffrees qu'ici, avec la cle d'enveloppe qui ne vit que dans les
// secrets de cette fonction.
//
// IMPORTANT (doc Wave officielle) : wave_launch_url doit etre ouvert par le
// navigateur de l'utilisateur (un <a href> classique). Ne jamais l'ouvrir
// dans une webview ou le capturer par fetch cote client : la redirection
// vers l'app Wave ne fonctionnerait pas.
//
// Secrets requis (a definir avec `supabase secrets set`) :
//   CHIFFREMENT_PAIEMENTS_CLE   cle d'enveloppe (une seule, jamais liee a
//                               une entreprise precise -- sert seulement a
//                               dechiffrer/chiffrer les cles Wave de chacune)
//
// Chaque entreprise configure SES PROPRES cles Wave depuis l'onglet
// "Paiements" de son espace centrale (voir configurer-paiement-wave) -- rien
// a faire ici par entreprise, cette fonction sert toutes les entreprises.
//
// Deploiement (une seule fois, cle d'enveloppe generee au hasard) :
//   supabase secrets set CHIFFREMENT_PAIEMENTS_CLE="$(openssl rand -hex 32)"
//   supabase functions deploy wave-initier-paiement

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const RPC_PAR_TYPE = {
  livraison: "rpc_initier_paiement_wave",
  retour: "rpc_initier_paiement_wave_retour",
  ramassage: "rpc_initier_paiement_wave_ramassage",
  point_relais: "rpc_initier_paiement_wave_point_relais"
};

function reponseJson(corps, status = 200) {
  return new Response(JSON.stringify(corps), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

async function signerWave(secret, timestamp, corpsTexte) {
  const cle = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(timestamp + corpsTexte));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return reponseJson({ error: "Methode non autorisee." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const CLE_ENVELOPPE = Deno.env.get("CHIFFREMENT_PAIEMENTS_CLE");
  const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://example.com";

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY || !CLE_ENVELOPPE) {
    return reponseJson({ error: "Configuration serveur incomplete." }, 500);
  }

  const autorisation = req.headers.get("Authorization") || "";
  if (!autorisation) return reponseJson({ error: "Authentification requise." }, 401);

  let corps;
  try { corps = await req.json(); } catch { return reponseJson({ error: "Corps de requete invalide." }, 400); }
  const type = String(corps.type || "livraison");

  // Client "appelant" : porte le JWT du livreur/agent, pour que auth.uid()
  // dans la RPC resolve correctement et que ses propres verifications
  // s'appliquent.
  const supabaseAppelant = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: autorisation } }
  });
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let idPaiement, montantTotal, idEntreprise;

  if (type === "ramassage_commande") {
    // Paiement Wave expediteur pour TOUTE la commande en un coup (plusieurs
    // colis, un seul paiement) -- distinct du paiement par colis (livraison
    // destinataire, qui reste toujours colis par colis).
    const idCommande = String(corps.id_commande || "").trim();
    if (!idCommande) return reponseJson({ error: "id_commande manquant." }, 400);
    const { data, error: rpcError } = await supabaseAppelant.rpc("rpc_initier_paiement_wave_ramassage_commande", {
      p_id_commande: idCommande
    });
    if (rpcError) return reponseJson({ error: rpcError.message }, 400);
    idPaiement = data?.[0]?.groupe_paiement;
    montantTotal = data?.[0]?.montant_total;

    const { data: unePaiement } = await supabaseAdmin
      .from("paiements").select("id_entreprise").eq("groupe_paiement", idPaiement).limit(1).single();
    idEntreprise = unePaiement?.id_entreprise;
  } else {
    const idColis = String(corps.id_colis || "").trim();
    if (!idColis) return reponseJson({ error: "id_colis manquant." }, 400);
    const nomRpc = RPC_PAR_TYPE[type];
    if (!nomRpc) return reponseJson({ error: `Type de paiement inconnu : ${type}.` }, 400);

    const { data, error: rpcError } = await supabaseAppelant.rpc(nomRpc, { p_id_colis: idColis });
    if (rpcError) return reponseJson({ error: rpcError.message }, 400);
    idPaiement = data;

    const { data: paiement, error: lectureError } = await supabaseAdmin
      .from("paiements").select("montant, id_entreprise").eq("id", idPaiement).single();
    if (lectureError || !paiement) return reponseJson({ error: "Paiement introuvable apres creation." }, 500);
    montantTotal = paiement.montant;
    idEntreprise = paiement.id_entreprise;
  }

  // Cles Wave PROPRES a cette entreprise -- jamais une cle globale de
  // plateforme (chaque tenant recoit l'argent sur son propre compte Wave).
  const { data: cles, error: clesError } = await supabaseAdmin.rpc("interne_lire_paiement_wave", {
    p_id_entreprise: idEntreprise, p_cle_enveloppe: CLE_ENVELOPPE
  });
  const cle = cles?.[0];
  if (clesError || !cle?.api_key || !cle?.signing_secret) {
    return reponseJson({ error: "Cette entreprise n'a pas encore configure son compte Wave (onglet Paiements)." }, 412);
  }

  const corpsWave = JSON.stringify({
    amount: String(Math.round(Number(montantTotal))),
    currency: "XOF",
    client_reference: idPaiement,
    success_url: `${APP_BASE_URL}/paiement-confirme.html`,
    error_url: `${APP_BASE_URL}/paiement-echoue.html`
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await signerWave(cle.signing_secret, timestamp, corpsWave);

  const reponseWave = await fetch("https://api.wave.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cle.api_key}`,
      "Wave-Signature": `t=${timestamp},v1=${signature}`,
      "Content-Type": "application/json"
    },
    body: corpsWave
  });
  const donneesWave = await reponseWave.json();

  const colonneCorrespondance = type === "ramassage_commande" ? "groupe_paiement" : "id";

  if (!reponseWave.ok || !donneesWave.wave_launch_url) {
    await supabaseAdmin.from("paiements").update({ statut: "ECHOUE" }).eq(colonneCorrespondance, idPaiement);
    return reponseJson({ error: donneesWave.message || "Erreur lors de la creation de la session Wave." }, 502);
  }

  await supabaseAdmin.from("paiements")
    .update({ reference_externe: donneesWave.id })
    .eq(colonneCorrespondance, idPaiement);

  return reponseJson({ data: { id_paiement: idPaiement, wave_launch_url: donneesWave.wave_launch_url } });
});
