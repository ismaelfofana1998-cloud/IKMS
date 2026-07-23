// Configuration publique — ces valeurs sont l'URL et la clé publique (anon/publishable)
// de ton projet Supabase. Elles sont sans danger à exposer côté client : la sécurité
// vient de la RLS et des RPC, pas du secret de cette clé.
window.APP_CONFIG = {
    SUPABASE_URL: "https://wnzqmmiprxugxwryjvyi.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_xvSVvBDw0zweAWwByCurNQ_xDbf0FEv",
    APP_BASE_URL: window.location.origin,
    // URL de base de l'espace centrale (phase3-espace-centrale), pour le lien
    // "Se connecter à mon espace" après l'inscription d'une entreprise.
    // Si tu déploies les 2 dossiers sous le même domaine (ex. tondomaine.com/
    // et tondomaine.com/centrale/), ajuste le chemin relatif ci-dessous. Si
    // c'est un domaine séparé, mets l'URL complète (ex. "https://admin.tondomaine.com").
    CENTRALE_BASE_URL: "https://ismaelfofana1998-cloud.github.io/IKMS/centrale/",
    // Token LocationIQ (données OpenStreetMap) — crée un compte gratuit sur
    // locationiq.com, palier gratuit 5000 requêtes/jour. Sans lui, la
    // géolocalisation garde les coordonnées GPS brutes mais l'autocomplétion
    // d'adresse reste désactivée.
    LOCATIONIQ_TOKEN: "pk.982bebb48e1dc80a391fc2bf97e262a4"
};
