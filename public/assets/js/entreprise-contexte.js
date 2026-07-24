// ============================================================================
// entreprise-contexte.js
// Un seul endroit pour résoudre/mémoriser le code entreprise (?entreprise=
// dans l'URL) — utilisé par toutes les pages publiques (expedition,
// connexion/inscription/espace client, etc.) pour éviter d'avoir à copier
// une URL complète à chaque fois. Une fois visité une première fois via un
// lien complet, le code reste mémorisé sur cet appareil : toutes les pages
// suivantes fonctionnent même en tapant juste "client-espace.html" par
// exemple, sans le paramètre.
// ============================================================================

const CLE_STOCKAGE = "ikms_derniere_entreprise";
const DUREE_COOKIE_SECONDES = 60 * 60 * 24 * 365;

function lireCookieEntreprise() {
  try {
    const prefixe = `${encodeURIComponent(CLE_STOCKAGE)}=`;
    const cookie = document.cookie
      .split(";")
      .map((partie) => partie.trim())
      .find((partie) => partie.startsWith(prefixe));
    return cookie ? decodeURIComponent(cookie.slice(prefixe.length)) : "";
  } catch {
    return "";
  }
}

export function memoriserEntreprise(code) {
  if (!code) return;
  try { localStorage.setItem(CLE_STOCKAGE, code); } catch { /* pas bloquant */ }
  // Secours utile sur iOS : selon la façon dont le raccourci a été créé,
  // Safari et le mode écran d'accueil ne réutilisent pas toujours le même
  // localStorage. Le code entreprise n'est pas un secret ; un cookie
  // persistant permet donc de retrouver le tenant sans exposer de donnée
  // sensible.
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${encodeURIComponent(CLE_STOCKAGE)}=${encodeURIComponent(code)}; Max-Age=${DUREE_COOKIE_SECONDES}; Path=/; SameSite=Lax${secure}`;
  } catch { /* pas bloquant */ }
}

export function entrepriseMemorisee() {
  try {
    const codeLocal = localStorage.getItem(CLE_STOCKAGE) || "";
    return codeLocal || lireCookieEntreprise();
  } catch {
    return lireCookieEntreprise();
  }
}

// À appeler en haut de chaque page : lit l'URL en priorité, retombe sur la
// mémoire de l'appareil sinon, et mémorise pour la prochaine fois.
export function resoudreCodeEntreprise() {
  const params = new URLSearchParams(window.location.search);
  const code = String(params.get("entreprise") || params.get("code") || "").trim().toUpperCase();
  if (code) { memoriserEntreprise(code); return code; }
  return entrepriseMemorisee();
}

// Construit un lien vers une autre page publique en conservant le code
// entreprise — jamais besoin de le reconstruire à la main.
export function lienPage(page, code) {
  return `./${page}?entreprise=${encodeURIComponent(code || entrepriseMemorisee())}`;
}

// Traduit les messages d'erreur techniques les plus courants (Supabase Auth,
// réseau) en quelque chose de compréhensible -- utilisé partout où on se
// connecte/inscrit (client-connexion, client-inscription, expediteur).
export function traduireErreurAuth(message) {
  if (message === "Invalid login credentials") return "Téléphone ou mot de passe incorrect.";
  if (message === "Failed to fetch" || message?.includes("NetworkError") || message?.includes("fetch")) {
    return "Impossible de joindre le serveur. Vérifie ta connexion internet, ou réessaie dans un instant — si ça persiste, le service est peut-être temporairement indisponible.";
  }
  return message || "Une erreur est survenue.";
}
