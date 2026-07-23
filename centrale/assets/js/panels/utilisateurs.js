import { listerUtilisateurs, creerUtilisateur, modifierUtilisateur, listerVehicules, listerHubs } from "../repository.js";
import { afficherFlash, escapeHtml, formaterFcfa, ouvrirModale, fermerModale } from "../ui.js";

export const titre = "Utilisateurs";
export const sousTitre = "Comptes internes : administrateurs, agents et livreurs.";

const LIBELLES_ROLE = { admin: "Administrateur", agent: "Agent", livreur: "Livreur", super_admin: "Super admin" };

export async function monter(conteneur, actionsContainer, profil) {
  actionsContainer.innerHTML = `<button class="btn btn-primaire" id="btn-nouvel-utilisateur">+ Nouvel utilisateur</button>`;
  let vehicules = [];
  let hubs = [];
  let utilisateurs = [];

  // Un véhicule déjà affecté à un autre utilisateur actif ne doit plus
  // apparaître comme choix possible (corrige : rien n'empêchait avant de
  // l'affecter en double). idAConserver : en modification, on garde quand
  // même le véhicule déjà affecté à CET utilisateur dans sa propre liste.
  function vehiculesDisponibles(idUtilisateurActuel) {
    const idsPris = new Set(
      utilisateurs
        .filter((u) => u.id_vehicule && u.actif && u.id_utilisateur !== idUtilisateurActuel)
        .map((u) => u.id_vehicule)
    );
    return vehicules.filter((v) => !idsPris.has(v.id_vehicule));
  }

  async function rafraichir() {
    const [tous, vehiculesList, hubsList] = await Promise.all([listerUtilisateurs(), listerVehicules(), listerHubs()]);
    vehicules = vehiculesList;
    hubs = hubsList;
    utilisateurs = tous.filter((u) => ["admin", "agent", "livreur"].includes(u.role));

    conteneur.innerHTML = `
      <div class="bloc-tableau">
        <table class="donnees">
          <thead><tr><th>Nom</th><th>Rôle</th><th>Téléphone</th><th>Salaire/jour</th><th>Charges/jour</th><th>Véhicule</th>${hubs.length ? "<th>Hub</th>" : ""}<th>Statut</th><th></th></tr></thead>
          <tbody>
            ${utilisateurs.map((u) => `
              <tr>
                <td>${escapeHtml(u.nom)}</td>
                <td>${LIBELLES_ROLE[u.role] || u.role}</td>
                <td>${escapeHtml(u.telephone || "—")}</td>
                <td class="cellule-donnee">${formaterFcfa(u.salaire_jour)}</td>
                <td class="cellule-donnee">${formaterFcfa(u.charges_jour)}</td>
                <td>${vehicules.find((v) => v.id_vehicule === u.id_vehicule)?.immatriculation || "—"}</td>
                ${hubs.length ? `<td>${hubs.find((h) => h.id_hub === u.id_hub_affecte)?.nom || "—"}</td>` : ""}
                <td><span class="tampon ${u.actif ? "valide" : "neutre"}">${u.actif ? "Actif" : "Désactivé"}</span></td>
                <td class="cellule-actions"><button class="btn btn-discret btn-petit" data-modifier="${u.id_utilisateur}">Modifier</button></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

    conteneur.querySelectorAll("[data-modifier]").forEach((btn) => {
      const u = utilisateurs.find((x) => x.id_utilisateur === btn.dataset.modifier);
      btn.addEventListener("click", () => ouvrirEdition(u));
    });
  }

  function ouvrirEdition(u) {
    ouvrirModale(`
      <h2>${escapeHtml(u.nom)}</h2>
      <p class="message-erreur" id="erreur-edit"></p>
      <div class="formulaire">
        <div class="ligne-champs">
          <div class="champ"><label>Salaire / jour (FCFA)</label><input id="edit-salaire" type="number" value="${u.salaire_jour}"></div>
          <div class="champ"><label>Charges / jour (FCFA)</label><input id="edit-charges" type="number" value="${u.charges_jour}"></div>
        </div>
        <div class="champ">
          <label>Véhicule affecté</label>
          <select id="edit-vehicule">
            <option value="">Aucun</option>
            ${vehiculesDisponibles(u.id_utilisateur).map((v) => `<option value="${v.id_vehicule}" ${v.id_vehicule === u.id_vehicule ? "selected" : ""}>${v.type} · ${escapeHtml(v.immatriculation || "")}</option>`).join("")}
          </select>
        </div>
        ${hubs.length && ["agent", "livreur"].includes(u.role) ? `
        <div class="champ">
          <label>Hub affecté</label>
          <select id="edit-hub">
            <option value="">Aucun</option>
            ${hubs.map((h) => `<option value="${h.id_hub}" ${h.id_hub === u.id_hub_affecte ? "selected" : ""}>${escapeHtml(h.nom)}</option>`).join("")}
          </select>
        </div>` : ""}
        <div class="champ">
          <label>Statut</label>
          <select id="edit-actif">
            <option value="true" ${u.actif ? "selected" : ""}>Actif</option>
            <option value="false" ${!u.actif ? "selected" : ""}>Désactivé</option>
          </select>
        </div>
      </div>
      <div class="actions-bas">
        <button class="btn btn-discret" id="btn-annuler">Annuler</button>
        <button class="btn btn-primaire" id="btn-enregistrer">Enregistrer</button>
      </div>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      boite.querySelector("#btn-enregistrer").addEventListener("click", async (e) => {
        e.currentTarget.disabled = true;
        const r = await modifierUtilisateur(u.id_utilisateur, {
          salaire_jour: Number(boite.querySelector("#edit-salaire").value) || 0,
          charges_jour: Number(boite.querySelector("#edit-charges").value) || 0,
          id_vehicule: boite.querySelector("#edit-vehicule").value || null,
          ...(boite.querySelector("#edit-hub") ? { id_hub_affecte: boite.querySelector("#edit-hub").value || null } : {}),
          actif: boite.querySelector("#edit-actif").value === "true"
        });
        if (r.ok) { afficherFlash("Utilisateur mis à jour"); fermerModale(); rafraichir(); }
        else {
          const messageAmical = r.message?.includes("idx_utilisateurs_vehicule_unique")
            ? "Ce véhicule est déjà affecté à un autre utilisateur actif."
            : r.message;
          boite.querySelector("#erreur-edit").textContent = messageAmical;
          boite.querySelector("#erreur-edit").classList.add("visible"); e.currentTarget.disabled = false;
        }
      });
    });
  }

  function ouvrirCreation() {
    ouvrirModale(`
      <h2>Nouvel utilisateur</h2>
      <p class="sous-titre">Crée un compte administrateur, agent ou livreur.</p>
      <p class="message-erreur" id="erreur-creation"></p>
      <form id="form-creation" class="formulaire">
        <div class="ligne-champs">
          <div class="champ"><label>Nom complet</label><input id="c-nom" required></div>
          <div class="champ"><label>Téléphone</label><input id="c-telephone"></div>
        </div>
        <div class="ligne-champs">
          <div class="champ"><label>Email</label><input id="c-email" type="email" required></div>
          <div class="champ"><label>Mot de passe</label><input id="c-password" type="password" required minlength="6"></div>
        </div>
        <div class="ligne-champs">
          <div class="champ">
            <label>Rôle</label>
            <select id="c-role">
              <option value="livreur">Livreur</option>
              <option value="agent">Agent</option>
              ${profil.role !== "agent" ? '<option value="admin">Administrateur</option>' : ""}
            </select>
          </div>
          <div class="champ"><label>Véhicule</label>
            <select id="c-vehicule"><option value="">Aucun</option>${vehiculesDisponibles(null).map((v) => `<option value="${v.id_vehicule}">${v.type} · ${escapeHtml(v.immatriculation || "")}</option>`).join("")}</select>
          </div>
        </div>
        ${hubs.length ? `
        <div class="ligne-champs">
          <div class="champ"><label>Hub affecté (agent/livreur)</label>
            <select id="c-hub"><option value="">Aucun</option>${hubs.map((h) => `<option value="${h.id_hub}">${escapeHtml(h.nom)}</option>`).join("")}</select>
          </div>
        </div>` : ""}
        <div class="ligne-champs">
          <div class="champ"><label>Salaire / jour (FCFA)</label><input id="c-salaire" type="number" value="0"></div>
          <div class="champ"><label>Charges / jour (FCFA)</label><input id="c-charges" type="number" value="0"></div>
        </div>
        <div class="actions-bas">
          <button type="button" class="btn btn-discret" id="btn-annuler">Annuler</button>
          <button type="submit" class="btn btn-primaire" id="btn-creer">Créer le compte</button>
        </div>
      </form>
    `, (boite) => {
      boite.querySelector("#btn-annuler").addEventListener("click", fermerModale);
      boite.querySelector("#form-creation").addEventListener("submit", async (e) => {
        e.preventDefault();
        const bouton = boite.querySelector("#btn-creer");
        bouton.disabled = true; bouton.textContent = "Création…";
        const r = await creerUtilisateur({
          nom: boite.querySelector("#c-nom").value.trim(),
          telephone: boite.querySelector("#c-telephone").value.trim(),
          email: boite.querySelector("#c-email").value.trim(),
          password: boite.querySelector("#c-password").value,
          role: boite.querySelector("#c-role").value,
          salaire_jour: boite.querySelector("#c-salaire").value,
          charges_jour: boite.querySelector("#c-charges").value,
          id_vehicule: boite.querySelector("#c-vehicule").value || null,
          id_hub_affecte: boite.querySelector("#c-hub")?.value || null
        });
        if (r.ok) { afficherFlash("Utilisateur créé"); fermerModale(); rafraichir(); }
        else {
          boite.querySelector("#erreur-creation").textContent = r.message;
          boite.querySelector("#erreur-creation").classList.add("visible");
          bouton.disabled = false; bouton.textContent = "Créer le compte";
        }
      });
    });
  }

  actionsContainer.querySelector("#btn-nouvel-utilisateur").addEventListener("click", ouvrirCreation);
  await rafraichir();
  return () => fermerModale();
}
