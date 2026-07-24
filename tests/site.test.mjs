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
  assert.match(migration, /code_ramassage reste le\s*\n?-- code aleatoire secret/i);
  assert.match(repository, /id_commande, id_ramassage/);
  assert.match(tableauDeBord, /c\.id_ramassage \|\| c\.id_commande/);
  assert.match(styles, /background:\s*#FDFBFA/);
  assert.match(styles, /color:\s*#6D6059/);
  assert.match(styles, /color:\s*#C94C18/);
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

test("la gestion des zones reste exploitable avec de nombreuses paires", async () => {
  const [panneauZones, repository, styles] = await Promise.all([
    readFile(join(root, "centrale/assets/js/panels/zones.js"), "utf8"),
    readFile(join(root, "centrale/assets/js/repository.js"), "utf8"),
    readFile(join(root, "centrale/assets/css/centrale.css"), "utf8")
  ]);

  assert.match(panneauZones, />Zones<\/button>/);
  assert.match(panneauZones, />Paramétrer Zones<\/button>/);
  assert.match(panneauZones, /id="recherche-zones-tarifs"/);
  assert.match(panneauZones, /ouvrirTarifsNouvelleZone/);
  assert.match(panneauZones, /zone\.code_zone !== nouvelleZone\.code_zone/);
  assert.match(panneauZones, /Appliquer à toutes/);
  assert.match(panneauZones, /Enregistrer tous les tarifs/);
  assert.doesNotMatch(panneauZones, /Une paire vaut dans les deux sens|liste de référence|Pour créer ou organiser/);
  assert.match(repository, /export async function enregistrerTarifsPairesPourZone/);
  assert.match(repository, /\.upsert\(\s*lignes/);
  assert.match(styles, /\.grille-tarifs-zone/);
  assert.match(styles, /\.recherche-zones-tarifs/);
});
