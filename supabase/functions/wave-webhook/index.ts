// Fonction Edge : wave-webhook
//
// Endpoint public appele directement par les serveurs Wave (pas par le front).
// URL a enregistrer dans le tableau de bord Wave Business de CHAQUE
// entreprise -- PAS la meme URL pour tout le monde :
//   https://<TON_PROJET>.supabase.co/functions/v1/wave-webhook/<JETON_DE_TON_ENTREPRISE>
//
// Le jeton (visible dans l'onglet "Paiements" de l'espace centrale, une fois
// les cles Wave enregistrees) permet de savoir IMMEDIATEMENT a quelle
// entreprise cet appel appartient, et donc quelle cle de signature utiliser
// pour verifier l'authenticite -- chaque entreprise a la sienne, jamais une
// cle partagee par toute la plateforme.
//
// Verifie la signature HMAC-SHA256 (Wave-Signature: t=...,v1=...), calculee
// sur la concatenation EXACTE "timestamp + corps brut" -- surtout ne jamais
// re-serialiser le JSON avant de verifier, un octet different invalide la
// signature. Traite uniquement les evenements checkout.session.completed et
// confirme le paiement via rpc_confirmer_paiement, idempotente par
// l'identifiant d'evenement Wave (id_event_externe).
//
// Secrets requis : CHIFFREMENT_PAIEMENTS_CLE (le meme que
// wave-initier-paiement et configurer-paiement-wave).
// Deploiement : supabase functions deploy wave-webhook --no-verify-jwt
// (--no-verify-jwt est indispensable : Wave n'envoie pas de JWT Supabase,
// juste sa propre signature Wave-Signature).

import { createClient } from "npm:@supabase/supabase-js@2";

const TOLERANCE_SECONDES = 300;

async function signerWave(secret, timestamp, corpsTexte) {
  const cle = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(timestamp + corpsTexte));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function egaliteConstante(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Methode non autorisee", { status: 405 });

  const CLE_ENVELOPPE = Deno.env.get("CHIFFREMENT_PAIEMENTS_CLE");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!CLE_ENVELOPPE || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response("Configuration serveur incomplete", { status: 500 });
  }

  // Le jeton est le dernier segment du chemin :
  // .../wave-webhook/<jeton> -- identifie l'entreprise AVANT meme de faire
  // confiance au contenu de la requete.
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const jeton = segments[segments.length - 1];
  if (!jeton || jeton === "wave-webhook") {
    return new Response("URL de webhook incomplete : jeton d'entreprise manquant.", { status: 400 });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: resolu, error: resolutionError } = await supabaseAdmin.rpc("interne_paiement_wave_par_jeton", {
    p_jeton: jeton, p_cle_enveloppe: CLE_ENVELOPPE
  });
  const config = resolu?.[0];
  if (resolutionError || !config?.signing_secret) {
    // Ne jamais confirmer si le jeton n'est pas reconnu -- un jeton faux ou
    // desactive doit echouer, pas retomber sur une cle par defaut.
    return new Response("Jeton d'entreprise inconnu.", { status: 404 });
  }

  const enTeteSignature = req.headers.get("Wave-Signature") || "";
  const corpsBrut = await req.text();

  const parties = Object.fromEntries(
    enTeteSignature.split(",").map((p) => p.split("=")).filter((p) => p.length === 2)
  );
  const timestamp = parties.t;
  const signatureRecue = parties.v1;
  if (!timestamp || !signatureRecue) return new Response("Signature manquante", { status: 401 });

  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > TOLERANCE_SECONDES) {
    return new Response("Horodatage hors tolerance", { status: 401 });
  }

  const signatureCalculee = await signerWave(config.signing_secret, timestamp, corpsBrut);
  if (!egaliteConstante(signatureCalculee, signatureRecue)) {
    return new Response("Signature invalide", { status: 401 });
  }

  let evenement;
  try { evenement = JSON.parse(corpsBrut); } catch { return new Response("JSON invalide", { status: 400 }); }

  if (evenement.type !== "checkout.session.completed") {
    return new Response("Evenement ignore (type non traite)", { status: 200 });
  }

  const session = evenement.data || {};
  const idPaiement = session.client_reference;
  if (!idPaiement) return new Response("client_reference manquant", { status: 200 });

  const succes = session.payment_status === "succeeded" || session.checkout_status === "complete";

  const { error } = await supabaseAdmin.rpc("rpc_confirmer_paiement", {
    p_id_paiement: idPaiement,
    p_reference_externe: session.id || null,
    p_id_event_externe: evenement.id,
    p_succes: succes
  });
  if (error) return new Response(`Erreur de confirmation : ${error.message}`, { status: 500 });

  return new Response("ok", { status: 200 });
});
