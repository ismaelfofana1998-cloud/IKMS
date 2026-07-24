// ============================================================================
// expedition-validation.js
// La zone n'est plus demandée par destinataire : elle est fixée dès
// l'étape 1 (zones + prix), avant même de connaître qui que ce soit —
// cette validation ne s'occupe donc plus que du nom/téléphone/adresse.
// ============================================================================

export function validerTelephone(valeur) {
  const local = String(valeur || "").replace(/[\s.\-]/g, "").replace(/^(\+225|00225|225)/, "");
  if (!/^0\d{9}$/.test(local)) {
    return { valide: false, message: "Numéro invalide : 10 chiffres attendus (ex. 07 00 00 00 00)." };
  }
  return { valide: true, normalise: local };
}

// Présentation lisible "07 00 00 00 00" — appliquée seulement à la sortie du
// champ (jamais pendant la frappe, pour ne jamais faire sauter le curseur).
export function formaterTelephoneAffichage(valeur) {
  const local = String(valeur || "").replace(/[\s.\-]/g, "").replace(/^(\+225|00225|225)/, "");
  if (!/^0\d{9}$/.test(local)) return valeur;
  return local.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}

// Validation immédiate à la sortie du champ (pas seulement au moment de
// tout envoyer) : la personne découvre une faute de frappe tout de suite,
// pas après avoir rempli le reste du formulaire.
export function brancherValidationDirecte(champTelEl) {
  champTelEl.addEventListener("blur", () => {
    if (!champTelEl.value.trim()) { champTelEl.classList.remove("champ-invalide"); return; }
    const r = validerTelephone(champTelEl.value);
    if (r.valide) {
      champTelEl.value = formaterTelephoneAffichage(champTelEl.value);
      champTelEl.classList.remove("champ-invalide");
    } else {
      champTelEl.classList.add("champ-invalide");
    }
  });
  champTelEl.addEventListener("input", () => champTelEl.classList.remove("champ-invalide"));
}

let minuteurErreur = null;

export function afficherErreurToast(message) {
  const toast = document.querySelector("#erreur-form");
  const texte = document.querySelector("#erreur-form-texte");
  if (!toast || !texte) return;
  texte.textContent = message;
  toast.classList.add("visible");
  clearTimeout(minuteurErreur);
  minuteurErreur = setTimeout(() => toast.classList.remove("visible"), 6000);
}

function afficherErreur(message, champEnErreur) {
  afficherErreurToast(message);
  if (champEnErreur) {
    champEnErreur.focus({ preventScroll: false });
    champEnErreur.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  return { ok: false };
}

export function effacerErreur() {
  document.querySelector("#erreur-form")?.classList.remove("visible");
  clearTimeout(minuteurErreur);
}

export function validerExpediteur(nomEl, telEl) {
  effacerErreur();
  const nom = nomEl.value.trim();
  if (!nom) return afficherErreur("Indiquez votre nom complet.", nomEl);
  const tel = validerTelephone(telEl.value);
  if (!tel.valide) return afficherErreur(`Votre téléphone : ${tel.message}`, telEl);
  return { ok: true, nom, telNormalise: tel.normalise };
}

// Un destinataire : nom + téléphone seulement (la zone vient de l'étape 1,
// l'adresse est optionnelle et lue séparément par l'appelant).
export function validerDestinataire(nomEl, telEl, libelle) {
  effacerErreur();
  const nom = nomEl.value.trim();
  if (!nom) return afficherErreur(`Indiquez le nom ${libelle}.`, nomEl);
  const tel = validerTelephone(telEl.value);
  if (!tel.valide) return afficherErreur(`Téléphone ${libelle} : ${tel.message}`, telEl);
  return { ok: true, nom, telNormalise: tel.normalise };
}
