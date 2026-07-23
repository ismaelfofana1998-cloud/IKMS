import { garantirAccesCentrale, deconnecterCentrale } from "./auth.js";
import { rendreSidebar, rendreBarreMobile, NAV_ITEMS } from "./shell.js";
import { compterActionsEnAttente, listerMesNotifications, compterNotificationsNonLues, marquerNotificationLue, marquerToutesNotificationsLues } from "./repository.js";
import { ouvrirModale, fermerModale, escapeHtml } from "./ui.js";

let profil = null;
let nettoyagePanneauActif = null;
let compteurs = {};
let minuterieFermetureMenu = null;

const PANNEAUX = {
  "tableau-de-bord": () => import("./panels/tableau-de-bord.js"),
  commandes: () => import("./panels/commande.js"),
  ramassage: () => import("./panels/ramassage.js"),
  reception: () => import("./panels/reception.js"),
  lots: () => import("./panels/lots.js"),
  retours: () => import("./panels/retours.js"),
  caisse: () => import("./panels/caisse.js"),
  "ma-caisse": () => import("./panels/ma-caisse.js"),
  zones: () => import("./panels/zones.js"),
  "clients-pro": () => import("./panels/clients-pro.js"),
  ressources: () => import("./panels/ressources.js"),
  "compte-entreprise": () => import("./panels/compte-entreprise.js")
};

async function monterPanneau(id) {
  const item = NAV_ITEMS.find((i) => i.id === id);
  if (!item || !item.roles.includes(profil.role)) {
    id = NAV_ITEMS.find((i) => i.roles.includes(profil.role))?.id || "commandes";
  }

  if (typeof nettoyagePanneauActif === "function") nettoyagePanneauActif();
  rendreSidebar(profil, id, compteurs);
  rendreBarreMobile(profil, id, compteurs);
  fermerFeuilleMenuMobile();

  const conteneur = document.querySelector("#contenu-panneau");
  const actions = document.querySelector("#actions-panneau");
  conteneur.innerHTML = `<div class="chargement-panneau">Chargement…</div>`;
  actions.innerHTML = "";

  try {
    const module = await PANNEAUX[id]();
    document.querySelector("#titre-panneau").textContent = module.titre || "";
    document.querySelector("#sous-titre-panneau").textContent = module.sousTitre || "";
    nettoyagePanneauActif = await module.monter(conteneur, actions, profil);
  } catch (err) {
    conteneur.innerHTML = `<div class="chargement-panneau">Une erreur est survenue en chargeant cet écran. Recharge la page.</div>`;
  }

  // Rejoue l'animation d'entrée à chaque changement de panneau : la classe
  // ne "redéclenche" une animation CSS que si on force un reflow entre le
  // retrait et la repose (sinon le navigateur voit la classe déjà présente
  // et ne rejoue rien au 2e passage sur le même onglet).
  conteneur.classList.remove("entree-contenu");
  void conteneur.offsetWidth;
  conteneur.classList.add("entree-contenu");
}

function idPanneauActif() {
  return (window.location.hash || "#tableau-de-bord").replace("#", "");
}

// Bulles de notification sur les onglets (ramassage/réception/retours en
// attente) : rafraîchies au démarrage puis toutes les 45s — assez réactif
// sans matraquer la base d'une requête par seconde.
async function rafraichirCompteurs() {
  try {
    compteurs = await compterActionsEnAttente(profil.role === "agent" ? profil.id_hub_affecte : null);
    rendreSidebar(profil, idPanneauActif(), compteurs);
    rendreBarreMobile(profil, idPanneauActif(), compteurs);
  } catch { /* silencieux : les bulles sont un confort, jamais bloquant */ }
}

window.addEventListener("hashchange", () => monterPanneau(idPanneauActif()));

document.addEventListener("click", (e) => {
  const bouton = e.target.closest("[data-panel]");
  if (bouton) window.location.hash = bouton.dataset.panel;
});

function ouvrirFeuilleMenuMobile() {
  const feuille = document.querySelector("#feuille-menu-mobile");
  clearTimeout(minuterieFermetureMenu);
  feuille.hidden = false;
  requestAnimationFrame(() => feuille.classList.add("ouverte"));
}
function fermerFeuilleMenuMobile() {
  const feuille = document.querySelector("#feuille-menu-mobile");
  feuille.classList.remove("ouverte");
  clearTimeout(minuterieFermetureMenu);
  minuterieFermetureMenu = setTimeout(() => { feuille.hidden = true; }, 200);
}
document.addEventListener("click", (e) => {
  if (e.target.closest("#btn-plus-mobile")) ouvrirFeuilleMenuMobile();
  else if (e.target.closest("#voile-menu-mobile")) fermerFeuilleMenuMobile();
});

document.querySelector("#btn-deconnexion").addEventListener("click", deconnecterCentrale);

function ouvrirNotificationsCentrale() {
  ouvrirModale(`
    <div class="entete-notif">
      <h2 style="margin:0;font-size:16px;">Notifications</h2>
      <button class="btn btn-discret btn-petit" id="btn-tout-lu-c">Tout marquer lu</button>
    </div>
    <div id="liste-notifs-c" style="padding:0;"><p style="padding:16px;">Chargement…</p></div>
  `, async (boite) => {
    boite.closest(".voile").classList.add("voile-notifications-centrale");
    boite.classList.add("boite-notifications-centrale");
    const notifs = await listerMesNotifications();
    boite.querySelector("#liste-notifs-c").innerHTML = notifs.length
      ? notifs.map((n) => `
          <div class="ligne-notif-c ${n.lu ? "" : "non-lue"}" data-id="${n.id}">
            ${escapeHtml(n.message)}
            <div class="date-notif-c">${new Date(n.cree_le).toLocaleString("fr-FR")}</div>
          </div>`).join("")
      : `<p style="padding:16px;color:var(--ink-soft);">Rien pour l'instant.</p>`;
    boite.querySelectorAll(".ligne-notif-c").forEach((el) => {
      el.addEventListener("click", async () => {
        if (el.classList.contains("non-lue")) {
          await marquerNotificationLue(el.dataset.id);
          el.classList.remove("non-lue");
          rafraichirCompteurNotificationsCentrale();
        }
      });
    });
    boite.querySelector("#btn-tout-lu-c").addEventListener("click", async () => {
      await marquerToutesNotificationsLues();
      boite.querySelectorAll(".ligne-notif-c").forEach((el) => el.classList.remove("non-lue"));
      rafraichirCompteurNotificationsCentrale();
    });
  });
}

async function rafraichirCompteurNotificationsCentrale() {
  const n = await compterNotificationsNonLues();
  const bulle = document.querySelector("#bulle-notifications");
  if (n > 0) { bulle.textContent = n > 99 ? "99+" : String(n); bulle.hidden = false; }
  else bulle.hidden = true;
}

document.querySelector("#btn-notifications").addEventListener("click", ouvrirNotificationsCentrale);

const sidebar = document.querySelector("#sidebar");
const peutSurvoler = window.matchMedia("(hover: hover) and (pointer: fine)");
function compacterSidebar() {
  if (peutSurvoler.matches && !sidebar.matches(":focus-within")) sidebar.classList.add("sidebar-compacte");
}
function deployerSidebar() {
  sidebar.classList.remove("sidebar-compacte");
}
sidebar.addEventListener("pointerenter", deployerSidebar);
sidebar.addEventListener("pointerleave", compacterSidebar);
sidebar.addEventListener("focusin", deployerSidebar);
sidebar.addEventListener("focusout", () => requestAnimationFrame(compacterSidebar));

(async function demarrer() {
  profil = await garantirAccesCentrale();
  if (!profil) return;
  await monterPanneau(idPanneauActif());
  rafraichirCompteurs();
  rafraichirCompteurNotificationsCentrale();
  setInterval(rafraichirCompteurs, 45000);
  setInterval(rafraichirCompteurNotificationsCentrale, 45000);
})();
