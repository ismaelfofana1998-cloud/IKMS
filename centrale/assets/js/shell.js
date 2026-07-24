const ICONES = {
  "tableau-de-bord": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
  commandes: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>',
  ramassage: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8V21H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>',
  reception: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
  lots: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  retours: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
  caisse: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
  "ma-caisse": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
  zones: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  "clients-pro": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7h-9M14 17H5M17 21l4-4-4-4M7 3L3 7l4 4"/></svg>',
  ressources: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  "compte-entreprise": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>'
};

export const NAV_ITEMS = [
  { groupe: "Vue d'ensemble", id: "tableau-de-bord", label: "Tableau de bord", roles: ["agent", "admin", "super_admin"] },
  { groupe: "Flux", id: "commandes", label: "Commandes", roles: ["agent", "admin", "super_admin"] },
  { groupe: "Flux", id: "ramassage", label: "Ramassage", roles: ["agent", "admin", "super_admin"] },
  { groupe: "Flux", id: "reception", label: "Réception hub", roles: ["agent", "admin", "super_admin"] },
  { groupe: "Flux", id: "lots", label: "Lots & livraison", roles: ["agent", "admin", "super_admin"] },
  { groupe: "Flux", id: "retours", label: "Retours à traiter", roles: ["agent", "admin", "super_admin"] },
  { groupe: "Suivi", id: "ma-caisse", label: "Ma caisse", roles: ["agent"] },
  { groupe: "Suivi", id: "caisse", label: "Caisse", roles: ["admin", "super_admin"] },
  { groupe: "Administration", id: "zones", label: "Zones et tarifs", roles: ["agent", "admin", "super_admin"] },
  { groupe: "Administration", id: "clients-pro", label: "Clients pro", roles: ["admin", "super_admin"] },
  { groupe: "Administration", id: "ressources", label: "Ressources", roles: ["admin", "super_admin"] },
  { groupe: "Administration", id: "compte-entreprise", label: "Compte entreprise", roles: ["admin", "super_admin"] }
];

export function rendreSidebar(profil, ongletActif, compteurs = {}) {
  const items = NAV_ITEMS.filter((i) => i.roles.includes(profil.role));
  let groupePrecedent = null;
  const html = items.map((item) => {
    const enTeteGroupe = item.groupe !== groupePrecedent ? `<div class="sidebar-groupe">${item.groupe}</div>` : "";
    groupePrecedent = item.groupe;
    const n = compteurs[item.id] || 0;
    return `${enTeteGroupe}
      <button class="sidebar-lien" data-panel="${item.id}" aria-label="${item.label}" title="${item.label}" aria-current="${item.id === ongletActif}">
        ${ICONES[item.id] || ""}<span>${item.label}</span>
        ${n > 0 ? `<span class="sidebar-bulle">${n > 99 ? "99+" : n}</span>` : ""}
      </button>`;
  }).join("");
  document.querySelector("#sidebar-nav").innerHTML = html;
  document.querySelector("#pied-nom").textContent = profil.nom;
}

// ============================================================================
// Bandeau mobile inférieur -- même NAV_ITEMS, mêmes icônes, même clic
// délégué sur [data-panel] que la sidebar (voir app.js) : aucune logique de
// panneau dupliquée, seule la présentation change. Un bandeau ne peut pas
// afficher toutes les entrées comme une sidebar verticale -- les 4
// premières (déjà triées par priorité d'usage quotidien dans NAV_ITEMS)
// restent directement accessibles, le reste passe derrière "Plus".
// ============================================================================
export function rendreBarreMobile(profil, ongletActif, compteurs = {}) {
  const items = NAV_ITEMS.filter((i) => i.roles.includes(profil.role));
  const principaux = items.slice(0, 4);
  const reste = items.slice(4);

  const boutonHtml = (item) => {
    const n = compteurs[item.id] || 0;
    return `
      <button class="barre-mobile-lien" data-panel="${item.id}" aria-current="${item.id === ongletActif}">
        ${ICONES[item.id] || ""}
        <span>${item.label}</span>
        ${n > 0 ? `<span class="barre-mobile-bulle">${n > 99 ? "99+" : n}</span>` : ""}
      </button>`;
  };

  const activeDansLeReste = reste.some((i) => i.id === ongletActif);
  document.querySelector("#barre-mobile-liens").innerHTML = principaux.map(boutonHtml).join("") + (reste.length ? `
      <button class="barre-mobile-lien" id="btn-plus-mobile" type="button" aria-current="${activeDansLeReste}">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>
        <span>Plus</span>
      </button>` : "");

  if (!reste.length) return;
  let groupePrecedent = null;
  document.querySelector("#feuille-menu-mobile-liste").innerHTML = reste.map((item) => {
    const enTeteGroupe = item.groupe !== groupePrecedent ? `<div class="feuille-menu-groupe">${item.groupe}</div>` : "";
    groupePrecedent = item.groupe;
    const n = compteurs[item.id] || 0;
    return `${enTeteGroupe}
      <button class="feuille-menu-lien" data-panel="${item.id}" aria-current="${item.id === ongletActif}">
        ${ICONES[item.id] || ""}<span>${item.label}</span>
        ${n > 0 ? `<span class="sidebar-bulle">${n > 99 ? "99+" : n}</span>` : ""}
      </button>`;
  }).join("");
}
