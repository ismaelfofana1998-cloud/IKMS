// Rien à charger depuis Supabase ici -- une landing page marketing n'a pas
// besoin de données dynamiques. Seul le lien "Se connecter" dépend de la
// configuration (l'espace centrale peut être sur un domaine séparé).
const urlConnexion = `${window.APP_CONFIG?.CENTRALE_BASE_URL || "."}/index.html`;
document.querySelector("#lien-connexion").href = urlConnexion;
document.querySelector("#lien-connexion-final").href = urlConnexion;
