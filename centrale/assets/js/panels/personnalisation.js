import {
  lireCodeEntreprise, listerPersonnalisation, uploaderPersonnalisation, supprimerPersonnalisation,
  lireTextesPersonnalisesEntreprise, definirTextePersonnalise, retirerTextePersonnalise, urlPersonnalisation
} from "../repository.js";
import { afficherFlash, escapeHtml } from "../ui.js";

export const titre = "Personnalisation";
export const sousTitre = "Une phrase et une photo, répétées autant de fois que tu veux — affichées en haut de ta page d'envoi.";

// Un seul créneau = une photo + une phrase courte, affichés ensemble comme
// une seule carte sur la page d'envoi (voir expedition-externe.js). Le
// variant de stockage reste fixe ("photo") : contrairement à l'ancien
// système (fonds plein écran, qui avaient besoin d'un cadrage différent
// pour desktop et mobile), une carte de cette taille garde une seule image
// pour les deux, recadrée en CSS (object-fit) plutôt que doublée.
const SLOTS = ["accroche-1", "accroche-2", "accroche-3"];
const VARIANT = "photo";

export async function monter(conteneur, actionsContainer, profil) {
  const codeEntreprise = await lireCodeEntreprise(profil.id_entreprise);

  async function rafraichir() {
    const [existants, textes] = await Promise.all([
      listerPersonnalisation(codeEntreprise),
      lireTextesPersonnalisesEntreprise()
    ]);
    const cheminDe = (cle) => `${codeEntreprise}/${VARIANT}/${cle}.webp`;
    const aPhoto = (cle) => existants.includes(cheminDe(cle));
    const texteDe = (cle) => textes.find((t) => t.cle === cle)?.titre || "";

    conteneur.innerHTML = `
      <p class="sous-titre" style="margin-bottom:16px;">
        Écris directement dans l'aperçu, comme sur la page finale. Photo au format WebP/JPEG/PNG, moins de 2&nbsp;Mo —
        elle apparaît immédiatement ici, l'enregistrement se fait en arrière-plan.
      </p>
      <div class="grille-accroches">
        ${SLOTS.map((cle, i) => `
          <div class="carte-accroche" data-cle="${cle}">
            <div class="apercu-accroche" ${aPhoto(cle) ? `style="background-image:url('${urlPersonnalisation(codeEntreprise, VARIANT, cle)}')"` : ""} data-apercu="${cle}">
              <div class="apercu-accroche-voile"></div>
              <textarea class="apercu-accroche-texte" data-texte="${cle}" placeholder="Phrase d'accroche ${i + 1}" rows="3">${escapeHtml(texteDe(cle))}</textarea>
            </div>
            <div class="actions-accroche">
              <label class="btn btn-discret btn-petit bouton-fichier">
                📷 ${aPhoto(cle) ? "Changer la photo" : "Ajouter une photo"}
                <input type="file" accept="image/webp,image/jpeg,image/png" data-slot="${cle}" hidden>
              </label>
              ${aPhoto(cle) ? `<button class="btn btn-discret btn-petit" data-retirer-photo="${cle}">Retirer la photo</button>` : ""}
              <button class="btn btn-primaire btn-petit" data-enregistrer-texte="${cle}">Enregistrer la phrase</button>
            </div>
          </div>`).join("")}
      </div>
    `;

    conteneur.querySelectorAll('input[type="file"]').forEach((input) => {
      input.addEventListener("change", async () => {
        const fichier = input.files[0];
        if (!fichier) return;
        if (fichier.size > 2 * 1024 * 1024) {
          afficherFlash("Image trop lourde (max 2 Mo).", true);
          input.value = "";
          return;
        }
        // Aperçu immédiat, avant même que l'upload ait fini -- la personne
        // voit tout de suite le résultat, l'attente réseau reste invisible.
        const conteneurApercu = conteneur.querySelector(`[data-apercu="${input.dataset.slot}"]`);
        conteneurApercu.style.backgroundImage = `url('${URL.createObjectURL(fichier)}')`;
        const r = await uploaderPersonnalisation(codeEntreprise, VARIANT, input.dataset.slot, fichier);
        if (!r.ok) { afficherFlash(r.message, true); return; }
        afficherFlash("Photo mise à jour");
        rafraichir();
      });
    });

    conteneur.querySelectorAll("[data-retirer-photo]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Retirer cette photo ?")) return;
        btn.disabled = true;
        const r = await supprimerPersonnalisation(codeEntreprise, VARIANT, btn.dataset.retirerPhoto);
        if (r.ok) { afficherFlash("Photo retirée"); rafraichir(); }
        else { afficherFlash(r.message, true); btn.disabled = false; }
      });
    });

    conteneur.querySelectorAll("[data-enregistrer-texte]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const cle = btn.dataset.enregistrerTexte;
        const texte = conteneur.querySelector(`[data-texte="${cle}"]`).value.trim();
        btn.disabled = true;
        const r = texte ? await definirTextePersonnalise(cle, texte, "") : await retirerTextePersonnalise(cle);
        if (r.ok) afficherFlash("Phrase enregistrée");
        else afficherFlash(r.message, true);
        btn.disabled = false;
      });
    });
  }

  await rafraichir();
}
