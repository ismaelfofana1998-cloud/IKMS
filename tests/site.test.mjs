import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { deviserZone } from "../public/assets/js/geo.js";

const root = resolve(import.meta.dirname, "..");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
}

const files = await walk(root);
const htmlFiles = files.filter((file) => extname(file) === ".html");
const jsFiles = files.filter((file) => extname(file) === ".js" && !file.includes(`${join("tests", "")}`));

test("tous les modules JavaScript sont syntaxiquement valides", () => {
  for (const file of jsFiles) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}\n${result.stderr}`);
  }
});

test("les ressources locales référencées par les pages existent", async () => {
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const references = [...html.matchAll(/(?:src|href)=["']([^"'?#]+)["']/g)]
      .map((match) => match[1])
      .filter((value) => value.startsWith("./") || value.startsWith("../"));

    for (const reference of references) {
      const target = resolve(dirname(file), reference);
      await assert.doesNotReject(stat(target), `${file} référence ${reference}, qui n'existe pas`);
    }
  }
});

test("les identifiants HTML sont uniques dans chaque page", async () => {
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepEqual([...new Set(duplicates)], [], `${file} contient des id dupliqués`);
  }
});

test("les pages principales ont les métadonnées mobiles et accessibles", async () => {
  const pages = [
    "public/index.html",
    "public/expediteur.html",
    "public/suivi.html",
    "livreur/index.html",
    "livreur/app.html",
    "centrale/index.html",
    "centrale/centrale.html"
  ];

  for (const page of pages) {
    const html = await readFile(join(root, page), "utf8");
    assert.match(html, /<html[^>]+lang="fr"/i, `${page}: langue manquante`);
    assert.match(html, /name="viewport"/i, `${page}: viewport manquant`);
    assert.match(html, /<title>[^<]+<\/title>/i, `${page}: titre manquant`);
  }
});

test("les deux applications installables sont correctement séparées", async () => {
  const publicManifest = JSON.parse(await readFile(join(root, "public/manifest.webmanifest"), "utf8"));
  const courierManifest = JSON.parse(await readFile(join(root, "livreur/manifest.json"), "utf8"));

  assert.equal(publicManifest.start_url, "./expediteur.html");
  assert.equal(publicManifest.scope, "./");
  assert.equal(courierManifest.start_url, "./index.html");
  assert.equal(courierManifest.scope, "./");
  assert.notEqual(publicManifest.id, courierManifest.id);
  assert.ok(publicManifest.icons.length >= 2);
  assert.ok(courierManifest.icons.length >= 2);

  for (const [directory, manifest] of [
    [join(root, "public"), publicManifest],
    [join(root, "livreur"), courierManifest]
  ]) {
    for (const icon of manifest.icons) {
      await assert.doesNotReject(stat(resolve(directory, icon.src)), `Icône PWA manquante : ${icon.src}`);
    }
  }
});

test("les fichiers préchargés par les applications installables existent", async () => {
  for (const serviceWorker of [
    join(root, "public/service-worker.js"),
    join(root, "livreur/service-worker.js")
  ]) {
    const content = await readFile(serviceWorker, "utf8");
    const assets = [...content.matchAll(/^\s*"(\.\/[^"]+)"[,]?$/gm)].map((match) => match[1]);
    assert.ok(assets.length > 0, `${serviceWorker}: cache applicatif vide`);
    for (const asset of assets) {
      await assert.doesNotReject(stat(resolve(dirname(serviceWorker), asset)), `${serviceWorker}: ${asset} manque`);
    }
  }
});

test("aucune clé privilégiée Supabase n'est exposée dans les clients", async () => {
  const clientFiles = files.filter((file) =>
    [join(root, "public"), join(root, "livreur"), join(root, "centrale")]
      .some((directory) => file.startsWith(directory))
  );
  for (const file of clientFiles) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(content, /service[_-]?role\s*[:=]\s*["'][A-Za-z0-9._-]+/i, file);
  }
});

test("la reconnaissance de zone respecte la commune avant le secteur", () => {
  const zones = [
    {
      code_zone: "YOP-SICOGI",
      nom_commune: "Yopougon",
      secteur: "Sicogi",
      mots_cles: ["Sicogi marché"]
    },
    {
      code_zone: "YOP-NIANGON",
      nom_commune: "Yopougon",
      secteur: "Niangon",
      mots_cles: ["Niangon Nord"]
    },
    {
      code_zone: "COC-RIVIERA",
      nom_commune: "Cocody",
      secteur: "Riviera",
      mots_cles: ["Riviera 2"]
    }
  ];

  assert.equal(
    deviserZone("Sicogi", zones, "Sicogi, Cocody, Abidjan"),
    null,
    "Sicogi ne doit pas faire valider Yopougon lorsque l'adresse dit Cocody"
  );
  assert.equal(
    deviserZone("Yopougon", zones, "Sicogi, Yopougon, Abidjan"),
    "YOP-SICOGI"
  );
  assert.equal(
    deviserZone("Cocody", zones, "Sicogi, Cocody, Abidjan"),
    null,
    "un secteur inconnu de Cocody doit demander une vérification"
  );
});

test("une commune hors du référentiel du tenant ne peut pas être masquée par un secteur homonyme", () => {
  const zones = [{
    code_zone: "YOP-SICOGI",
    nom_commune: "Yopougon",
    secteur: "Sicogi",
    mots_cles: ["Sicogi"]
  }];

  assert.equal(
    deviserZone("Sicogi", zones, "Sicogi, Cocody, Abidjan"),
    null
  );
});

test("un secteur seul ne valide jamais une zone sans commune reconnue", () => {
  const zones = [
    { code_zone: "YOP-SICOGI", nom_commune: "Yopougon", secteur: "Sicogi", mots_cles: [] },
    { code_zone: "COC-SICOGI", nom_commune: "Cocody", secteur: "Sicogi", mots_cles: [] }
  ];

  assert.equal(deviserZone("Sicogi", zones, "Sicogi, Abidjan"), null);
  assert.equal(
    deviserZone(
      "PK18",
      [{ code_zone: "BIN-PK18", nom_commune: "Bingerville", secteur: "PK18", mots_cles: [] }],
      "Pharmacie PK18, Abidjan"
    ),
    null,
    "même un PK18 unique chez le tenant doit alerter si la commune manque"
  );
});

test("le CA est masqué uniquement chez le livreur et reste disponible dans la centrale", async () => {
  const [
    appLivreur,
    repositoryLivreur,
    repositoryCentrale,
    tableauDeBordCentrale
  ] = await Promise.all([
    readFile(join(root, "livreur/app.html"), "utf8"),
    readFile(join(root, "livreur/assets/js/repository.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/repository.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/panels/tableau-de-bord.js"), "utf8")
  ]);

  assert.doesNotMatch(appLivreur, /cpt-gains|FCFA livrés/i);
  assert.doesNotMatch(repositoryLivreur, /\.select\([^)]*ca_livre/);
  assert.match(repositoryCentrale, /\.select\([^)]*ca_livre/);
  assert.match(tableauDeBordCentrale, /p\.ca_livre/);
});

test("le raccourci expéditeur iOS conserve le code entreprise dans son URL", async () => {
  const [pageExpediteur, contexteEntreprise] = await Promise.all([
    readFile(join(root, "public/expediteur.html"), "utf8"),
    readFile(join(root, "public/assets/js/entreprise-contexte.js"), "utf8")
  ]);

  assert.doesNotMatch(
    pageExpediteur,
    /<link[^>]+rel=["']manifest["']/i,
    "un manifest statique ferait perdre ?entreprise=CODE au raccourci iOS"
  );
  assert.match(pageExpediteur, /iPad\|iPhone\|iPod/);
  assert.match(pageExpediteur, /manifest\.webmanifest/);
  assert.match(contexteEntreprise, /document\.cookie/);
  assert.match(contexteEntreprise, /SameSite=Lax/);
});

test("la refonte reprend la palette et la typographie du PDF", async () => {
  const [themePublic, themeCentrale, themeLivreur, navigationPublic] = await Promise.all([
    readFile(join(root, "public/assets/css/theme.css"), "utf8"),
    readFile(join(root, "centrale/assets/css/theme.css"), "utf8"),
    readFile(join(root, "livreur/assets/css/theme.css"), "utf8"),
    readFile(join(root, "public/assets/css/app-shell.css"), "utf8")
  ]);

  for (const theme of [themePublic, themeCentrale, themeLivreur]) {
    assert.match(theme, /--indigo:\s*#11161A/i);
    assert.match(theme, /--terracotta:\s*#C94C18/i);
    assert.match(theme, /--peche:\s*#E5AB3C/i);
    assert.match(theme, /--creme:\s*#F7F3F0/i);
    assert.match(theme, /--police-corps:\s*"Inter"/i);
    assert.doesNotMatch(theme, /Space Mono|#0F172A/i);
  }

  assert.match(navigationPublic, /height:\s*calc\(42px \+ env\(safe-area-inset-bottom/);
  assert.match(navigationPublic, /min-height:\s*34px/);
});

test("les identifiants metier utilisent la date et un compteur extensible", async (t) => {
  const cheminMigration = join(root, "supabase/migrations/57_identifiants_metier_dates.sql");
  if (!files.includes(cheminMigration)) {
    t.skip("migration absente de ce dépôt");
    return;
  }

  const [migration, repository, tableauDeBord, styles] = await Promise.all([
    readFile(cheminMigration, "utf8"),
    readFile(join(root, "centrale/assets/js/repository.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/panels/tableau-de-bord.js"), "utf8"),
    readFile(join(root, "centrale/assets/css/centrale.css"), "utf8")
  ]);

  assert.match(migration, /when 'ramassage' then 'RM'/);
  assert.match(migration, /when 'commande' then 'CMD'/);
  assert.match(migration, /when 'colis' then 'COL'/);
  assert.match(migration, /when 'lot' then 'LIV'/);
  assert.match(migration, /to_char\(v_jour,\s*'YYMMDD'\)/);
  assert.match(migration, /when v_valeur < 1000 then lpad\(v_valeur::text,\s*3,\s*'0'\)/);
  assert.match(migration, /else v_valeur::text/);
  assert.match(migration, /add column if not exists id_ramassage text/);
  assert.doesNotMatch(migration, /set\s+code_ramassage\s*=/i);
  assert.match(repository, /id_commande, id_ramassage/);
  assert.match(tableauDeBord, /c\.id_ramassage \|\| c\.id_commande/);
  assert.match(styles, /background:\s*#FDFBFA/);
  assert.match(styles, /color:\s*#6D6059/);
  assert.match(styles, /color:\s*#C94C18/);
});

test("l'écran opérations sépare chaque file et affiche les colis des départs", async () => {
  const [operations, interfaceUtilisateur, styles] = await Promise.all([
    readFile(join(root, "centrale/assets/js/panels/operations.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/ui.js"), "utf8"),
    readFile(join(root, "centrale/assets/css/centrale.css"), "utf8")
  ]);

  assert.doesNotMatch(operations, /\["TOUT",\s*"Tout"\]/);
  assert.match(operations, /const visible = \(section\) => filtreActif === section/);
  assert.match(operations, /class="liste-lots-depart"/);
  assert.match(operations, /data-valider-depart-colis/);
  assert.match(operations, /listerColisDesLots/);
  assert.match(operations, /class="identifiant-operation identifiant-metier"/);
  assert.match(operations, /class="adresse-operation"/);
  assert.match(styles, /\.etape-operation table\.donnees td\s*\{[^}]*padding:\s*10px 14px/s);
  assert.match(styles, /\.identifiant-operation,\s*\.identifiant-metier\s*\{[^}]*font-family:\s*inherit/s);
  assert.match(interfaceUtilisateur, /zone-messages-flash/);
  assert.match(styles, /\.zone-messages-flash\s*\{[^}]*bottom:\s*22px/s);
  assert.doesNotMatch(styles, /\.message-flash\s*\{[^}]*top:/s);
});

test("les bandeaux partagent le brun public et l'application iPhone remplit les zones sures", async () => {
  const [themePublic, shellPublic, expedition, livreur, centrale, pageExpediteur] = await Promise.all([
    readFile(join(root, "public/assets/css/theme.css"), "utf8"),
    readFile(join(root, "public/assets/css/app-shell.css"), "utf8"),
    readFile(join(root, "public/assets/css/expedition-externe.css"), "utf8"),
    readFile(join(root, "livreur/assets/css/livreur.css"), "utf8"),
    readFile(join(root, "centrale/assets/css/centrale.css"), "utf8"),
    readFile(join(root, "public/expediteur.html"), "utf8")
  ]);

  assert.match(themePublic, /--header:\s*#312A24/i);
  assert.match(shellPublic, /background:\s*var\(--header\)/);
  assert.match(shellPublic, /min-height:\s*calc\(44px \+ env\(safe-area-inset-top/);
  assert.match(shellPublic, /bottom:\s*calc\(0px - env\(safe-area-inset-bottom/);
  assert.match(shellPublic, /height:\s*calc\(42px \+ env\(safe-area-inset-bottom[^;]+env\(safe-area-inset-bottom/);
  assert.match(expedition, /min-height:\s*100dvh/);
  assert.doesNotMatch(expedition, /position:\s*fixed;\s*inset:\s*0/);
  assert.match(livreur, /\.topbar[\s\S]*?background:\s*var\(--header\)/);
  assert.doesNotMatch(livreur, /\.compteur-cadran:nth-child\(2\)[^{]*\{[^}]*border-top-color/);
  assert.match(centrale, /\.entete-panneau[\s\S]*?background:\s*var\(--header\)/);
  assert.match(pageExpediteur, /theme-color" content="#312A24"/i);
});

test("la gestion des zones reste exploitable sans matrice de paires", async () => {
  const [panneauZones, repository, styles, migration] = await Promise.all([
    readFile(join(root, "centrale/assets/js/panels/zones.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/repository.js"), "utf8"),
    readFile(join(root, "centrale/assets/css/centrale.css"), "utf8"),
    readFile(join(root, "supabase/migrations/60_groupes_tarifaires.sql"), "utf8")
  ]);

  assert.match(panneauZones, />Zones<\/button>/);
  assert.match(panneauZones, />Tarification<\/button>/);
  assert.match(panneauZones, />Exceptions<\/button>/);
  assert.match(panneauZones, /id="recherche-zones"/);
  assert.match(panneauZones, /Tarif dans cette même zone/);
  assert.doesNotMatch(panneauZones, /ouvrirTarifsNouvelleZone|Appliquer à toutes|Enregistrer tous les tarifs/);
  assert.match(repository, /export async function listerGroupesTarifaires/);
  assert.match(repository, /export async function enregistrerTarifGroupes/);
  assert.match(styles, /\.grille-configuration-tarifs/);
  assert.match(styles, /\.recherche-zones-tarifs/);
  assert.match(migration, /create table if not exists public\.groupes_tarifaires/);
  assert.match(migration, /create table if not exists public\.tarifs_groupes/);
  assert.match(migration, /tarif_intra_zone/);
  assert.match(migration, /create or replace function public\.tarif_zone_zone/);
  assert.match(migration, /zones_tarifs_paires[\s\S]*?tarif_intra_zone[\s\S]*?tarifs_groupes/);
});

test("les opérations remplacent les écrans fragmentés sans changer les RPC métier", async () => {
  const [shell, app, operations, repository, styles] = await Promise.all([
    readFile(join(root, "centrale/assets/js/shell.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/app.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/panels/operations.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/repository.js"), "utf8"),
    readFile(join(root, "centrale/assets/css/centrale.css"), "utf8")
  ]);

  assert.match(shell, /id:\s*"operations",\s*label:\s*"Opérations"/);
  assert.match(shell, /id:\s*"historique",\s*label:\s*"Historique des commandes"/);
  assert.doesNotMatch(shell, /id:\s*"(commandes|ramassage|reception|lots)",\s*label:/);
  assert.match(app, /operations:\s*\(\)\s*=>\s*import\("\.\/panels\/operations\.js"\)/);
  assert.match(app, /\["commandes",\s*"ramassage",\s*"reception",\s*"lots"\]\.includes\(id\)/);
  assert.match(operations, /Assigner le ramassage/);
  assert.match(operations, /Réceptionner le colis/);
  assert.match(operations, /Créer le lot/);
  assert.match(operations, /Valider le départ/);
  assert.match(operations, /sectionLots\(lotsActifs,\s*"LIVRAISON"\)/);
  assert.match(repository, /operations,\s*\n\s*ramassage:/);
  assert.match(styles, /\.filtres-operations/);
});

test("l'historique est recherché côté serveur, paginé et exporté en xlsx", async () => {
  const [historique, repository, migration] = await Promise.all([
    readFile(join(root, "centrale/assets/js/panels/historique.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/repository.js"), "utf8"),
    readFile(join(root, "supabase/migrations/58_operations_historique.sql"), "utf8")
  ]);
  const { creerClasseurHistorique } = await import("../centrale/assets/js/excel.js");

  assert.match(historique, /Exporter en Excel/);
  assert.match(historique, /CMD, RM, COL, LIV/);
  assert.match(historique, /tailleLot = 1000/);
  assert.match(repository, /\.rpc\("rpc_historique_commandes"/);
  assert.match(migration, /security definer/);
  assert.match(migration, /cmd\.id_entreprise = v_entreprise/);
  assert.match(migration, /count\(\*\) over\(\) as total_lignes/);
  assert.match(migration, /grant execute on function public\.rpc_historique_commandes/);

  const classeur = creerClasseurHistorique([{
    id_commande: "CMD-260724-001",
    id_ramassage: "RM-260724-001",
    id_colis: "COL-260724-001",
    id_lot: "LIV-260724-001",
    statut_commande_libelle: "Terminée",
    statut_colis_libelle: "Livré",
    expediteur_nom: "Aïcha",
    destinataire_nom: "Koffi",
    montant_livraison: 2500,
    cree_le: "2026-07-24T10:00:00Z",
    maj_le: "2026-07-24T12:00:00Z"
  }]);
  const octets = new Uint8Array(await classeur.arrayBuffer());
  assert.deepEqual([...octets.slice(0, 4)], [0x50, 0x4B, 0x03, 0x04]);
  const contenu = new TextDecoder().decode(octets);
  assert.match(contenu, /Historique/);
  assert.match(contenu, /Statut colis/);
  assert.match(contenu, /CMD-260724-001/);
});

test("les écrans historiques, expédition et retours privilégient l'information utile", async () => {
  const [
    historique,
    operations,
    retours,
    operationsRepository,
    stylesCentrale,
    expedition,
    expeditionSubmit,
    stylesExpedition,
    stylesFormulaire,
    livreur,
    stylesLivreur
  ] = await Promise.all([
    readFile(join(root, "centrale/assets/js/panels/historique.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/panels/operations.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/panels/retours.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/repository.js"), "utf8"),
    readFile(join(root, "centrale/assets/css/centrale.css"), "utf8"),
    readFile(join(root, "public/assets/js/expedition-externe.js"), "utf8"),
    readFile(join(root, "public/assets/js/expedition-submit.js"), "utf8"),
    readFile(join(root, "public/assets/css/expedition-externe.css"), "utf8"),
    readFile(join(root, "public/assets/css/expedition-form.css"), "utf8"),
    readFile(join(root, "livreur/assets/js/app.js"), "utf8"),
    readFile(join(root, "livreur/assets/css/livreur.css"), "utf8")
  ]);

  assert.match(historique, /class="identifiant-metier"/);
  assert.match(historique, /class="barre-resultats-historique"/);
  assert.match(stylesCentrale, /\.historique-commandes td\s*\{[^}]*padding:\s*9px 12px/s);

  assert.doesNotMatch(expedition, /token_expediteur/);
  assert.match(expedition, /Ouvrir WhatsApp/);
  assert.match(expedition, /formaterTelephoneAffichage\(telephone\)/);
  assert.match(expeditionSubmit, /https:\/\/wa\.me\//);
  assert.match(expeditionSubmit, /\.rpc\("rpc_creer_commande"/);
  assert.match(operations, /data-partager-position-expediteur/);
  assert.match(operations, /POSITION_EXPEDITEUR/);
  assert.match(stylesExpedition, /body\s*\{[^}]*background:\s*var\(--surface-secondaire\)/s);
  assert.match(stylesFormulaire, /\.btn-partage-destinataire/);

  assert.match(livreur, /voile-choix-hub-retour/);
  assert.match(livreur, /class="choix-hub-retour"/);
  assert.match(livreur, /Pourquoi ce hub/);
  assert.match(livreur, /motif\.length < 5/);
  assert.match(stylesLivreur, /\.voile-choix-hub-retour\s*\{[^}]*align-items:\s*center/s);

  assert.match(retours, /data-etape-retour/);
  assert.match(retours, /data-choisir-decision/);
  assert.match(retours, /Aucun retour à traiter/);
  assert.match(stylesCentrale, /\.filtres-retours/);
  assert.match(operationsRepository, /\.in\("statut",\s*\["EN_LOT",\s*"RECUP_DEMANDEE",\s*"EN_TOURNEE"\]\)/);
  assert.match(operationsRepository, /idsLotsLivraisonActifs/);
});

test("le choix d'un hub de retour est justifié puis confirmé par le hub", async () => {
  const [migration, livreurRepository, centraleRepository, operations] = await Promise.all([
    readFile(join(root, "supabase/migrations/59_confirmation_hub_retour.sql"), "utf8"),
    readFile(join(root, "livreur/assets/js/repository.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/repository.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/panels/operations.js"), "utf8")
  ]);

  assert.match(migration, /motif_choix_hub_retour text/);
  assert.match(migration, /rpc_demander_depot_retour/);
  assert.match(migration, /rpc_confirmer_hub_retour/);
  assert.match(migration, /hub_retour_confirme_par = v_acteur/);
  assert.match(livreurRepository, /\.rpc\("rpc_demander_depot_retour"/);
  assert.match(centraleRepository, /\.rpc\("rpc_confirmer_hub_retour"/);
  assert.match(operations, /Confirmer le hub et réceptionner/);
});
