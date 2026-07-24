const encodeur = new TextEncoder();

function echapperXml(valeur) {
  return String(valeur ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function nomColonne(index) {
  let valeur = index + 1;
  let nom = "";
  while (valeur > 0) {
    valeur -= 1;
    nom = String.fromCharCode(65 + (valeur % 26)) + nom;
    valeur = Math.floor(valeur / 26);
  }
  return nom;
}

function numeroSerieExcel(valeur) {
  const date = valeur instanceof Date ? valeur : new Date(valeur);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime() / 86400000 + 25569;
}

function cellule(lettre, ligne, valeur, type = "texte") {
  const reference = `${lettre}${ligne}`;
  if (valeur === null || valeur === undefined || valeur === "") {
    return `<c r="${reference}"/>`;
  }
  if (type === "nombre") {
    const nombre = Number(valeur);
    return Number.isFinite(nombre)
      ? `<c r="${reference}" s="3"><v>${nombre}</v></c>`
      : `<c r="${reference}"/>`;
  }
  if (type === "date") {
    const serie = numeroSerieExcel(valeur);
    return serie === null
      ? `<c r="${reference}"/>`
      : `<c r="${reference}" s="2"><v>${serie}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${echapperXml(valeur)}</t></is></c>`;
}

const COLONNES = [
  ["Commande", "id_commande", "texte", 21],
  ["Ramassage", "id_ramassage", "texte", 21],
  ["Colis", "id_colis", "texte", 21],
  ["Lot de livraison", "id_lot", "texte", 21],
  ["Statut commande", "statut_commande_libelle", "texte", 20],
  ["Statut colis", "statut_colis_libelle", "texte", 22],
  ["Expéditeur", "expediteur_nom", "texte", 24],
  ["Téléphone expéditeur", "expediteur_tel", "texte", 20],
  ["Destinataire", "destinataire_nom", "texte", 24],
  ["Téléphone destinataire", "destinataire_tel", "texte", 20],
  ["Zone", "code_zone", "texte", 18],
  ["Hub", "hub_nom", "texte", 22],
  ["Livreur ramassage", "livreur_ramassage_nom", "texte", 24],
  ["Livreur livraison", "livreur_livraison_nom", "texte", 24],
  ["Mode de paiement", "mode_paiement", "texte", 20],
  ["Montant livraison (FCFA)", "montant_livraison", "nombre", 22],
  ["Créée le", "cree_le", "date", 20],
  ["Dernière mise à jour", "maj_le", "date", 22]
];

function construireFeuille(lignes) {
  const derniereColonne = nomColonne(COLONNES.length - 1);
  const derniereLigne = Math.max(1, lignes.length + 1);
  const entetes = COLONNES.map(([libelle], index) =>
    `<c r="${nomColonne(index)}1" s="1" t="inlineStr"><is><t>${echapperXml(libelle)}</t></is></c>`
  ).join("");
  const corps = lignes.map((ligne, indexLigne) => {
    const numeroLigne = indexLigne + 2;
    const cellules = COLONNES.map(([, cle, type], indexColonne) =>
      cellule(nomColonne(indexColonne), numeroLigne, ligne[cle], type)
    ).join("");
    return `<row r="${numeroLigne}">${cellules}</row>`;
  }).join("");
  const colonnes = COLONNES.map(([, , , largeur], index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${largeur}" customWidth="1"/>`
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${derniereColonne}${derniereLigne}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${colonnes}</cols>
  <sheetData><row r="1" ht="24" customHeight="1">${entetes}</row>${corps}</sheetData>
  <autoFilter ref="A1:${derniereColonne}${derniereLigne}"/>
</worksheet>`;
}

function crc32(donnees) {
  let crc = 0xFFFFFFFF;
  for (const octet of donnees) {
    crc ^= octet;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function ecrire16(tableau, position, valeur) {
  tableau[position] = valeur & 0xFF;
  tableau[position + 1] = (valeur >>> 8) & 0xFF;
}

function ecrire32(tableau, position, valeur) {
  tableau[position] = valeur & 0xFF;
  tableau[position + 1] = (valeur >>> 8) & 0xFF;
  tableau[position + 2] = (valeur >>> 16) & 0xFF;
  tableau[position + 3] = (valeur >>> 24) & 0xFF;
}

function concatener(parties) {
  const taille = parties.reduce((total, partie) => total + partie.length, 0);
  const resultat = new Uint8Array(taille);
  let position = 0;
  parties.forEach((partie) => {
    resultat.set(partie, position);
    position += partie.length;
  });
  return resultat;
}

function dateDos(date = new Date()) {
  const annee = Math.max(1980, date.getFullYear());
  return {
    heure: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((annee - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function creerZip(fichiers) {
  const locaux = [];
  const centraux = [];
  let decalage = 0;
  const horodatage = dateDos();

  Object.entries(fichiers).forEach(([nom, contenu]) => {
    const nomEncode = encodeur.encode(nom);
    const donnees = encodeur.encode(contenu);
    const checksum = crc32(donnees);
    const local = new Uint8Array(30 + nomEncode.length);
    ecrire32(local, 0, 0x04034B50);
    ecrire16(local, 4, 20);
    ecrire16(local, 6, 0x0800);
    ecrire16(local, 8, 0);
    ecrire16(local, 10, horodatage.heure);
    ecrire16(local, 12, horodatage.date);
    ecrire32(local, 14, checksum);
    ecrire32(local, 18, donnees.length);
    ecrire32(local, 22, donnees.length);
    ecrire16(local, 26, nomEncode.length);
    ecrire16(local, 28, 0);
    local.set(nomEncode, 30);
    locaux.push(local, donnees);

    const central = new Uint8Array(46 + nomEncode.length);
    ecrire32(central, 0, 0x02014B50);
    ecrire16(central, 4, 20);
    ecrire16(central, 6, 20);
    ecrire16(central, 8, 0x0800);
    ecrire16(central, 10, 0);
    ecrire16(central, 12, horodatage.heure);
    ecrire16(central, 14, horodatage.date);
    ecrire32(central, 16, checksum);
    ecrire32(central, 20, donnees.length);
    ecrire32(central, 24, donnees.length);
    ecrire16(central, 28, nomEncode.length);
    ecrire16(central, 30, 0);
    ecrire16(central, 32, 0);
    ecrire16(central, 34, 0);
    ecrire16(central, 36, 0);
    ecrire32(central, 38, 0);
    ecrire32(central, 42, decalage);
    central.set(nomEncode, 46);
    centraux.push(central);
    decalage += local.length + donnees.length;
  });

  const blocCentral = concatener(centraux);
  const fin = new Uint8Array(22);
  ecrire32(fin, 0, 0x06054B50);
  ecrire16(fin, 4, 0);
  ecrire16(fin, 6, 0);
  ecrire16(fin, 8, centraux.length);
  ecrire16(fin, 10, centraux.length);
  ecrire32(fin, 12, blocCentral.length);
  ecrire32(fin, 16, decalage);
  ecrire16(fin, 20, 0);
  return concatener([...locaux, blocCentral, fin]);
}

export function creerClasseurHistorique(lignes) {
  const creeLe = new Date().toISOString();
  const fichiers = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
  <sheets><sheet name="Historique" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts>
  <fonts count="2"><font><sz val="11"/><name val="Inter"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Inter"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF312A24"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><bottom style="thin"><color rgb="FFD9D1CC"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
    "xl/worksheets/sheet1.xml": construireFeuille(lignes),
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Historique des commandes IKMS</dc:title><dc:creator>IKMS</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${creeLe}</dcterms:created>
</cp:coreProperties>`,
    "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>IKMS</Application></Properties>`
  };
  return new Blob([creerZip(fichiers)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

export function telechargerHistoriqueExcel(lignes) {
  const blob = creerClasseurHistorique(lignes);
  const date = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = `historique-commandes-${date}.xlsx`;
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
