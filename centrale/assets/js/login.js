import { connecterCentrale, chargerProfilCentrale, deconnecterCentrale } from "./auth.js";

const form = document.querySelector("#form-connexion");
const bouton = document.querySelector("#bouton-connexion");
const messageErreur = document.querySelector("#message-erreur");
const banniereSession = document.querySelector("#banniere-session");

// Le super_admin represente l'editeur du logiciel (la plateforme SaaS elle-
// meme), pas une entreprise cliente — meme IKIGAI Livraison n'est qu'une
// cliente parmi d'autres ici. Il est donc route vers son propre espace
// plutot que l'espace centrale partage par les entreprises clientes.
function destinationSelonRole(role) {
  return role === "super_admin" ? "./plateforme.html" : "./centrale.html";
}

// Avant, une session existante redirigeait automatiquement loin de cette
// page — impossible d'y revenir pour se déconnecter et se reconnecter avec
// un autre compte (ex. tester l'accès super-admin). Elle reste maintenant
// toujours accessible ; on propose juste de continuer ou de changer de compte.
(async () => {
  const profil = await chargerProfilCentrale();
  if (!profil) return;
  banniereSession.hidden = false;
  banniereSession.innerHTML = `
    Déjà connecté en tant que ${profil.nom || profil.role}.
    <a id="lien-continuer">Continuer</a> ·
    <a id="lien-deconnecter">Se déconnecter</a>
  `;
  banniereSession.querySelector("#lien-continuer").addEventListener("click", () => {
    window.location.href = destinationSelonRole(profil.role);
  });
  banniereSession.querySelector("#lien-deconnecter").addEventListener("click", async (e) => {
    e.target.textContent = "Déconnexion…";
    await deconnecterCentrale();
  });
})();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  messageErreur.textContent = "";
  bouton.disabled = true;
  bouton.textContent = "Connexion...";

  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const resultat = await connecterCentrale(email, password);

  if (!resultat.ok) {
    messageErreur.textContent = resultat.message;
    bouton.disabled = false;
    bouton.textContent = "Se connecter";
    return;
  }
  const profil = await chargerProfilCentrale();
  window.location.href = destinationSelonRole(profil?.role);
});
