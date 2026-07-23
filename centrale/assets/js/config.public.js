// Configuration publique — ces valeurs sont l'URL et la clé publique (anon/publishable)
// de ton projet Supabase. Elles sont sans danger à exposer côté client : la sécurité
// vient de la RLS et des RPC, pas du secret de cette clé.
window.APP_CONFIG = {
    SUPABASE_URL: "https://wnzqmmiprxugxwryjvyi.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_xvSVvBDw0zweAWwByCurNQ_xDbf0FEv",
    // URL de base des PAGES PUBLIQUES (phase4-pages-publiques) — PAS celle de
    // cet espace centrale. Sert à construire les liens de suivi de position
    // (suivi.html) et le lien d'envoi de colis (?entreprise=CODE) montrés aux
    // agents depuis Commandes/Abonnement. Comme centrale et pages publiques
    // sont deux déploiements séparés (repos/domaines différents), ne PAS
    // laisser window.location.origin par défaut ici — ça pointerait vers ce
    // même espace centrale, où suivi.html n'existe pas, et le lien serait
    // cassé (repéré : "les liens de suivi pour les commandes internes ne
    // fonctionnent pas"). Mets l'URL complète des pages publiques, par ex.
    // "https://mondomaine.com" ou "https://livraison.mondomaine.com".
    APP_BASE_URL: "https://ismaelfofana1998-cloud.github.io/IKMS/public/expediteur.html",
    // Même token public LocationIQ que sur les pages publiques (voir
    // v3-public/assets/js/config.public.js) : utilisé pour l'autocomplétion
    // d'adresse dans le formulaire de commande interne (panneau Commandes).
    LOCATIONIQ_TOKEN: "pk.982bebb48e1dc80a391fc2bf97e262a4"
};
