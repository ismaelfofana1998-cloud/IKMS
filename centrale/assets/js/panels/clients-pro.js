import { listerClientsPro, creerClientProAvecCompte, desactiverClientPro, reactiverClientPro, crediterClient, listerMouvementsClient, definirFacturationClientPro } from "../repository.js";
import { afficherFlash, escapeHtml, formaterFcfa, ouvrirModale, fermerModale } from "../ui.js";

export const titre = "Clients pro";
export const sousTitre = "Comptes clients réguliers avec portefeuille et historique, pour facturation différée.";

// Format ivoirien : 10 chiffres depuis 2021 (ex. 07 00 00 00 00).
function validerTelephone(valeur) {
  const local = String(valeur || "").replace(/[\s.\-]/g, "").replace(/^(\+225|00225|225)/, "");
  if (!/^0\d{9}$/.test(local)) {
    return { valide: false, message: "numéro invalide (10 chiffres attendus, ex. 07 00 00 00 00)." };
  }
  return { valide: true, normalise: local };
}

export async function monter(conteneur, actionsContainer, profil) {
  actionsContainer.innerHTML = `<button class="btn btn-primaire" id="btn-nouveau-client">+ Nouveau client</button>`;

  async function rafraichir() {
    const clients = await listerClientsPro();
    conteneur.innerHTML = `
      <div class="bloc-tableau">
        ${clients.length ? `
          <table class="donnees">
            <thead><tr><th>Nom</th><th>Téléphone</th><th>Portefeuille</th><th>Statut</th><th>Facturation différée</th><th></th></tr></thead>
            <tbody>
              ${clients.map((c) => `
                <tr>
                  <td class="cellule-donnee">${escapeHtml(c.nom)}</td>
                  <td>${escapeHtml(c.telephone)}</td>
                  <td class="cellule-donnee" style="color:${c.solde_portefeuille < 0 ? "var(--alerte)" : "var(--valide)"};">${formaterFcfa(c.solde_portefeuille)} FCFA</td>
                  <td>${c.actif ? '<span class="tampon valide">Actif</span>' : '<span class="tampon alerte">Désactivé</span>'}</td>
                  <td>
                    ${c.facturation_activee
                      ? `<span class="tampon valide">Activée</span> <button class="btn btn-discret btn-petit" data-facturation="${c.id_client}" data-cible="false">Désactiver</button>`
                      : `<span class="tampon attente">Non activée</span> <button class="btn btn-primaire btn-petit" data-facturation="${c.id_client}" data-cible="true">Activer</button>`}
                  </td>
                  <td class="cellule-actions">
                    <button class="btn btn-discret btn-petit" data-historique="${c.id_client}">Historique</button>
                    <button class="btn btn-discret btn-petit" data-crediter="${c.id_client}">Créditer</button>
                    ${c.actif
                      ? `<button class="btn btn-alerte btn-petit" data-desactiver="${c.id_client}">Désactiver</button>`
                      : `<button class="btn btn-discret btn-petit" data-reactiver="${c.id_client}">Réactiver</button>`}
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="etat-vide-tableau">Aucun client pro pour le moment.</div>`}
      </div>
      <p class="sous-titre" style="margin-top:14px;">
        Un client s'inscrit lui-même (page publique) sans que la facturation différée soit activée —
        il paie normalement (à la livraison ou au ramassage) jusqu'à ce que tu actives explicitement
        la facturation ici, une fois la confiance établie (ex. après plusieurs livraisons réglées sans souci).
      </p>`;

    conteneur.querySelectorAll("[data-facturation]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const cible = btn.dataset.cible === "true";
        if (cible && !confirm("Activer la facturation différée pour ce client ? Il pourra choisir \"Sans paiement\" et son portefeuille pourra aller au négatif.")) return;
        const r = await definirFacturationClientPro(btn.dataset.facturation, cible);
        if (r.ok) { afficherFlash(cible ? "Facturation activée" : "Facturation désactivée"); rafraichir(); }
        else afficherFlash(r.message, true);
      });
    });

    conteneur.querySelectorAll("[data-desactiver]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const r = await desactiverClientPro(btn.dataset.desactiver);
        if (r.ok) { afficherFlash("Client désactivé"); rafraichir(); } else afficherFlash(r.message, true);
      });
    });
    conteneur.querySelectorAll("[data-reactiver]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const r = await reactiverClientPro(btn.dataset.reactiver);
        if (r.ok) { afficherFlash("Client réactivé"); rafraichir(); } else afficherFlash(r.message, true);
      });
    });
    conteneur.querySelectorAll("[data-crediter]").forEach((btn) => {
      btn.addEventListener("click", () => ouvrirFormulaireCredit(btn.dataset.crediter));
    });
    conteneur.querySelectorAll("[data-historique]").forEach((btn) => {
      btn.addEventListener("click", () => voirHistorique(btn.dataset.historique));
    });
  }

  function ouvrirFormulaire() {
    ouvrirModale(`
      <h2>Nouveau client pro</h2>
      <p class="sous-titre" style="margin-bottom:10px;">
        Crée aussi son accès : il pourra se connecter à son espace avec son téléphone et le mot de passe généré.
      </p>
      <p class="message-erreur" id="erreur-client"></p>
      <div class="formulaire">
        <div class="champ"><label>Nom</label><input id="c-nom" placeholder="Boutique Awa"></div>
        <div class="champ"><label>Téléphone</label><input id="c-telephone" type="tel" placeholder="07 00 00 00 00"></div>
        <div class="champ"><label>Email (optionnel)</label><input id="c-email" type="email"></div>
        <div class="champ"><label>Adresse (optionnel)</label><input id="c-adresse"></div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer">Créer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer").addEventListener("click", async (e) => {
        const erreur = boite.querySelector("#erreur-client");
        const nom = boite.querySelector("#c-nom").value.trim();
        const telValidation = validerTelephone(boite.querySelector("#c-telephone").value);
        if (!nom) { erreur.textContent = "Le nom est obligatoire."; erreur.classList.add("visible"); return; }
        if (!telValidation.valide) { erreur.textContent = telValidation.message; erreur.classList.add("visible"); return; }
        e.currentTarget.disabled = true;
        const r = await creerClientProAvecCompte({
          nom, telephone: telValidation.normalise,
          email: boite.querySelector("#c-email").value.trim(),
          adresse: boite.querySelector("#c-adresse").value.trim()
        });
        if (r.ok) { fermerModale(); rafraichir(); ouvrirPartageIdentifiants(r); }
        else { erreur.textContent = r.message; erreur.classList.add("visible"); e.currentTarget.disabled = false; }
      });
    });
  }

  // Le mot de passe n'est renvoyé qu'une seule fois par le serveur (jamais
  // stocké en clair, jamais récupérable après coup) — ce popup est donc la
  // seule occasion de le transmettre au client.
  function ouvrirPartageIdentifiants({ telephone, mot_de_passe, code_entreprise }) {
    const urlEspace = `${window.location.origin}/client-connexion.html?entreprise=${encodeURIComponent(code_entreprise)}`;
    const texte = `Voici vos identifiants pour votre espace client :\nTéléphone : ${telephone}\nMot de passe : ${mot_de_passe}\nConnexion : ${urlEspace}`;
    ouvrirModale(`
      <h2>Compte créé</h2>
      <p class="sous-titre" style="margin-bottom:10px;">
        Transmets ces identifiants au client maintenant — le mot de passe ne sera plus jamais affiché après.
      </p>
      <div style="background:var(--creme);border-radius:8px;padding:14px;font-size:14px;line-height:1.8;">
        <div>Téléphone : <strong>${escapeHtml(telephone)}</strong></div>
        <div>Mot de passe : <strong>${escapeHtml(mot_de_passe)}</strong></div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-fermer">Fermer</button>
        <button class="btn btn-primaire" id="btn-partager-identifiants">Partager</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-fermer").addEventListener("click", fermerModale);
      boite.querySelector("#btn-partager-identifiants").addEventListener("click", async (e) => {
        if (navigator.share) {
          try { await navigator.share({ text: texte }); return; } catch { return; }
        }
        await navigator.clipboard.writeText(texte).catch(() => {});
        e.currentTarget.textContent = "Copié";
        setTimeout(() => { e.currentTarget.textContent = "Partager"; }, 1800);
      });
    });
  }

  function ouvrirFormulaireCredit(idClient) {
    ouvrirModale(`
      <h2>Créditer le portefeuille</h2>
      <p class="sous-titre" style="margin-bottom:10px;">Un règlement de facture, ou une avance.</p>
      <p class="message-erreur" id="erreur-credit"></p>
      <div class="formulaire">
        <div class="champ"><label>Montant (FCFA)</label><input id="cr-montant" type="number" placeholder="50000"></div>
        <div class="champ"><label>Note (optionnel)</label><input id="cr-note" placeholder="Règlement facture janvier"></div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer">Créditer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer").addEventListener("click", async (e) => {
        const erreur = boite.querySelector("#erreur-credit");
        const montant = Number(boite.querySelector("#cr-montant").value);
        if (!montant || montant <= 0) { erreur.textContent = "Montant invalide."; erreur.classList.add("visible"); return; }
        e.currentTarget.disabled = true;
        const r = await crediterClient(idClient, montant, boite.querySelector("#cr-note").value.trim());
        if (r.ok) { afficherFlash("Portefeuille crédité"); fermerModale(); rafraichir(); }
        else { erreur.textContent = r.message; erreur.classList.add("visible"); e.currentTarget.disabled = false; }
      });
    });
  }

  async function voirHistorique(idClient) {
    const mouvements = await listerMouvementsClient(idClient);
    ouvrirModale(`
      <h2>Historique des mouvements</h2>
      ${mouvements.length ? `
        <table class="donnees" style="margin-top:12px;">
          <thead><tr><th>Date</th><th>Type</th><th>Montant</th><th>Commande</th><th>Note</th></tr></thead>
          <tbody>
            ${mouvements.map((m) => `<tr>
              <td>${new Date(m.cree_le).toLocaleDateString("fr-FR")}</td>
              <td>${m.type === "DEBIT_COMMANDE" ? "Commande" : "Règlement"}</td>
              <td class="cellule-donnee" style="color:${m.montant < 0 ? "var(--alerte)" : "var(--valide)"};">${formaterFcfa(m.montant)} FCFA</td>
              <td>${escapeHtml(m.id_commande || "—")}</td>
              <td>${escapeHtml(m.note || "—")}</td>
            </tr>`).join("")}
          </tbody>
        </table>` : `<div class="etat-vide-tableau">Aucun mouvement.</div>`}
      <div class="actions-bas"><button class="btn btn-discret" id="btn-fermer">Fermer</button></div>
    `, (boite) => boite.querySelector("#btn-fermer").addEventListener("click", fermerModale));
  }

  actionsContainer.querySelector("#btn-nouveau-client").addEventListener("click", ouvrirFormulaire);
  await rafraichir();
  return () => fermerModale();
}
