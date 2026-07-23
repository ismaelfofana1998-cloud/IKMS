// Fonction Edge : api-v1
//
// Passerelle API pour les clients pro / partenaires : leur propre systeme
// (ERP, site e-commerce...) peut creer des commandes et consulter leur
// statut, sans passer par l'interface web ni par une session utilisateur
// Supabase classique.
//
// Authentification : PAS un JWT Supabase -- une cle API generee par le
// client pro lui-meme (onglet "API" de son espace), envoyee dans l'en-tete
// standard :
//   Authorization: Bearer ik_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//
// Endpoints :
//   POST /functions/v1/api-v1/commandes        -- creer une commande
//   GET  /functions/v1/api-v1/commandes/:id     -- consulter son statut
//   GET  /functions/v1/api-v1/tarifs            -- grille tarifaire complete
//        (toutes les paires de zones actives) -- a appeler rarement et
//        mettre en cache cote appelant, pas a chaque affichage de prix
//
// La cle est verifiee (hachage compare en base) a chaque appel -- jamais
// mise en cache cote fonction -- et scope strictement TOUT a un seul
// client pro : impossible de consulter ou creer quoi que ce soit pour un
// autre client, meme de la meme entreprise.
//
// Deploiement : supabase functions deploy api-v1 --no-verify-jwt
// (--no-verify-jwt est necessaire : l'authentification se fait par cle API
// dans le corps de cette fonction, pas par un JWT Supabase standard).

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function reponseJson(corps, status = 200) {
  return new Response(JSON.stringify(corps), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return reponseJson({ error: "Configuration serveur incomplete." }, 500);
  }

  // Authentification par cle API -- jamais un JWT Supabase ici.
  const autorisation = req.headers.get("Authorization") || "";
  const cle = autorisation.replace(/^Bearer\s+/i, "").trim();
  if (!cle || !cle.startsWith("ik_live_")) {
    return reponseJson({ error: "Cle API manquante ou invalide. Utilise : Authorization: Bearer ik_live_..." }, 401);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: verif, error: verifError } = await supabaseAdmin.rpc("interne_verifier_cle_api", { p_cle: cle });
  const identite = verif?.[0];
  if (verifError || !identite?.id_client) {
    return reponseJson({ error: "Cle API invalide, revoquee, ou introuvable." }, 401);
  }
  const { id_client: idClient, id_entreprise: idEntreprise } = identite;

  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  // .../api-v1/commandes ou .../api-v1/commandes/CMD-000123
  const indexCommandes = segments.indexOf("commandes");
  const idCommandeChemin = indexCommandes >= 0 ? segments[indexCommandes + 1] : null;

  // ---------------------------------------------------------------------
  // POST /commandes -- creer une commande pour ce client pro
  // ---------------------------------------------------------------------
  if (req.method === "POST" && indexCommandes >= 0 && !idCommandeChemin) {
    let corps;
    try { corps = await req.json(); } catch { return reponseJson({ error: "Corps JSON invalide." }, 400); }

    const { data: entreprise } = await supabaseAdmin
      .from("entreprises").select("code_entreprise").eq("id_entreprise", idEntreprise).single();

    const { data, error } = await supabaseAdmin.rpc("rpc_creer_commande", {
      p_code_entreprise: entreprise?.code_entreprise,
      p_expediteur_nom: corps.expediteur_nom,
      p_expediteur_tel: corps.expediteur_tel,
      p_expediteur_adresse: corps.expediteur_adresse || null,
      p_gps_expediteur: null,
      p_mode_paiement: corps.mode_paiement || null, // laisse rpc_creer_commande appliquer son propre défaut sûr (A_LA_LIVRAISON) -- jamais SANS_PAIEMENT par défaut, qui exige une confiance accordée par un admin
      p_colis: corps.colis || [],
      p_canal: "API",
      p_acteur: null,
      p_zone_depart: corps.zone_depart,
      p_id_client_pro: idClient
    });
    if (error) return reponseJson({ error: error.message }, 400);

    const premiere = data?.[0];
    return reponseJson({
      data: {
        id_commande: premiere?.id_commande,
        code_ramassage: premiere?.code_ramassage,
        colis: (data || []).map((l) => ({
          id_colis: l.id_colis,
          code_livraison: l.code_livraison,
          montant_livraison: l.montant_livraison
        }))
      }
    }, 201);
  }

  // ---------------------------------------------------------------------
  // GET /commandes/:id -- statut d'une commande (uniquement si elle
  // appartient bien a ce client pro -- jamais une autre, meme de la meme
  // entreprise).
  // ---------------------------------------------------------------------
  if (req.method === "GET" && idCommandeChemin) {
    const { data: commande, error } = await supabaseAdmin
      .from("commandes")
      .select("id_commande, mode_paiement, cree_le, id_client_pro")
      .eq("id_commande", idCommandeChemin)
      .eq("id_client_pro", idClient)
      .maybeSingle();
    if (error) return reponseJson({ error: error.message }, 500);
    if (!commande) return reponseJson({ error: "Commande introuvable." }, 404);

    const { data: colis } = await supabaseAdmin
      .from("colis")
      .select("id_colis, destinataire_nom, statut, montant_livraison")
      .eq("id_commande", idCommandeChemin);

    return reponseJson({
      data: {
        id_commande: commande.id_commande,
        mode_paiement: commande.mode_paiement,
        cree_le: commande.cree_le,
        colis: colis || []
      }
    });
  }

  // ---------------------------------------------------------------------
  // GET /tarifs -- grille tarifaire complete (toutes les paires de zones
  // actives) du client pro authentifie. Pense pour etre appelee rarement et
  // mise en cache cote appelant (les tarifs ne changent pas d'une minute a
  // l'autre) plutot qu'appelee a chaque affichage de prix.
  // ---------------------------------------------------------------------
  if (req.method === "GET" && segments[segments.length - 1] === "tarifs") {
    const { data, error } = await supabaseAdmin.rpc("interne_lister_tarifs_entreprise", {
      p_id_entreprise: idEntreprise
    });
    if (error) return reponseJson({ error: error.message }, 500);

    return reponseJson({
      data: {
        tarifs: (data || []).map((t) => ({
          zone_a: t.zone_a,
          zone_b: t.zone_b,
          montant: t.montant
        }))
      }
    });
  }

  return reponseJson({ error: "Route inconnue. Utilise POST /commandes, GET /commandes/:id ou GET /tarifs." }, 404);
});
