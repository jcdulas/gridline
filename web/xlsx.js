const standardReaderRows = 1_048_576;
const sheetNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const officeRels = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRels = "http://schemas.openxmlformats.org/package/2006/relationships";
const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const xlsxErrors = new Set(["#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#NUM!", "#N/A", "#NULL!", "#SPILL!", "#CALC!", "#GETTING_DATA"]);

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  })[character]);
}

function xlsxText(text) {
  return xmlEscape(text.replace(/_x[\da-f]{4}_|[\x00-\x08\x0b\x0c\x0e-\x1f\r\ufffe\uffff]/gi, (match) =>
    match.length > 1 ? "_x005F_" + match.slice(1) : "_x" + match.charCodeAt(0).toString(16).padStart(4, "0") + "_"));
}

function decodeXlsxText(text) {
  if (!text.includes("_x") && !text.includes("_X")) return text;
  return text.replace(/_x([\da-f]{4})_/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function asCellText(text) {
  const first = text.charCodeAt(0) | 32;
  if (first >= 97 && first <= 122 && first !== 102 && first !== 116) return text;
  const typed = /^[=']|^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$|^(?:TRUE|FALSE)$/i.test(text);
  return typed || xlsxErrors.has(text) ? "'" + text : text;
}

function children(element, tag) {
  return Array.from(element?.children || []).filter((child) => child.localName === tag);
}

function child(element, tag) {
  if (!element) return null;
  for (const node of element.children) if (node.localName === tag) return node;
  return null;
}

function readXml(source) {
  if (/<!DOCTYPE/i.test(source)) throw new Error("Unsupported XML declaration in XLSX workbook.");
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("An XLSX workbook XML part is invalid.");
  return doc.documentElement;
}

function resolvePart(owner, target) {
  const base = new URL(owner || "/", "https://xlsx.local");
  const url = new URL(target, base);
  if (url.origin !== base.origin) throw new Error("External XLSX workbook parts are unsupported.");
  return decodeURIComponent(url.pathname.slice(1));
}

function readRelationships(xml, owner) {
  const result = new Map();
  for (const relation of children(xml, "Relationship")) {
    const target = relation.getAttribute("Target");
    if (!target || relation.getAttribute("TargetMode") === "External") continue;
    const type = relation.getAttribute("Type")?.split("/").at(-1);
    result.set(relation.getAttribute("Id"), { type, path: resolvePart(owner, target) });
  }
  return result;
}

function relationshipPath(path) {
  const index = path.lastIndexOf("/") + 1;
  return path.slice(0, index) + "_rels/" + path.slice(index) + ".rels";
}

function richText(item) {
  const direct = child(item, "t");
  const text = direct?.textContent ?? children(item, "r").map((run) => child(run, "t")?.textContent || "").join("");
  return decodeXlsxText(text);
}

function rgbColor(node) {
  const rgb = node?.getAttribute("rgb");
  return /^[\da-f]{6,8}$/i.test(rgb || "") ? "#" + rgb.slice(-6).toLowerCase() : undefined;
}

function numberStyle(id, code, date1904) {
  const result = {};
  const unquoted = (code || "").replace(/"(?:[^"]|"")*"|\\.|\[[^\]]+\]|_.|\*./g, "");
  const euro = /€|\bEUR\b/i.test(code || "");
  if (code) result.xlsxFormat = code;
  else if (id >= 14 && id <= 22) {
    result.xlsxFormat = ["m/d/yy", "d-mmm-yy", "d-mmm", "mmm-yy", "h:mm AM/PM", "h:mm:ss AM/PM", "h:mm", "h:mm:ss", "m/d/yy h:mm"][id - 14];
  }
  if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dy]|h.*[ms]|[ms].*:/.test(unquoted.toLowerCase())) {
    const hasDate = /[dy]/i.test(unquoted) || (id >= 14 && id <= 17) || id === 22;
    result.format = hasDate ? (id === 22 || /h/i.test(unquoted) ? "datetime" : "date") : "time";
    if (date1904) result.date1904 = true;
  } else if (id === 9 || id === 10 || unquoted.includes("%")) {
    result.format = "percent";
    result.decimals = id === 9 ? 0 : id === 10 ? 2 : (unquoted.match(/\.(0+)/)?.[1].length || 0);
  } else if (euro || [5, 6, 7, 8, 42, 44].includes(id) || (code || "").includes("$")) {
    result.format = euro ? "currency-eur" : "currency";
    result.decimals = [5, 6, 42].includes(id) ? 0 : [7, 8, 44].includes(id) ? 2 : (unquoted.match(/\.(0+)/)?.[1].length || 0);
  } else if (id === 1 || id === 3 || /^(?:[#,]*0)$/.test(unquoted)) {
    result.format = "integer";
  } else if (id === 2 || id === 4 || unquoted.includes(".0")) {
    result.format = "number";
    result.decimals = id === 2 || id === 4 ? 2 : (unquoted.match(/\.(0+)/)?.[1].length || 0);
  }
  if (result.decimals !== undefined) result.decimals = Math.min(10, result.decimals);
  return result;
}

function readXlsxStyles(xml, date1904) {
  const codes = new Map(children(child(xml, "numFmts"), "numFmt")
    .map((node) => [Number(node.getAttribute("numFmtId")), node.getAttribute("formatCode")]));
  const importedFonts = children(child(xml, "fonts"), "font");
  const fills = children(child(xml, "fills"), "fill");
  const borders = children(child(xml, "borders"), "border");
  return children(child(xml, "cellXfs"), "xf").map((xf, index) => {
    if (index === 0 && !Number(xf.getAttribute("numFmtId"))) return undefined;
    const formatId = Number(xf.getAttribute("numFmtId"));
    const style = numberStyle(formatId, codes.get(formatId), date1904);
    const font = importedFonts[Number(xf.getAttribute("fontId"))];
    const fontFamily = child(font, "name")?.getAttribute("val");
    const fontSize = Number(child(font, "sz")?.getAttribute("val"));
    if (fontFamily && fonts.includes(fontFamily)) style.font = fontFamily;
    if (fontSize >= 9 && fontSize <= 32) style.size = Math.round(fontSize);
    for (const [tag, property] of [["b", "bold"], ["i", "italic"], ["u", "underline"]]) {
      const element = child(font, tag);
      if (element && !["0", "false", "none"].includes(element.getAttribute("val"))) style[property] = true;
    }
    const color = rgbColor(child(font, "color"));
    if (color) style.color = color;
    const pattern = child(fills[Number(xf.getAttribute("fillId"))], "patternFill");
    const fill = rgbColor(child(pattern, "fgColor"));
    if (fill && pattern.getAttribute("patternType") === "solid") style.fill = fill;
    const border = child(borders[Number(xf.getAttribute("borderId"))], "bottom");
    if (border?.hasAttribute("style")) style.border = rgbColor(child(border, "color")) || "#8ca2b2";
    const align = child(xf, "alignment")?.getAttribute("horizontal");
    if (["left", "center", "right"].includes(align)) style.align = align;
    return Object.keys(style).length ? style : undefined;
  });
}

function readXlsxAddress(reference, rows, columns) {
  let index = 0;
  let column = 0;
  while (index < 3) {
    const letter = reference.charCodeAt(index);
    if (!(letter >= 65 && letter <= 90)) break;
    column = column * 26 + letter - 64;
    index++;
  }
  const rowStart = index;
  if (!column || reference.length - rowStart > 7) return parseAddress(reference, rows, columns);
  let row = 0;
  for (; index < reference.length; index++) {
    const digit = reference.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) break;
    row = row * 10 + digit;
  }
  if (index !== reference.length || index === rowStart) {
    return parseAddress(reference, rows, columns);
  }
  return row >= 1 && row <= rows && column <= columns ? { row: row - 1, column: column - 1 } : null;
}

async function readXlsxSheet(zip, path, engine, sheet, sharedStrings, styles, cellImages, reportProgress) {
  const sharedFormulas = new Map();
  const pending = [];
  let count = 0;
  let skippedImages = false;
  let drawing = null;
  for await (const rowNode of xlsxWorksheetNodes(zip, path)) {
    if (rowNode.localName === "col") {
      const first = Number(rowNode.getAttribute("min"));
      const last = Math.min(Number(rowNode.getAttribute("max")), engine.columns);
      const width = Number(rowNode.getAttribute("width"));
      if (!Number.isInteger(first) || first < 1 || !width || width < 0) continue;
      for (let index = first; index <= last; index++) sheet.widths.set(index - 1, clamp(Math.round(width * 7 + 5), 28, 500));
      continue;
    }
    if (rowNode.localName === "drawing") { drawing = rowNode; continue; }
    const rowIndex = Number(rowNode.getAttribute("r"));
    const height = Number(rowNode.getAttribute("ht"));
    if (rowIndex >= 1 && rowIndex <= engine.rows && height > 0) {
      sheet.heights.set(rowIndex - 1, clamp(Math.round(height * 4 / 3), 16, 160));
    }
    let fallbackColumn = 0;
    for (const cell of rowNode.children) {
      if (cell.localName !== "c") continue;
      const reference = cell.getAttribute("r") || cellName(rowIndex - 1, fallbackColumn);
      fallbackColumn++;
      let formula, value, inline;
      for (const node of cell.children) {
        if (node.localName === "f" && !formula) formula = node;
        else if (node.localName === "v" && value === undefined) value = node.textContent;
        else if (node.localName === "is" && !inline) inline = node;
      }
      const address = readXlsxAddress(reference, engine.rows, engine.columns);
      if (!address) {
        if (formula || value !== undefined || inline) throw new Error(`XLSX cell ${reference} exceeds Grids&Tabs's worksheet limits.`);
        continue;
      }
      const { row, column } = address;
      const style = styles.length ? styles[Number(cell.getAttribute("s"))] : null;
      if (style) sheet.styles.set(cellKey(row, column, engine.columns), style);
      const readImage = cellImages.size ? cellImages.get(Number(cell.getAttribute("vm"))) : null;
      if (readImage) {
        try {
          const image = await readImage();
          if (image) {
            const size = objectSize(sheet, { row, column, placement: "cell" });
            (sheet.images ??= []).push(validateImage({ ...image, ...size, row, column, placement: "cell" }, engine));
            continue;
          }
        } catch { /* Leave the cell's cached fallback value in place. */ }
        skippedImages = true;
      }
      if (formula) {
        const text = formula.textContent;
        if (formula.getAttribute("t") === "shared") {
          const index = formula.getAttribute("si");
          if (text) sharedFormulas.set(index, { row, column, text: "=" + text });
          else pending.push({ row, column, index });
        }
        if (text) engine.set(sheet.id, row, column, "=" + text);
      } else {
        const type = cell.getAttribute("t");
        let text = value ?? "";
        if (type === "s") {
          const string = sharedStrings[Number(value)];
          if (string === undefined) throw new Error("An XLSX cell refers to a missing shared string.");
          text = asCellText(string);
        } else if (type === "inlineStr") text = asCellText(richText(inline));
        else if (type === "str" || type === "d") text = asCellText(decodeXlsxText(text));
        else if (type === "b" && value !== undefined) text = value === "1" ? "TRUE" : "FALSE";
        if (text) engine.set(sheet.id, row, column, text);
      }
      if (++count % 16384 === 0) {
        reportProgress?.(count);
        await yieldToBrowser();
      }
    }
  }
  const xlsxDimensions = { rows: engine.rows, columns: 16384 };
  for (const { row, column, index } of pending) {
    const master = sharedFormulas.get(index);
    if (!master) throw new Error("An XLSX shared formula is missing its source cell.");
    const text = shiftFormula(master.text, row - master.row, column - master.column, xlsxDimensions);
    engine.set(sheet.id, row, column, text);
  }
  return { skippedImages, drawing };
}

async function openXlsx(file, reportProgress) {
  const zip = await ZipArchive.open(file);
  const read = async (path) => readXml(await zip.text(path));
  const root = readRelationships(await read("_rels/.rels"), "");
  const workbookPath = [...root.values()].find(({ type }) => type === "officeDocument")?.path;
  if (!workbookPath) throw new Error("This archive does not contain an XLSX workbook.");
  const workbook = await read(workbookPath);
  const rels = readRelationships(await read(relationshipPath(workbookPath)), workbookPath);
  const date1904 = ["true", "1"].includes(child(workbook, "workbookPr")?.getAttribute("date1904"));
  const stringsPath = [...rels.values()].find(({ type }) => type === "sharedStrings")?.path;
  const stylesPath = [...rels.values()].find(({ type }) => type === "styles")?.path;
  const strings = stringsPath ? children(await read(stringsPath), "si").map(richText) : [];
  const styles = stylesPath ? readXlsxStyles(await read(stylesPath), date1904) : [];
  const spatial = await readXlsxSpatialMetadata(zip, rels);
  const engine = await WorkbookEngine.load();
  engine.setDateSystem(date1904);
  const sheets = [];
  const worksheetRelations = new Map();
  let skipped = false;
  let skippedDrawings = false;
  let cellImages = new Map();
  try { cellImages = await readXlsxCellImages(zip, rels); }
  catch { skippedDrawings = true; }
  const worksheetEntries = children(child(workbook, "sheets"), "sheet");
  const sourceNames = new Set(worksheetEntries.map((entry) => decodeXlsxText(entry.getAttribute("name") || ""))
    .filter((name) => !spatial.helpers.has(name)));
  for (const entry of worksheetEntries) {
    const id = entry.getAttributeNS(officeRels, "id") ||
      Array.from(entry.attributes).find((attribute) => attribute.localName === "id")?.value;
    const rel = rels.get(id);
    if (rel?.type !== "worksheet") { skipped = true; continue; }
    const name = decodeXlsxText(entry.getAttribute("name") || "");
    if (entry.getAttribute("state") === "veryHidden" && spatial.helpers.has(name)) continue;
    if (!validSheetName(name)) throw new Error("The workbook contains an invalid worksheet name.");
    const sheetId = engine.addSheet(name);
    if (!sheetId) throw new Error("The workbook contains duplicate worksheet names.");
    const sheet = newSheetModel(sheetId, name);
    const { skippedImages, drawing } = await readXlsxSheet(zip, rel.path, engine, sheet, strings, styles, cellImages,
      reportProgress && ((count) => reportProgress(name, count)));
    if (skippedImages) skippedDrawings = true;
    try {
      if (await readXlsxDrawing(zip, engine, sheet, drawing, rel.path, spatial.charts, sourceNames)) skippedDrawings = true;
    } catch {
      skippedDrawings = true;
    }
    const sheetRelsPath = relationshipPath(rel.path);
    if (zip.entries.has(sheetRelsPath)) {
      try { worksheetRelations.set(sheet, readRelationships(await read(sheetRelsPath), rel.path)); }
      catch { /* The worksheet values remain usable with damaged relationships. */ }
    }
    sheets.push(sheet);
  }
  if (!sheets.length) throw new Error("The XLSX workbook contains no worksheets.");
  const caches = new Map(children(child(workbook, "pivotCaches"), "pivotCache").map((cache) =>
    [cache.getAttribute("cacheId"), rels.get(drawingId(cache))?.path]));
  const tables = new Map();
  let skippedPivots = false;
  if (caches.size) {
    for (const [sheet, relations] of worksheetRelations) {
      for (const part of relations.values()) {
        if (part.type !== "table") continue;
        try {
          const table = await read(part.path);
          tables.set(table.getAttribute("name"), { sheet: sheet.name, ref: table.getAttribute("ref") });
        } catch { /* A pivot with an unavailable table source keeps its cached cells. */ }
      }
    }
    for (const [sheet, relations] of worksheetRelations) {
      const parts = [...relations.values()].filter((part) => part.type === "pivotTable");
      if (!parts.length) continue;
      try {
        if (parts.length !== 1) { skippedPivots = true; continue; }
        const pivot = await readXlsxPivot(zip, parts[0].path, caches, tables, engine, sheet, sheets);
        if (pivot) sheet.pivot = pivot;
        else skippedPivots = true;
      } catch { skippedPivots = true; }
    }
    for (const sheet of sheets) {
      if (!sheet.pivot || !sheets.some((source) => source.name === sheet.pivot.sourceSheet && source.pivot)) continue;
      delete sheet.pivot;
      skippedPivots = true;
    }
  }
  for (const sheet of sheets) {
    if (sheet.chart && !sheets.some(({ name, chart }) => name === sheet.chart.sourceSheet && !chart)) {
      delete sheet.chart;
      skippedDrawings = true;
    }
    sheet.embeddedCharts = sheet.embeddedCharts?.filter(({ chart }) => {
      const available = sheets.some(({ name, chart: report }) => name === chart.sourceSheet && !report);
      if (!available) skippedDrawings = true;
      return available;
    });
  }
  const notice = [skipped ? "Some non-worksheet tabs were skipped" : "",
    skippedDrawings ? "Some drawing objects were skipped" : "",
    skippedPivots ? "Some PivotTables were opened as cached results" : ""].filter(Boolean).join(" · ");
  return { engine, sheets, title: file.name.replace(/\.xlsx$/i, "").slice(0, 120) || "Workbook",
    notice };
}

class XlsxStyles {
  constructor() {
    this.ids = new Map();
    this.fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'];
    this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    this.borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
    this.formats = new Map();
    this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  }

  index(style) {
    if (!style || !Object.keys(style).length) return 0;
    const key = JSON.stringify(Object.entries(style).sort(([a], [b]) => a.localeCompare(b)));
    if (this.ids.has(key)) return this.ids.get(key);
    const index = this.xfs.length;
    if (index >= 64_000) throw new Error("This XLSX export supports up to 64,000 distinct cell styles.");
    this.ids.set(key, index);
    const color = (hex) => `<color rgb="FF${hex.slice(1).toUpperCase()}"/>`;
    const fontId = this.fonts.length;
    this.fonts.push(`<font>${style.bold ? "<b/>" : ""}${style.italic ? "<i/>" : ""}${style.underline ? "<u/>" : ""}<sz val="${style.size || 11}"/>${style.color ? color(style.color) : ""}<name val="${xmlEscape(style.font || "Calibri")}"/></font>`);
    let fillId = 0;
    if (style.fill) {
      fillId = this.fills.length;
      this.fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${style.fill.slice(1).toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`);
    }
    let borderId = 0;
    if (style.border) {
      borderId = this.borders.length;
      this.borders.push("<border>" + ["left", "right", "top", "bottom"]
        .map((edge) => `<${edge} style="thin">${color(style.border)}</${edge}>`).join("") + "<diagonal/></border>");
    }
    const numFmtId = this.numberFormat(style);
    this.xfs.push(`<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1"${fillId ? ' applyFill="1"' : ""}${borderId ? ' applyBorder="1"' : ""}${numFmtId ? ' applyNumberFormat="1"' : ""}${style.align ? ' applyAlignment="1"><alignment horizontal="' + style.align + '"/></xf>' : "/>"}`);
    return index;
  }

  numberFormat(style) {
    const digits = style.decimals ?? generalFormats[style.format]?.maximumFractionDigits ?? 0;
    const decimal = digits ? "." + "0".repeat(digits) : "";
    const formats = { currency: '"$"#,##0' + decimal, "currency-eur": '"€"#,##0' + decimal,
      percent: "0" + decimal + "%", integer: "#,##0" + decimal,
      number: "#,##0" + decimal, ...dateFormats };
    const code = style.xlsxFormat || formats[style.format];
    if (!code || /^general$/i.test(code)) return 0;
    if (!this.formats.has(code)) this.formats.set(code, 164 + this.formats.size);
    return this.formats.get(code);
  }

  xml() {
    const list = (name, items) => `<${name} count="${items.length}">${items.join("")}</${name}>`;
    const numbers = Array.from(this.formats, ([code, id]) => `<numFmt numFmtId="${id}" formatCode="${xmlEscape(code)}"/>`);
    return xmlHeader + `<styleSheet xmlns="${sheetNamespace}">` +
      (numbers.length ? list("numFmts", numbers) : "") +
      list("fonts", this.fonts) + list("fills", this.fills) + list("borders", this.borders) +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      list("cellXfs", this.xfs) + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }
}

class CellQueue {
  constructor() { this.items = []; }
  peek() { return this.items[0]; }

  push(key) {
    let index = this.items.length;
    while (index) {
      const parent = (index - 1) >> 1;
      if (this.items[parent] <= key) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = key;
  }

  pop() {
    const first = this.items[0];
    const last = this.items.pop();
    if (!this.items.length) return first;
    let index = 0;
    while (2 * index + 1 < this.items.length) {
      let child = 2 * index + 1;
      if (child + 1 < this.items.length && this.items[child + 1] < this.items[child]) child++;
      if (last <= this.items[child]) break;
      this.items[index] = this.items[child];
      index = child;
    }
    this.items[index] = last;
    return first;
  }
}

function xlsxCell(engine, sheet, row, column, styleId, imageId) {
  const reference = cellName(row, column);
  const raw = engine.raw(sheet.id, row, column);
  const start = `<c r="${reference}"${styleId ? ' s="' + styleId + '"' : ""}`;
  if (imageId) return start + ` t="e" vm="${imageId}"><v>#VALUE!</v></c>`;
  if (!raw) return start + "/>";
  const value = engine.value(sheet.id, row, column);
  const type = value.kind === ValueKind.boolean ? "b" : value.kind === ValueKind.error ? "e" :
    value.kind === ValueKind.text ? "str" : "";
  const number = Number.isFinite(value.number) ? String(value.number) : "";
  const cached = type === "b" ? (value.number ? "1" : "0") : type === "e" ?
    (xlsxErrors.has(value.text) ? value.text : "#VALUE!") : type === "str" ? xlsxText(value.text) : number;
  if (raw.startsWith("=")) {
    const omitCache = value.kind === ValueKind.error && !xlsxErrors.has(value.text);
    const formula = xlsxFormula(raw.slice(1));
    return start + (type && !omitCache ? ` t="${type}"` : "") + `><f>${xmlEscape(formula)}</f>` +
      (omitCache ? "" : `<v>${cached}</v>`) + "</c>";
  }
  if (type === "str") return start + ` t="inlineStr"><is><t xml:space="preserve">${xlsxText(value.text)}</t></is></c>`;
  return start + (type ? ` t="${type}"` : "") + `><v>${cached}</v></c>`;
}

function xlsxFormula(formula) {
  return formula.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'!|\b(?:XLOOKUP|CONCAT)\s*\(/gi,
    (token, position) => {
      if (token.startsWith('"') || token.startsWith("'") || /[\w.]/.test(formula[position - 1] || "")) return token;
      return "_xlfn." + token;
    });
}

async function sheetParts(engine, entry, styles) {
  if (entry.helper) return xlsxSpatialHelperSheet(entry.helper);
  const { sheet, drawing, cellImages, pivotRows } = entry;
  const output = new TextChunks();
  output.append(xmlHeader + `<worksheet xmlns="${sheetNamespace}" xmlns:r="${officeRels}">`);
  const columns = [...sheet.widths].sort(([a], [b]) => a - b);
  if (columns.length) output.append("<cols>" + columns.map(([column, width]) =>
    `<col min="${column + 1}" max="${column + 1}" width="${(width - 5) / 7}" customWidth="1"/>`).join("") + "</cols>");
  output.append("<sheetData>");
  if (pivotRows) {
    writeXlsxPivotRows(output, entry, engine, styles);
    output.append("</sheetData>" + (drawing ? '<drawing r:id="rId1"/>' : "") + "</worksheet>");
    return [...output.chunks, output.buffer];
  }
  const queue = new CellQueue();
  const styleKeys = Array.from(sheet.styles.keys()).sort((a, b) => a - b);
  const imageKeys = [...cellImages.keys()].sort((a, b) => a - b);
  const heights = Array.from(sheet.heights.keys()).sort((a, b) => a - b);
  for (let column = 0; column < engine.columns; column++) {
    const first = engine.nextRow(sheet.id, column, -1);
    if (first >= 0) queue.push(cellKey(first, column, engine.columns));
  }
  let styleIndex = 0, imageIndex = 0, heightIndex = 0, previousRow = -1, count = 0;
  while (queue.peek() !== undefined || styleIndex < styleKeys.length || imageIndex < imageKeys.length || heightIndex < heights.length) {
    const heightRow = heights[heightIndex] ?? Infinity;
    const nextCell = Math.min(queue.peek() ?? Infinity, styleKeys[styleIndex] ?? Infinity, imageKeys[imageIndex] ?? Infinity);
    const row = Math.min(heightRow, Math.floor(nextCell / engine.columns));
    if (row !== previousRow) {
      if (previousRow !== -1) output.append("</row>");
      const height = sheet.heights.get(row);
      output.append(`<row r="${row + 1}"${height ? ' ht="' + height * 0.75 + '" customHeight="1"' : ""}>`);
      previousRow = row;
    }
    if (heightRow === row) heightIndex++;
    if (Math.floor(nextCell / engine.columns) !== row) continue;
    const column = nextCell % engine.columns;
    if (nextCell === styleKeys[styleIndex]) styleIndex++;
    if (nextCell === imageKeys[imageIndex]) imageIndex++;
    if (nextCell === queue.peek()) {
      queue.pop();
      const next = engine.nextRow(sheet.id, column, row);
      if (next >= 0) queue.push(cellKey(next, column, engine.columns));
    }
    output.append(xlsxCell(engine, sheet, row, column, styles.index(sheet.styles.get(nextCell)), cellImages.get(nextCell)));
    if (++count % 16384 === 0) await yieldToBrowser();
  }
  if (previousRow !== -1) output.append("</row>");
  output.append("</sheetData>" + (drawing ? '<drawing r:id="rId1"/>' : "") + "</worksheet>");
  return [...output.chunks, output.buffer];
}

async function saveXlsx(engine, title, sheets, chartSnapshot, overwrite = false) {
  const styles = new XlsxStyles();
  const extendedRows = sheets.some((sheet) =>
    Array.from({ length: engine.columns }, (_, column) => engine.lastRow(sheet.id, column)).some((row) => row >= standardReaderRows) ||
    [...sheet.heights.keys()].some((row) => row >= standardReaderRows) ||
    [...sheet.styles.keys()].some((key) => Math.floor(key / engine.columns) >= standardReaderRows) ||
    [...(sheet.images || []), ...(sheet.embeddedCharts || [])].some(({ row }) => row >= standardReaderRows) ||
    [sheet.pivot, sheet.chart, ...(sheet.embeddedCharts || []).map(({ chart }) => chart)]
      .some((report) => report?.source?.bottom >= standardReaderRows));
  const zip = new ZipWriter();
  const entries = sheets.map((sheet, index) => ({ sheet, id: index + 1, path: `worksheets/sheet${index + 1}.xml` }));
  const cellImages = collectXlsxCellImages(engine, entries);
  const pivots = entries.filter(({ sheet }) => sheet.pivot);
  const spatial = planXlsxSpatialCharts(engine, sheets, entries);
  const rel = (id, type, target) => `<Relationship Id="rId${id}" Type="${type.includes("://") ? type : officeRels + "/" + type}" Target="${target}"/>`;
  const relationships = (items) => xmlHeader + `<Relationships xmlns="${packageRels}">${items.join("")}</Relationships>`;
  const contentType = (path, kind) => `<Override PartName="/xl/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${kind}+xml"/>`;
  const content = xmlHeader + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    contentType("workbook.xml", "sheet.main") + contentType("styles.xml", "styles") +
    '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
    entries.map(({ path }) => contentType(path, "worksheet")).join("") +
    (spatial.charts.length ? `<Override PartName="/${xlsxSpatialProperties}" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>` : "") +
    pivots.map(({ id, sheet }) => {
      const { table, cache, records } = xlsxPivotPaths(id);
      const { top, bottom, left, right } = sheet.pivot.source;
      return contentType(table, "pivotTable") + contentType(cache, "pivotCacheDefinition") +
        ((bottom - top) * (right - left + 1) <= 2_000_000 ? contentType(records, "pivotCacheRecords") : "");
    }).join("") +
    (cellImages.length ? richImageParts.map(({ path, kind }) => `<Override PartName="/xl/${path}" ContentType="${kind}"/>`).join("") : "") +
    entries.filter(({ drawing }) => drawing).map(({ id, charts }) =>
      `<Override PartName="/xl/drawings/drawing${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` +
      charts.filter(({ spatial }) => !spatial || spatial.native).map((_, index) =>
          `<Override PartName="/xl/charts/chart${id}-${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join("")
    ).join("") + "</Types>";
  const uses1904 = engine.date1904;
  const pivotRelationStart = entries.length + 2 + (cellImages.length ? richImageParts.length : 0);
  const workbook = xmlHeader + `<workbook xmlns="${sheetNamespace}" xmlns:r="${officeRels}"><workbookPr${uses1904 ? ' date1904="1"' : ""}/><sheets>` +
    entries.map(({ sheet, id, helper }) => `<sheet name="${xlsxText(sheet.name)}" sheetId="${id}"${helper ? ' state="veryHidden"' : ""} r:id="rId${id}"/>`).join("") +
    '</sheets><calcPr calcId="0" fullCalcOnLoad="1"/>' +
    (pivots.length ? "<pivotCaches>" + pivots.map(({ id }, index) =>
      `<pivotCache cacheId="${id}" r:id="rId${pivotRelationStart + index}"/>`).join("") + "</pivotCaches>" : "") + "</workbook>";
  await zip.add("[Content_Types].xml", [content]);
  await zip.add("_rels/.rels", [relationships([rel(1, "officeDocument", "xl/workbook.xml")])]);
  await zip.add("xl/workbook.xml", [workbook]);
  await zip.add("xl/_rels/workbook.xml.rels", [relationships([
    ...entries.map(({ id, path }) => rel(id, "worksheet", path)), rel(entries.length + 1, "styles", "styles.xml"),
    ...(cellImages.length ? richImageParts.map(({ path, relation }, index) => rel(entries.length + 2 + index, relation, path)) : []),
    ...pivots.map(({ id }, index) => rel(pivotRelationStart + index, "pivotCacheDefinition", xlsxPivotPaths(id).cache)),
    ...(spatial.charts.length ? [rel(pivotRelationStart + pivots.length, "customXml", "../" + xlsxSpatialPart)] : [])
  ])]);
  if (cellImages.length) await writeXlsxCellImages(zip, cellImages);
  if (spatial.charts.length) await writeXlsxSpatialMetadata(zip, spatial);
  for (const entry of entries) {
    const relations = [];
    if (entry.sheet.pivot) relations.push(await writeXlsxPivot(zip, engine, sheets, entry));
    await zip.add("xl/" + entry.path, await sheetParts(engine, entry, styles));
    if (entry.drawing) relations.push(await writeXlsxDrawing(zip, engine, sheets, entry, chartSnapshot));
    if (relations.length) await zip.add(relationshipPath("xl/" + entry.path), [xmlRelationships(relations)]);
  }
  await zip.add("xl/styles.xml", [styles.xml()]);
  return await saveOutputBlob(zip.blob(), filename(title) + ".xlsx", overwrite) ? extendedRows : null;
}
