// ============================================================================
// Géocodage et autocomplétion d'adresse — LocationIQ (données OpenStreetMap).
//
// IMPORTANT, pourquoi ce n'est pas l'API publique Nominatim directement :
// la politique d'usage de Nominatim (operations.osmfoundation.org/policies/
// nominatim) interdit explicitement l'autocompletion "as you type" sur son
// API publique — implémenter ça côté client sur nominatim.openstreetmap.org
// est listé noir sur blanc comme un usage strictement interdit, bannissable.
// LocationIQ résout ça : mêmes données OpenStreetMap (donc la même
// couverture détaillée d'Abidjan), mais un vrai contrat commercial dont
// l'autocomplétion est un usage explicitement prévu et autorisé, avec un
// palier gratuit confortable (5000 requêtes/jour) largement suffisant pour
// démarrer.
//
// Le token (LOCATIONIQ_TOKEN dans config.public.js) est fait pour tourner
// côté navigateur (LocationIQ déconseille même les restrictions par IP pour
// ce cas d'usage, puisque les requêtes partent du téléphone de la personne,
// pas de ton serveur) — comme la clé anon Supabase, la maîtrise des coûts se
// fait via les quotas du compte, pas en cachant le token.
//
// Si LOCATIONIQ_TOKEN n'est pas encore renseigné, toutes les fonctions se
// dégradent en douceur (aucune suggestion, mais la saisie manuelle et les
// coordonnées GPS brutes restent toujours disponibles).
// ============================================================================

const ABIDJAN_VIEWBOX = "-4.20,5.55,-3.75,5.05"; // left,top,right,bottom (compatible Nominatim/LocationIQ)

function tokenLocationIQ() {
  return window.APP_CONFIG?.LOCATIONIQ_TOKEN || "";
}

export function debounce(fn, delaiMs) {
  let handle;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), delaiMs);
  };
}

export async function rechercherAdresses(texte) {
  const token = tokenLocationIQ();
  if (!token || !texte || texte.trim().length < 3) return [];
  try {
    const url = `https://api.locationiq.com/v1/autocomplete?key=${token}` +
      `&q=${encodeURIComponent(texte)}&countrycodes=ci&viewbox=${ABIDJAN_VIEWBOX}&bounded=1&limit=5&accept-language=fr&addressdetails=1`;
    const reponse = await fetch(url);
    if (!reponse.ok) return [];
    const resultats = await reponse.json();
    return (Array.isArray(resultats) ? resultats : []).map((r) => ({
      label: r.display_name,
      lat: Number(r.lat),
      lon: Number(r.lon),
      // Commune/quartier détecté, pour suggérer une zone tarifaire (voir
      // deviserZone()) -- le classement OSM des quartiers est reconnu
      // inconsistant d'une région à l'autre (documentation Nominatim
      // elle-même), donc on vérifie large plutôt que de parier sur UN
      // champ précis. "label" (l'adresse complète) sert de filet de
      // sécurité supplémentaire dans deviserZone().
      commune: r.address?.suburb || r.address?.city_district || r.address?.neighbourhood
        || r.address?.borough || r.address?.quarter || r.address?.town || r.address?.village
        || r.address?.municipality || r.address?.city || null
    })).filter((r) => r.label && !Number.isNaN(r.lat) && !Number.isNaN(r.lon));
  } catch {
    return [];
  }
}

export async function geocoderInverse(lat, lon) {
  const token = tokenLocationIQ();
  if (!token) return null;
  try {
    const url = `https://api.locationiq.com/v1/reverse?key=${token}&lat=${lat}&lon=${lon}&format=json&accept-language=fr&addressdetails=1`;
    const reponse = await fetch(url);
    if (!reponse.ok) return null;
    const resultat = await reponse.json();
    return {
      label: resultat?.display_name || null,
      commune: resultat?.address?.suburb || resultat?.address?.city_district || resultat?.address?.neighbourhood
        || resultat?.address?.borough || resultat?.address?.quarter || resultat?.address?.town || resultat?.address?.village
        || resultat?.address?.municipality || resultat?.address?.city || null
    };
  } catch {
    return null;
  }
}

// Référentiel texte volontairement petit et local : il ne déclenche aucun
// appel réseau et ne stocke aucun polygone. Il sert surtout à reconnaître
// qu'une adresse mentionne explicitement une AUTRE commune, même lorsque le
// tenant ne livre pas cette commune et ne l'a donc pas créée dans ses zones.
const COMMUNES_ABIDJAN = [
  "Abobo", "Adjamé", "Anyama", "Attécoubé", "Bingerville", "Cocody",
  "Koumassi", "Marcory", "Plateau", "Port-Bouët", "Songon", "Treichville",
  "Yopougon"
];

function normaliserTexteZone(texte) {
  return (texte || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function contientExpression(texteNormalise, expression) {
  const cible = normaliserTexteZone(expression);
  return !!cible && ` ${texteNormalise} `.includes(` ${cible} `);
}

// Devine la zone en respectant strictement la hiérarchie :
//   1. reconnaître la commune ;
//   2. chercher le secteur uniquement parmi les zones de cette commune.
//
// Un même mot peut exister dans plusieurs communes (ex. "Sicogi"). Il ne
// doit donc jamais permettre à lui seul de contredire une commune explicite
// dans l'adresse. Si la commune ou le secteur reste ambigu, on renvoie null :
// l'appelant affiche alors une alerte et demande une confirmation humaine.
export function deviserZone(commune, zonesDisponibles, labelComplet) {
  if (!commune && !labelComplet) return null;
  const communeNorm = normaliserTexteZone(commune);
  const labelNorm = normaliserTexteZone(labelComplet);
  const zones = Array.isArray(zonesDisponibles) ? zonesDisponibles : [];

  const nomCommune = (zone) => zone.nom_commune || zone.secteur || zone.code_zone;
  const nomsCommunes = [...new Set(zones.map(nomCommune).filter(Boolean))];
  const communesDans = (texte) => nomsCommunes.filter((nom) => contientExpression(texte, nom));
  const communesReferenceDans = (texte) =>
    COMMUNES_ABIDJAN.filter((nom) => contientExpression(texte, nom));

  // Le champ structuré du géocodeur est prioritaire seulement lorsqu'il
  // contient réellement une commune. Il contient parfois un quartier
  // ("Sicogi"), d'où le repli sur le libellé complet.
  let communesDetectees = communesReferenceDans(communeNorm);
  if (communesDetectees.length === 0) communesDetectees = communesReferenceDans(labelNorm);

  let communeChoisie = null;
  if (communesDetectees.length === 1) {
    const communeReference = normaliserTexteZone(communesDetectees[0]);
    communeChoisie = nomsCommunes.find(
      (nom) => normaliserTexteZone(nom) === communeReference
    ) || null;

    // Une commune administrative est bien détectée, mais elle n'existe pas
    // dans les zones du tenant : l'adresse est hors zone connue. Surtout, ne
    // pas la rattacher à une autre commune via un secteur homonyme.
    if (!communeChoisie) return null;
  } else if (communesDetectees.length > 1) {
    return null;
  } else {
    let candidatesCommune = communesDans(communeNorm);
    if (candidatesCommune.length === 0) candidatesCommune = communesDans(labelNorm);
    if (candidatesCommune.length === 1) communeChoisie = candidatesCommune[0];
    else if (candidatesCommune.length > 1) return null;
  }

  // Un secteur, même unique chez ce tenant, ne prouve jamais sa commune.
  // Exemple : "PK18" peut désigner Abobo ou Bingerville. Sans commune dans
  // les données textuelles OSM, on préfère une alerte à une validation
  // silencieuse potentiellement fausse.
  if (!communeChoisie) return null;

  const candidates = zones.filter(
    (zone) => normaliserTexteZone(nomCommune(zone)) === normaliserTexteZone(communeChoisie)
  );

  const correspondAuSecteur = (zone) =>
    contientExpression(communeNorm, zone.secteur)
    || contientExpression(labelNorm, zone.secteur)
    || (zone.mots_cles || []).some((mot) =>
      contientExpression(communeNorm, mot) || contientExpression(labelNorm, mot)
    );

  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const seuleZone = candidates[0];
    const couvreTouteLaCommune = communeChoisie
      && normaliserTexteZone(seuleZone.secteur) === normaliserTexteZone(communeChoisie)
      && (seuleZone.mots_cles || []).length === 0;
    return (couvreTouteLaCommune || correspondAuSecteur(seuleZone))
      ? seuleZone.code_zone
      : null;
  }

  const secteursPrecis = candidates.filter(correspondAuSecteur);
  return secteursPrecis.length === 1 ? secteursPrecis[0].code_zone : null;
}

// Construit le HTML d'un sélecteur de zone à deux niveaux : la commune
// (le "gros morceau", ce que le client reconnaît) d'abord, puis -- seulement
// si cette commune a plusieurs sous-zones définies -- un second select qui
// apparaît juste en dessous, sans changer d'écran. La valeur réellement
// utilisée par le reste du code (id_cache) reste un simple champ caché,
// pour que rien d'autre n'ait à changer : tout ce qui lisait déjà
// `document.querySelector("#zone-depart").value` continue de marcher tel
// quel, peu importe combien de niveaux de sélection il y a eu derrière.
// Un seul <select> qui change de contenu avec un fondu -- pas une seconde
// ligne qui apparaît en dessous. D'abord les communes ; dès qu'on en choisit
// une qui a plusieurs secteurs, le MÊME menu se vide en fondu et se
// remplit avec ses secteurs, avec juste un petit lien pour revenir en
// arrière si besoin. Le niveau actuel ("commune" ou "secteur") vit sur le
// conteneur lui-même (data-niveau), pas dans une fermeture JS -- pour que
// definirZoneSelectionnee() (auto-suggestion) et les clics de la personne
// restent toujours d'accord sur ce que représente la valeur choisie.
export function construireSelecteurZoneHtml(idCache, classeCache) {
  return `
    <select class="commune-select"><option value="">Chargement des zones…</option></select>
    <select class="secteur-select" hidden></select>
    <input type="hidden" ${idCache ? `id="${idCache}"` : ""} class="${classeCache || ""}">
  `;
}

function nomCommuneDeZone(z) {
  return z.nom_commune || z.secteur || z.code_zone;
}

export function brancherSelecteurZone(conteneurEl, zones) {
  const selectCommune = conteneurEl.querySelector(".commune-select");
  const selectSecteur = conteneurEl.querySelector(".secteur-select");
  const champCache = conteneurEl.querySelector("input[type=hidden]");
  const communes = [...new Set(zones.map(nomCommuneDeZone))].sort((a, b) => a.localeCompare(b, "fr"));

  selectCommune.innerHTML = `<option value="">Choisir la commune…</option>` +
    communes.map((c) => `<option value="${escapeHtmlLocal(c)}">${escapeHtmlLocal(c)}</option>`).join("");

  function definirValeur(codeZone) {
    champCache.value = codeZone || "";
    champCache.dispatchEvent(new Event("change", { bubbles: true }));
  }

  selectCommune.addEventListener("change", () => {
    const commune = selectCommune.value;
    // Repart TOUJOURS de zéro ici, avant même de savoir si la nouvelle
    // commune a plusieurs secteurs -- un secteur choisi pour une commune
    // précédente ne doit jamais rester affiché ni sélectionné pour la
    // nouvelle (c'était le bug signalé : vider seulement la valeur cachée
    // ne suffit pas, il faut aussi reconstruire les options du select).
    selectSecteur.innerHTML = "";
    selectSecteur.hidden = true;
    definirValeur("");
    if (!commune) return;

    const zonesCommune = zones.filter((z) => nomCommuneDeZone(z) === commune);
    if (zonesCommune.length <= 1) {
      // Commune non découpée : une seule zone derrière, on la choisit
      // directement, exactement comme avant l'introduction des secteurs.
      definirValeur(zonesCommune[0]?.code_zone || "");
      return;
    }
    // Plusieurs secteurs : le second menu apparaît tout de suite en
    // dessous, dans le même écran -- jamais de choix par défaut, on force
    // une sélection explicite plutôt que de deviner laquelle est la bonne.
    selectSecteur.innerHTML = `<option value="">Choisir le secteur…</option>` +
      zonesCommune.map((z) => `<option value="${z.code_zone}">${escapeHtmlLocal(z.secteur || z.code_zone)}</option>`).join("");
    selectSecteur.hidden = false;
  });

  selectSecteur.addEventListener("change", () => definirValeur(selectSecteur.value));
}

// Définit programmatiquement le sélecteur à partir d'un code_zone déjà
// résolu (ex. par deviserZone) -- utile pour l'auto-suggestion : positionne
// la commune et affiche directement le bon secteur si elle en a plusieurs,
// sans action de la personne. Ne fait rien si le code_zone n'existe pas
// dans zones -- l'appelant garde alors l'état précédent du sélecteur.
export function definirZoneSelectionnee(conteneurEl, codeZone, zones) {
  const zone = zones.find((z) => z.code_zone === codeZone);
  if (!zone) return;
  const selectCommune = conteneurEl.querySelector(".commune-select");
  const selectSecteur = conteneurEl.querySelector(".secteur-select");
  const champCache = conteneurEl.querySelector("input[type=hidden]");
  const nomCommune = nomCommuneDeZone(zone);
  const zonesCommune = zones.filter((z) => nomCommuneDeZone(z) === nomCommune);
  selectCommune.value = nomCommune;
  if (zonesCommune.length <= 1) {
    selectSecteur.innerHTML = "";
    selectSecteur.hidden = true;
  } else {
    selectSecteur.innerHTML = `<option value="">Choisir le secteur…</option>` +
      zonesCommune.map((z) => `<option value="${z.code_zone}" ${z.code_zone === codeZone ? "selected" : ""}>${escapeHtmlLocal(z.secteur || z.code_zone)}</option>`).join("");
    selectSecteur.hidden = false;
  }
  champCache.value = codeZone;
  champCache.dispatchEvent(new Event("change", { bubbles: true }));
}

// Géolocalise l'appareil et remplit le champ adresse (avec repli sur les
// coordonnées brutes si la conversion en adresse lisible échoue).
export function localiserMoi(boutonEl, champInputEl, onLocalise) {
  const placeholderInitial = champInputEl.placeholder;
  if (!navigator.geolocation) {
    champInputEl.placeholder = "Géolocalisation indisponible sur cet appareil";
    return;
  }
  boutonEl.disabled = true;
  boutonEl.dataset.etat = "chargement";
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      const resultat = await geocoderInverse(latitude, longitude);
      champInputEl.value = resultat?.label || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      onLocalise?.({ lat: latitude, lng: longitude, commune: resultat?.commune || null, label: resultat?.label || null });
      boutonEl.disabled = false;
      boutonEl.dataset.etat = "succes";
      setTimeout(() => { delete boutonEl.dataset.etat; }, 1600);
    },
    () => {
      boutonEl.disabled = false;
      delete boutonEl.dataset.etat;
      champInputEl.placeholder = "Position refusée — saisis ton adresse";
      setTimeout(() => { champInputEl.placeholder = placeholderInitial; }, 3000);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// Version silencieuse de localiserMoi : n'écrit JAMAIS dans le champ
// adresse -- sert uniquement à obtenir une position pour comparer une zone
// déjà choisie, quand l'adresse est déjà connue (compte connecté, mémoire)
// et ne doit surtout pas être écrasée. Échec, refus, ou navigateur sans
// géolocalisation : silencieux -- pas d'alerte plutôt qu'une alerte fausse,
// jamais de bouton à faire échouer puisqu'il n'y en a pas ici.
export function localiserSilencieusement(onLocalise) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      const resultat = await geocoderInverse(latitude, longitude);
      onLocalise?.({ lat: latitude, lng: longitude, commune: resultat?.commune || null, label: resultat?.label || null });
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// Branche un champ adresse texte sur l'autocomplétion : une liste de
// suggestions cliquables apparaît sous le champ pendant la saisie.
// Positionne la liste de suggestions ANCREE au champ, en `position: fixed`
// calculé depuis sa position réelle à l'écran -- jamais laissée dans le flux
// normal de la page. Deux raisons : (1) sur mobile, le clavier virtuel
// réduit la zone visible (visualViewport, PAS innerHeight qui souvent ne
// bouge pas) -- une liste en flux normal atterrit sous cette zone,
// invisible ; (2) si le champ est dans une modale ou une carte avec un CSS
// transform, `position: fixed` redevient relatif à cet ancêtre plutôt qu'à
// l'écran -- déplacer l'élément en enfant direct de <body> élimine ce
// risque une fois pour toutes, quel que soit l'endroit du formulaire d'où
// l'autocomplétion est appelée.
function positionnerSuggestions(champInputEl, listeSuggestionsEl) {
  if (listeSuggestionsEl.parentElement !== document.body) document.body.appendChild(listeSuggestionsEl);
  const rect = champInputEl.getBoundingClientRect();
  const hauteurVisible = window.visualViewport?.height || window.innerHeight;
  const marge = 6;
  const espaceEnDessous = hauteurVisible - rect.bottom - marge;
  const espaceAuDessus = rect.top - marge;

  listeSuggestionsEl.style.position = "fixed";
  listeSuggestionsEl.style.left = `${rect.left}px`;
  listeSuggestionsEl.style.width = `${rect.width}px`;
  listeSuggestionsEl.style.overflowY = "auto";

  // Bascule au-dessus du champ si la place en dessous est trop réduite
  // (typiquement le clavier virtuel) et qu'il y a réellement plus de place
  // au-dessus -- jamais une liste à moitié invisible sous le clavier.
  if (espaceEnDessous < 160 && espaceAuDessus > espaceEnDessous) {
    listeSuggestionsEl.style.top = "";
    listeSuggestionsEl.style.bottom = `${hauteurVisible - rect.top + marge}px`;
    listeSuggestionsEl.style.maxHeight = `${Math.max(120, espaceAuDessus)}px`;
  } else {
    listeSuggestionsEl.style.bottom = "";
    listeSuggestionsEl.style.top = `${rect.bottom + marge}px`;
    listeSuggestionsEl.style.maxHeight = `${Math.max(120, espaceEnDessous)}px`;
  }
}

export function brancherAutocompletion(champInputEl, listeSuggestionsEl, onChoix) {
  const rechercheDebattue = debounce(async (texte) => {
    const resultats = await rechercherAdresses(texte);
    if (!resultats.length) { listeSuggestionsEl.innerHTML = ""; listeSuggestionsEl.hidden = true; return; }
    listeSuggestionsEl.innerHTML = resultats.map((r, i) =>
      `<button type="button" class="suggestion-adresse" data-index="${i}">${escapeHtmlLocal(r.label)}</button>`
    ).join("");
    listeSuggestionsEl.hidden = false;
    positionnerSuggestions(champInputEl, listeSuggestionsEl);
    listeSuggestionsEl.querySelectorAll("[data-index]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = resultats[Number(btn.dataset.index)];
        champInputEl.value = r.label;
        listeSuggestionsEl.innerHTML = "";
        listeSuggestionsEl.hidden = true;
        onChoix?.({ lat: r.lat, lng: r.lon, commune: r.commune || null, label: r.label || null });
      });
    });
  }, 400);

  // Reste ancrée au bon endroit si le clavier s'ouvre/se ferme (ou si la
  // page défile) pendant que la liste est déjà affichée.
  window.visualViewport?.addEventListener("resize", () => {
    if (!listeSuggestionsEl.hidden) positionnerSuggestions(champInputEl, listeSuggestionsEl);
  });

  champInputEl.addEventListener("input", () => {
    onChoix?.(null); // l'adresse est retapée à la main : on ne garde plus un GPS obsolète
    rechercheDebattue(champInputEl.value);
  });
  champInputEl.addEventListener("blur", () => {
    setTimeout(() => { listeSuggestionsEl.hidden = true; }, 150); // laisse le clic sur une suggestion aboutir
  });
}

function escapeHtmlLocal(texte) {
  const div = document.createElement("div");
  div.textContent = String(texte ?? "");
  return div.innerHTML;
}
