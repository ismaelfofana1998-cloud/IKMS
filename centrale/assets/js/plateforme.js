import { garantirAccesCentrale, deconnecterCentrale } from "./auth.js";
import {
  listerEntreprises, creerEntreprise, desactiverEntreprise, reactiverEntreprise, definirEssai, creerUtilisateur,
  lireParametresPlateforme, definirParametrePlateforme, uploaderImagePlateforme, supprimerImagePlateforme,
  urlImagePlateforme, listerFichiersPlateforme
} from "./repository.js";
import { afficherFlash, escapeHtml, ouvrirModale, fermerModale } from "./ui.js";

const conteneur = document.querySelector("#contenu-panneau");
const actionsContainer = document.querySelector("#actions-panneau");
let ongletActif = "ENTREPRISES";

(async () => {
  const profil = await garantirAccesCentrale();
  if (!profil) return;

  // Cette page n'est pas juste "un panneau de plus" : elle représente
  // l'éditeur du logiciel, pas une entreprise cliente (même IKIGAI Livraison
  // n'y a pas sa place en tant que telle). Réservée au rôle super_admin —
  // un admin/agent d'une entreprise cliente est renvoyé vers son espace.
  if (profil.role !== "super_admin") {
    alert("Cette page est réservée au super-admin (l'éditeur du logiciel). Tu es redirigé vers ton espace centrale.");
    window.location.href = "./centrale.html";
    return;
  }

  document.querySelector("#topbar-nom").textContent = profil.nom || "Super admin";
  document.querySelector("#btn-deconnexion").addEventListener("click", deconnecterCentrale);

  document.querySelectorAll("#onglets-plateforme [data-onglet]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.onglet === ongletActif) return;
      ongletActif = btn.dataset.onglet;
      document.querySelectorAll("#onglets-plateforme [data-onglet]").forEach((b) => b.setAttribute("aria-current", String(b === btn)));
      afficherOngletActif();
    });
  });

  async function afficherOngletActif() {
    if (ongletActif === "ENTREPRISES") {
      document.querySelector("#titre-panneau").textContent = "Entreprises clientes";
      document.querySelector("#sous-titre-panneau").textContent = "Onboarding des sociétés qui utilisent IKMS en tant que plateforme SaaS.";
      await rafraichirEntreprises();
    } else {
      document.querySelector("#titre-panneau").textContent = "Personnaliser la page d'inscription";
      document.querySelector("#sous-titre-panneau").textContent = "Modifie les slogans, les couleurs et la photo — l'aperçu se met à jour en direct, avant même d'enregistrer.";
      await rafraichirPersonnalisation();
    }
  }

  async function rafraichirEntreprises() {
    actionsContainer.innerHTML = `<button class="btn btn-primaire" id="btn-nouvelle-entreprise">+ Nouvelle entreprise</button>`;
    actionsContainer.querySelector("#btn-nouvelle-entreprise").addEventListener("click", ouvrirFormulaire);
    const entreprises = await listerEntreprises();
    conteneur.innerHTML = `
      <div class="bloc-tableau">
        ${entreprises.length ? `
          <table class="donnees">
            <thead><tr><th>Code</th><th>Nom</th><th>Utilisateurs</th><th>Commandes</th><th>Abonnement</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              ${entreprises.map((e) => `
                <tr>
                  <td class="cellule-donnee">${escapeHtml(e.code_entreprise)}</td>
                  <td>${escapeHtml(e.nom)}</td>
                  <td class="cellule-donnee">${e.nb_utilisateurs}</td>
                  <td class="cellule-donnee">${e.nb_commandes}</td>
                  <td>${libelleEssai(e.essai_expire_le)}</td>
                  <td>${e.actif ? '<span class="tampon valide">Active</span>' : '<span class="tampon alerte">Désactivée</span>'}</td>
                  <td class="cellule-actions">
                    <button class="btn btn-discret btn-petit" data-utilisateur="${e.id_entreprise}">+ Utilisateur</button>
                    <button class="btn btn-discret btn-petit" data-abonnement="${e.id_entreprise}">Abonnement</button>
                    ${e.actif
                      ? `<button class="btn btn-alerte btn-petit" data-desactiver="${e.id_entreprise}">Désactiver</button>`
                      : `<button class="btn btn-discret btn-petit" data-reactiver="${e.id_entreprise}">Réactiver</button>`}
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="etat-vide-tableau">Aucune entreprise pour le moment.</div>`}
      </div>`;

    conteneur.querySelectorAll("[data-desactiver]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Désactiver cette entreprise ? Ses utilisateurs ne pourront plus se connecter.")) return;
        const r = await desactiverEntreprise(btn.dataset.desactiver);
        if (r.ok) { afficherFlash("Entreprise désactivée"); rafraichirEntreprises(); } else afficherFlash(r.message, true);
      });
    });
    conteneur.querySelectorAll("[data-reactiver]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const r = await reactiverEntreprise(btn.dataset.reactiver);
        if (r.ok) { afficherFlash("Entreprise réactivée"); rafraichirEntreprises(); } else afficherFlash(r.message, true);
      });
    });
    conteneur.querySelectorAll("[data-utilisateur]").forEach((btn) => {
      btn.addEventListener("click", () => ouvrirFormulaireUtilisateur(btn.dataset.utilisateur, entreprises.find((e) => e.id_entreprise === btn.dataset.utilisateur)));
    });
    conteneur.querySelectorAll("[data-abonnement]").forEach((btn) => {
      btn.addEventListener("click", () => ouvrirFormulaireAbonnement(btn.dataset.abonnement, entreprises.find((e) => e.id_entreprise === btn.dataset.abonnement)));
    });
  }

  // --------------------------------------------------------------------
  // Personnaliser la page d'inscription entreprise. L'aperçu à droite
  // n'est pas un iframe de la vraie page (elle vit dans l'app publique,
  // sur un autre domaine) -- c'est une reproduction fidèle du même CSS
  // (hero-kinetique, hero-titre...), avec les couleurs en variables CSS
  // locales : chaque frappe/changement de couleur se voit immédiatement,
  // avant même d'enregistrer quoi que ce soit.
  // --------------------------------------------------------------------
  async function rafraichirPersonnalisation() {
    actionsContainer.innerHTML = "";
    const [params, fichiers] = await Promise.all([lireParametresPlateforme(), listerFichiersPlateforme()]);
    const aPhoto = fichiers.includes("hero.webp");
    const val = (cle, defaut) => params[cle] ?? defaut;

    const DEFAUT_PRINCIPAL = "La logistique de\nton entreprise, blindée.";
    const DEFAUT_SECONDAIRE = "Zones, tarifs, livreurs, paiements, comptes clients — une seule plateforme pour piloter toute ton opération de livraison.";
    const DEFAUT_TITRE_FORM = "Créer ton compte entreprise";
    const DEFAUT_SOUS_FORM = "Rejoins IKMS et digitalise ton opération de livraison en quelques minutes.";
    const DEFAUT_FOND = "#12171B";
    const DEFAUT_ACCENT = "#E6AC3D";

    conteneur.innerHTML = `
      <div class="colonnes-personnalisation-plateforme">
        <div class="bloc-tableau">
          <div class="tableau-titre">Édition</div>
          <div class="formulaire" style="padding:14px;">
            <div class="champ">
              <label>Slogan principal (grand titre)</label>
              <textarea id="pp-slogan-principal" rows="2">${escapeHtml(val("slogan_principal", DEFAUT_PRINCIPAL))}</textarea>
            </div>
            <div class="champ">
              <label>Phrase secondaire</label>
              <textarea id="pp-slogan-secondaire" rows="2">${escapeHtml(val("slogan_secondaire", DEFAUT_SECONDAIRE))}</textarea>
            </div>
            <div class="champ"><label>Titre du formulaire</label><input id="pp-titre-form" value="${escapeHtml(val("titre_formulaire", DEFAUT_TITRE_FORM))}"></div>
            <div class="champ"><label>Phrase sous le titre du formulaire</label><input id="pp-sous-form" value="${escapeHtml(val("sous_titre_formulaire", DEFAUT_SOUS_FORM))}"></div>
            <div style="display:flex;gap:16px;">
              <div class="champ"><label>Couleur de fond</label><input type="color" id="pp-couleur-fond" value="${val("couleur_fond", DEFAUT_FOND)}"></div>
              <div class="champ"><label>Couleur d'accent</label><input type="color" id="pp-couleur-accent" value="${val("couleur_accent", DEFAUT_ACCENT)}"></div>
            </div>
            <div class="champ">
              <label>Photo de fond (optionnelle)</label>
              <label class="btn btn-discret btn-petit bouton-fichier" style="display:inline-flex;">
                📷 ${aPhoto ? "Changer la photo" : "Ajouter une photo"}
                <input type="file" accept="image/webp,image/jpeg,image/png" id="pp-fichier-photo" hidden>
              </label>
              ${aPhoto ? `<button class="btn btn-discret btn-petit" id="pp-retirer-photo" style="margin-left:8px;">Retirer</button>` : ""}
              <p class="sous-titre" style="margin-top:6px;">WebP/JPEG/PNG, moins de 2 Mo.</p>
            </div>
          </div>
          <div class="actions-bas" style="padding:0 14px 14px;">
            <button class="btn btn-primaire" id="pp-enregistrer">Enregistrer les modifications</button>
          </div>
        </div>

        <div class="apercu-inscription-conteneur">
          <div class="tableau-titre" style="margin-bottom:10px;">Aperçu en direct</div>
          <div class="apercu-inscription" id="apercu-hero">
            <div class="apercu-hero-lueur apercu-hero-lueur-une" aria-hidden="true"></div>
            <div class="apercu-hero-lueur apercu-hero-lueur-deux" aria-hidden="true"></div>
            <div class="apercu-inscription-corps">
              <div class="apercu-hero-marque">IKMS <span>Ikigai Mobility Software</span></div>
              <p class="apercu-hero-sur-titre">Plateforme SaaS pour la logistique</p>
              <h1 class="apercu-hero-titre" id="ap-titre"></h1>
              <p class="apercu-hero-sous" id="ap-sous"></p>
              <div class="apercu-hero-preuves">
                <span>✓ Zones &amp; tarifs modulables</span>
                <span>✓ Paiement Wave intégré</span>
                <span>✓ Multi-hub prêt à l'emploi</span>
              </div>
            </div>
          </div>
          <div class="apercu-entete-form">
            <h2 id="ap-titre-form"></h2>
            <p id="ap-sous-form"></p>
          </div>
        </div>
      </div>
    `;

    const champTitre = conteneur.querySelector("#pp-slogan-principal");
    const champSous = conteneur.querySelector("#pp-slogan-secondaire");
    const champTitreForm = conteneur.querySelector("#pp-titre-form");
    const champSousForm = conteneur.querySelector("#pp-sous-form");
    const champFond = conteneur.querySelector("#pp-couleur-fond");
    const champAccent = conteneur.querySelector("#pp-couleur-accent");
    const apercuHero = conteneur.querySelector("#apercu-hero");

    function rafraichirApercu() {
      conteneur.querySelector("#ap-titre").innerHTML = escapeHtml(champTitre.value).replace(/\n/g, "<br>");
      conteneur.querySelector("#ap-sous").textContent = champSous.value;
      conteneur.querySelector("#ap-titre-form").textContent = champTitreForm.value;
      conteneur.querySelector("#ap-sous-form").textContent = champSousForm.value;
      apercuHero.style.setProperty("--apercu-fond", champFond.value);
      apercuHero.style.setProperty("--apercu-accent", champAccent.value);
    }
    [champTitre, champSous, champTitreForm, champSousForm].forEach((el) => el.addEventListener("input", rafraichirApercu));
    [champFond, champAccent].forEach((el) => el.addEventListener("input", rafraichirApercu));
    if (aPhoto) {
      apercuHero.style.backgroundImage = `linear-gradient(165deg, rgba(18,23,27,0.55) 0%, rgba(18,23,27,0.25) 100%), url('${urlImagePlateforme()}?t=${Date.now()}')`;
    }
    rafraichirApercu();

    conteneur.querySelector("#pp-fichier-photo").addEventListener("change", async (e) => {
      const fichier = e.target.files[0];
      if (!fichier) return;
      if (fichier.size > 2 * 1024 * 1024) { afficherFlash("Image trop lourde (max 2 Mo).", true); e.target.value = ""; return; }
      // Aperçu immédiat avant même la fin de l'upload.
      apercuHero.style.backgroundImage = `linear-gradient(165deg, rgba(18,23,27,0.55) 0%, rgba(18,23,27,0.25) 100%), url('${URL.createObjectURL(fichier)}')`;
      const r = await uploaderImagePlateforme(fichier);
      if (r.ok) { afficherFlash("Photo mise à jour"); rafraichirPersonnalisation(); }
      else afficherFlash(r.message, true);
    });

    conteneur.querySelector("#pp-retirer-photo")?.addEventListener("click", async () => {
      if (!confirm("Retirer la photo de fond ?")) return;
      const r = await supprimerImagePlateforme();
      if (r.ok) { afficherFlash("Photo retirée"); rafraichirPersonnalisation(); }
      else afficherFlash(r.message, true);
    });

    conteneur.querySelector("#pp-enregistrer").addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = "Enregistrement…";
      const resultats = await Promise.all([
        definirParametrePlateforme("slogan_principal", champTitre.value.trim()),
        definirParametrePlateforme("slogan_secondaire", champSous.value.trim()),
        definirParametrePlateforme("titre_formulaire", champTitreForm.value.trim()),
        definirParametrePlateforme("sous_titre_formulaire", champSousForm.value.trim()),
        definirParametrePlateforme("couleur_fond", champFond.value),
        definirParametrePlateforme("couleur_accent", champAccent.value)
      ]);
      if (resultats.every((r) => r.ok)) afficherFlash("Personnalisation enregistrée — visible immédiatement sur la page d'inscription.");
      else afficherFlash("Certains champs n'ont pas pu être enregistrés.", true);
      e.target.disabled = false;
      e.target.textContent = "Enregistrer les modifications";
    });
  }

  function libelleEssai(essaiExpireLe) {
    if (!essaiExpireLe) return `<span class="tampon valide">Plan payant</span>`;
    const joursRestants = Math.ceil((new Date(essaiExpireLe) - new Date()) / 86400000);
    if (joursRestants > 0) return `<span class="tampon attente">Essai · ${joursRestants} j</span>`;
    return `<span class="tampon alerte">Essai terminé</span>`;
  }

  function ouvrirFormulaireUtilisateur(idEntreprise, entreprise) {
    ouvrirModale(`
      <h2>Nouvel utilisateur — ${escapeHtml(entreprise?.nom || "")}</h2>
      <p class="sous-titre" style="margin-bottom:10px;">Crée un agent, un admin ou un livreur directement pour cette entreprise.</p>
      <p class="message-erreur" id="erreur-utilisateur"></p>
      <div class="formulaire">
        <div class="champ"><label>Nom</label><input id="u-nom" placeholder="Nom complet"></div>
        <div class="champ"><label>Email</label><input id="u-email" type="email" placeholder="nom@exemple.com"></div>
        <div class="champ"><label>Téléphone (optionnel)</label><input id="u-telephone" placeholder="07..."></div>
        <div class="champ"><label>Mot de passe provisoire</label><input id="u-password" type="text" placeholder="Au moins 6 caractères"></div>
        <div class="champ">
          <label>Rôle</label>
          <select id="u-role">
            <option value="admin">Admin</option>
            <option value="agent">Agent</option>
            <option value="livreur">Livreur</option>
          </select>
        </div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer">Créer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer").addEventListener("click", async (e) => {
        const erreur = boite.querySelector("#erreur-utilisateur");
        const nom = boite.querySelector("#u-nom").value.trim();
        const email = boite.querySelector("#u-email").value.trim();
        const password = boite.querySelector("#u-password").value;
        if (!nom || !email || !password) {
          erreur.textContent = "Nom, email et mot de passe sont obligatoires.";
          erreur.classList.add("visible");
          return;
        }
        e.currentTarget.disabled = true;
        const r = await creerUtilisateur({
          nom, email, password,
          telephone: boite.querySelector("#u-telephone").value.trim(),
          role: boite.querySelector("#u-role").value,
          id_entreprise: idEntreprise
        });
        if (r.ok) { afficherFlash("Utilisateur créé"); fermerModale(); rafraichirEntreprises(); }
        else { erreur.textContent = r.message; erreur.classList.add("visible"); e.currentTarget.disabled = false; }
      });
    });
  }

  function ouvrirFormulaireAbonnement(idEntreprise, entreprise) {
    ouvrirModale(`
      <h2>Abonnement — ${escapeHtml(entreprise?.nom || "")}</h2>
      <p class="sous-titre" style="margin-bottom:10px;">${libelleEssaiTexte(entreprise?.essai_expire_le)}</p>
      <p class="message-erreur" id="erreur-abonnement"></p>
      <div class="formulaire">
        <div class="champ">
          <label>Prolonger l'essai de</label>
          <select id="ab-jours">
            <option value="7">7 jours</option>
            <option value="14">14 jours</option>
            <option value="30">30 jours</option>
            <option value="90">90 jours</option>
          </select>
        </div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler">Fermer</button>
        <button class="btn btn-discret" id="btn-plan-payant">Passer en plan payant (sans limite)</button>
        <button class="btn btn-primaire" id="btn-prolonger">Prolonger l'essai</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      boite.querySelector("#btn-prolonger").addEventListener("click", async (e) => {
        const jours = Number(boite.querySelector("#ab-jours").value);
        e.currentTarget.disabled = true;
        const r = await definirEssai(idEntreprise, jours);
        if (r.ok) { afficherFlash(`Essai prolongé de ${jours} jours`); fermerModale(); rafraichirEntreprises(); }
        else { boite.querySelector("#erreur-abonnement").textContent = r.message; boite.querySelector("#erreur-abonnement").classList.add("visible"); e.currentTarget.disabled = false; }
      });
      boite.querySelector("#btn-plan-payant").addEventListener("click", async (e) => {
        if (!confirm("Retirer la limite d'essai pour cette entreprise (plan payant actif) ?")) return;
        e.currentTarget.disabled = true;
        const r = await definirEssai(idEntreprise, null);
        if (r.ok) { afficherFlash("Entreprise passée en plan payant"); fermerModale(); rafraichirEntreprises(); }
        else { boite.querySelector("#erreur-abonnement").textContent = r.message; boite.querySelector("#erreur-abonnement").classList.add("visible"); e.currentTarget.disabled = false; }
      });
    });
  }

  function libelleEssaiTexte(essaiExpireLe) {
    if (!essaiExpireLe) return "Plan payant actif, aucune limite d'essai.";
    const joursRestants = Math.ceil((new Date(essaiExpireLe) - new Date()) / 86400000);
    return joursRestants > 0
      ? `Essai en cours — ${joursRestants} jour${joursRestants > 1 ? "s" : ""} restant${joursRestants > 1 ? "s" : ""}.`
      : "Essai terminé.";
  }

  function ouvrirFormulaire() {
    ouvrirModale(`
      <h2>Nouvelle entreprise cliente</h2>
      <p class="sous-titre" style="margin-bottom:10px;">
        Crée l'entreprise et son premier compte administrateur en une fois.
        Cet admin pourra ensuite créer ses propres agents, livreurs, zones et tarifs.
      </p>
      <p class="message-erreur" id="erreur-entreprise"></p>
      <div class="formulaire">
        <div class="champ"><label>Code entreprise</label><input id="e-code" placeholder="EXPRESSCI" style="text-transform:uppercase;"></div>
        <div class="champ"><label>Nom commercial</label><input id="e-nom" placeholder="Express CI Livraison"></div>
        <hr style="border:none;border-top:1px solid var(--ligne);margin:6px 0;">
        <div class="champ"><label>Nom de l'administrateur</label><input id="a-nom" placeholder="Nom complet"></div>
        <div class="champ"><label>Email de l'administrateur</label><input id="a-email" type="email" placeholder="admin@exemple.com"></div>
        <div class="champ"><label>Téléphone (optionnel)</label><input id="a-telephone" placeholder="07..."></div>
        <div class="champ"><label>Mot de passe provisoire</label><input id="a-password" type="text" placeholder="Au moins 6 caractères"></div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer">Créer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer").addEventListener("click", async (e) => {
        const erreur = boite.querySelector("#erreur-entreprise");
        const codeEntreprise = boite.querySelector("#e-code").value.trim();
        const nom = boite.querySelector("#e-nom").value.trim();
        const adminNom = boite.querySelector("#a-nom").value.trim();
        const adminEmail = boite.querySelector("#a-email").value.trim();
        const adminTelephone = boite.querySelector("#a-telephone").value.trim();
        const adminMotDePasse = boite.querySelector("#a-password").value;

        if (!codeEntreprise || !nom || !adminNom || !adminEmail || !adminMotDePasse) {
          erreur.textContent = "Tous les champs sont obligatoires (sauf téléphone).";
          erreur.classList.add("visible");
          return;
        }
        if (adminMotDePasse.length < 6) {
          erreur.textContent = "Le mot de passe doit contenir au moins 6 caractères.";
          erreur.classList.add("visible");
          return;
        }

        e.currentTarget.disabled = true;
        e.currentTarget.textContent = "Création…";
        const r = await creerEntreprise({ codeEntreprise, nom, adminNom, adminEmail, adminTelephone, adminMotDePasse });
        if (r.ok) {
          afficherFlash(`Entreprise "${r.entreprise.code_entreprise}" créée`);
          fermerModale();
          rafraichirEntreprises();
        } else {
          erreur.textContent = r.message;
          erreur.classList.add("visible");
          e.currentTarget.disabled = false;
          e.currentTarget.textContent = "Créer";
        }
      });
    });
  }

  await afficherOngletActif();
})();
