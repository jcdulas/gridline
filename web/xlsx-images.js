const richDataNamespace = "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata";
const richImageParts = [
  { path: "metadata.xml", kind: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml",
    relation: officeRels + "/sheetMetadata" },
  { path: "richData/rdrichvalue.xml", kind: "application/vnd.ms-excel.rdrichvalue+xml",
    relation: "http://schemas.microsoft.com/office/2017/06/relationships/rdRichValue" },
  { path: "richData/rdrichvaluestructure.xml", kind: "application/vnd.ms-excel.rdrichvaluestructure+xml",
    relation: "http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueStructure" },
  { path: "richData/rdRichValueTypes.xml", kind: "application/vnd.ms-excel.rdrichvaluetypes+xml",
    relation: "http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueTypes" },
  { path: "richData/richValueRel.xml", kind: "application/vnd.ms-excel.richvaluerel+xml",
    relation: "http://schemas.microsoft.com/office/2022/10/relationships/richValueRel" }
];

function collectXlsxCellImages(engine, entries) {
  const images = [];
  for (const entry of entries) {
    const { sheet } = entry;
    entry.cellImages = new Map();
    entry.drawingImages = [];
    for (const image of sheet.images || []) {
      const key = cellKey(image.row, image.column, engine.columns);
      if (image.placement !== "cell" || sheet.pivot || engine.raw(sheet.id, image.row, image.column) || entry.cellImages.has(key)) {
        entry.drawingImages.push(image);
        continue;
      }
      images.push(image);
      entry.cellImages.set(key, images.length);
    }
    entry.drawing = Boolean(sheet.chart || sheet.embeddedCharts?.length || entry.drawingImages.length);
  }
  return images;
}

async function writeXlsxCellImages(zip, images) {
  const count = images.length;
  const relations = [];
  for (const [index, image] of images.entries()) {
    const [, type, base64] = imageDataPattern.exec(image.data);
    const id = index + 1;
    const path = `media/cellImage${id}.${type}`;
    await zip.add("xl/" + path, [Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))]);
    relations.push({ id, type: "image", target: "../" + path });
  }

  const metadata = `<metadata xmlns="${sheetNamespace}" xmlns:xlrd="${richDataNamespace}">` +
    '<metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000" copy="1" pasteAll="1" ' +
    'pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1"/></metadataTypes>' +
    `<futureMetadata name="XLRICHVALUE" count="${count}">` +
    images.map((_, i) => `<bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="${i}"/></ext></extLst></bk>`).join("") +
    `</futureMetadata><valueMetadata count="${count}">` +
    images.map((_, i) => `<bk><rc t="1" v="${i}"/></bk>`).join("") + "</valueMetadata></metadata>";
  const values = `<rvData xmlns="${richDataNamespace}" count="${count}">` +
    images.map(({ name }, i) => `<rv s="0"><v>${i}</v><v>5</v><v>${xlsxText(name)}</v></rv>`).join("") + "</rvData>";
  const structure = `<rvStructures xmlns="${richDataNamespace}" count="1"><s t="_localImage">` +
    '<k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/><k n="Text" t="s"/></s></rvStructures>';
  const keys = ["_Self", "_DisplayString", "_Flags", "_Format", "_SubLabel", "_Attribution", "_Icon", "_Display",
    "_CanonicalPropertyNames", "_ClassificationId"];
  const types = '<rvTypesInfo xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata2"><global><keyFlags>' +
    keys.map((key) => `<key name="${key}">${key === "_Self" ? '<flag name="ExcludeFromFile" value="1"/>' : ""}` +
      '<flag name="ExcludeFromCalcComparison" value="1"/></key>').join("") + "</keyFlags></global></rvTypesInfo>";
  const links = '<richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" ' +
    `xmlns:r="${officeRels}">${relations.map(({ id }) => `<rel r:id="rId${id}"/>`).join("")}</richValueRels>`;
  for (const [index, xml] of [metadata, values, structure, types, links].entries()) {
    await zip.add("xl/" + richImageParts[index].path, [xmlHeader + xml]);
  }
  await zip.add(relationshipPath("xl/" + richImageParts[4].path), [xmlRelationships(relations)]);
}

async function readXlsxCellImages(zip, relations) {
  const path = (type) => [...relations.values()].find((part) => part.type === type)?.path;
  const metadataPath = path("sheetMetadata"), structuresPath = path("rdRichValueStructure");
  const valuesPath = path("rdRichValue"), linksPath = path("richValueRel");
  if (!metadataPath || !structuresPath || !valuesPath || !linksPath) return new Map();
  const read = async (name) => readXml(await zip.text(name));
  const metadata = await read(metadataPath);
  const metadataType = children(child(metadata, "metadataTypes"), "metadataType")
    .findIndex((type) => type.getAttribute("name") === "XLRICHVALUE") + 1;
  const future = children(metadata, "futureMetadata").find((part) => part.getAttribute("name") === "XLRICHVALUE");
  if (!metadataType || !future) return new Map();
  const richIndexes = children(future, "bk").map((block) =>
    block.getElementsByTagNameNS("*", "rvb")[0]?.getAttribute("i"));
  const structures = children(await read(structuresPath), "s");
  const values = children(await read(valuesPath), "rv");
  const imageRelations = readRelationships(await read(relationshipPath(linksPath)), linksPath);
  const links = children(await read(linksPath), "rel").map((link) => imageRelations.get(drawingId(link)));
  const files = new Map();
  const images = new Map();
  for (const [index, block] of children(child(metadata, "valueMetadata"), "bk").entries()) {
    const record = children(block, "rc").find((item) => Number(item.getAttribute("t")) === metadataType);
    const value = values[richIndexes[record?.getAttribute("v")]];
    const structure = structures[value?.getAttribute("s")];
    if (structure?.getAttribute("t") !== "_localImage") continue;
    const keys = children(structure, "k").map((key) => key.getAttribute("n"));
    const fields = children(value, "v");
    const link = links[fields[keys.indexOf("_rvRel:LocalImageIdentifier")]?.textContent];
    if (link?.type !== "image") continue;
    const name = decodeXlsxText(fields[keys.indexOf("Text")]?.textContent || "Picture").slice(0, 180);
    images.set(index + 1, async () => {
      if (!files.has(link.path)) files.set(link.path, xlsxImageData(zip, link.path));
      const data = await files.get(link.path);
      return data ? { data, name } : null;
    });
  }
  return images;
}
