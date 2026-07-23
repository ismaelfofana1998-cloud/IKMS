let invitationInstallation = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  invitationInstallation = event;
  document.querySelectorAll("[data-installer-app]").forEach((button) => {
    button.hidden = false;
  });
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-installer-app]");
  if (!button || !invitationInstallation) return;
  await invitationInstallation.prompt();
  invitationInstallation = null;
  button.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // Le mode connecté reste disponible si l'installation hors ligne échoue.
    });
  });
}
