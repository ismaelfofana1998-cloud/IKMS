import { lireEtatPaiementWave, configurerPaiementWave } from "../repository.js";
import { afficherFlash, copierTexte } from "../ui.js";

export const titre = "Paiements";
export const sousTitre = "Connecte ton propre compte Wave Business — l'argent de tes clients arrive directement dessus, jamais sur un compte partagé.";

export async function monter(conteneur) {
  async function rafraichir() {
    const etat = await lireEtatPaiementWave();

    conteneur.innerHTML = `
      <div class="bloc-tableau" style="max-width:560px;">
        <div class="tableau-titre">Wave Business</div>
        <p class="sous-titre" style="margin:8px 0 18px;">
          ${etat.configure
            ? "Configuré — tes clients peuvent payer par Wave dès maintenant."
            : "Pas encore configuré — tant que ce n'est pas fait, seuls les paiements en espèces sont disponibles."}
        </p>

        ${etat.configure ? `
          <div class="ligne-lien" style="margin-bottom:16px;">
            <span>URL de webhook à enregistrer chez Wave</span>
            <button class="btn btn-discret btn-petit" id="btn-copier-webhook">Copier</button>
          </div>
        ` : ""}

        <div class="champ">
          <label>Clé API Wave (secrète)</label>
          <input id="w-api-key" type="password" placeholder="wave_ci_prod_...">
        </div>
        <div class="champ">
          <label>Clé de signature Wave</label>
          <input id="w-signing" type="password" placeholder="wave_ci_AKS_...">
        </div>
        <p class="message-erreur" id="erreur-wave"></p>
        <button class="btn btn-primaire" id="btn-enregistrer-wave">${etat.configure ? "Remplacer les clés" : "Enregistrer"}</button>

        <p class="sous-titre" style="margin-top:18px;font-size:12px;">
          Une fois enregistrées, les clés ne sont plus jamais réaffichées — comme un mot de passe.
          Pour les changer (nouveau compte, clé compromise…), enregistre-en simplement de nouvelles.
        </p>
      </div>`;

    if (etat.configure && etat.jeton_webhook) {
      const urlWebhook = `${window.APP_CONFIG?.SUPABASE_URL || ""}/functions/v1/wave-webhook/${etat.jeton_webhook}`;
      conteneur.querySelector("#btn-copier-webhook")?.addEventListener("click", () => copierTexte(urlWebhook));
    }

    conteneur.querySelector("#btn-enregistrer-wave").addEventListener("click", async (e) => {
      const apiKey = conteneur.querySelector("#w-api-key").value.trim();
      const signing = conteneur.querySelector("#w-signing").value.trim();
      const erreur = conteneur.querySelector("#erreur-wave");
      if (!apiKey || !signing) {
        erreur.textContent = "Les deux clés sont nécessaires."; erreur.classList.add("visible"); return;
      }
      e.currentTarget.disabled = true; e.currentTarget.textContent = "Enregistrement…";
      const r = await configurerPaiementWave(apiKey, signing);
      if (r.ok) {
        afficherFlash("Clés Wave enregistrées");
        rafraichir();
      } else {
        erreur.textContent = r.message; erreur.classList.add("visible");
        e.currentTarget.disabled = false; e.currentTarget.textContent = "Enregistrer";
      }
    });
  }

  await rafraichir();
}
