const xlsxPivotSummaries = ["sum", "count", "average", "min", "max", "countNums"];

function xlsxPivotPaths(id) {
  return {
    table: `pivotTables/pivotTable${id}.xml`,
    cache: `pivotCache/pivotCacheDefinition${id}.xml`,
    records: `pivotCache/pivotCacheRecords${id}.xml`
  };
}

function xlsxPivotItem(value) {
  if (value.kind === ValueKind.blank) return { tag: "m", value: "" };
  if (value.kind === ValueKind.number) return { tag: "n", value: value.number };
  if (value.kind === ValueKind.boolean) return { tag: "b", value: value.number ? 1 : 0 };
  if (value.kind === ValueKind.error && xlsxErrors.has(value.text)) return { tag: "e", value: value.text };
  return { tag: "s", value: value.text };
}

function xlsxPivotItemXml({ tag, value }) {
  return tag === "m" ? "<m/>" : `<${tag} v="${typeof value === "string" ? xlsxText(value) : value}"/>`;
}

function xlsxPivotCacheField(name, shared) {
  const kinds = new Set();
  const items = [], indexes = new Map();
  let minimum = Infinity, maximum = -Infinity, integers = true;
  const track = (value) => {
    const item = xlsxPivotItem(value);
    kinds.add(item.tag);
    if (item.tag === "n") {
      minimum = Math.min(minimum, item.value);
      maximum = Math.max(maximum, item.value);
      integers &&= Number.isInteger(item.value);
    }
    return item;
  };
  return {
    items,
    index(value) {
      const item = track(value);
      const key = item.tag + ":" + (item.tag === "s" ? item.value.toUpperCase() : item.value);
      if (!indexes.has(key)) {
        indexes.set(key, items.length);
        items.push({ ...item, text: value.text });
      }
      return indexes.get(key);
    },
    record(value) {
      if (shared) return `<x v="${this.index(value)}"/>`;
      return xlsxPivotItemXml(track(value));
    },
    xml() {
      const flags = `containsString="${Number(kinds.has("s"))}" containsNumber="${Number(kinds.has("n"))}"` +
        (kinds.has("m") ? ' containsBlank="1"' : "") +
        (kinds.has("n") ? ` containsSemiMixedTypes="${Number(kinds.size > 1)}" minValue="${minimum}" maxValue="${maximum}"` : "") +
        (kinds.has("n") && integers ? ' containsInteger="1"' : "");
      return `<cacheField name="${xlsxText(name)}" numFmtId="0"><sharedItems ${flags}` +
        (items.length ? ` count="${items.length}">${items.map(xlsxPivotItemXml).join("")}</sharedItems>` : "/>") + "</cacheField>";
    }
  };
}

function xlsxPivotSheetRows(report, groups, config, names, measures) {
  const { rowFields, columnField, filterField, filterValue } = config;
  const firstDataCol = rowFields.length;
  const reportRows = [];
  if (columnField >= 0) {
    const caption = ["'" + (measures.length === 1 ? measures[0] : "Values")];
    caption[firstDataCol] = "'" + names[columnField];
    reportRows.push(caption);
    const headings = report[0].slice(0, firstDataCol);
    const groupsRow = [...groups.columns.map((value) => value.text || "(blank)"), "Grand Total"];
    for (const label of groupsRow) {
      headings.push("'" + label, ...Array(measures.length - 1).fill(""));
    }
    reportRows.push(headings);
    if (measures.length > 1) reportRows.push([...Array(firstDataCol).fill(""),
      ...groupsRow.flatMap(() => measures.map((name) => "'" + name))]);
  } else reportRows.push([...report[0].slice(0, firstDataCol), ...measures.map((name) => "'" + name)]);
  const firstDataRow = reportRows.length;
  reportRows.push(...report.slice(1));
  const top = filterField >= 0 ? 2 : 0;
  return { top, firstDataRow, firstDataCol, width: report[0].length, height: reportRows.length,
    rows: top ? [["'" + names[filterField], "'" + (filterValue || "(blank)")], [], ...reportRows] : reportRows };
}

async function writeXlsxPivot(zip, engine, sheets, entry) {
  const config = validatePivot(entry.sheet.pivot, engine);
  const source = sheets.find((sheet) => sheet.name === config.sourceSheet);
  if (!source || source.pivot || source.chart) throw new Error("The pivot table source worksheet is unavailable.");
  const { left, right, top, bottom } = config.source;
  const fieldNames = sourceFields(engine, source, config.source).map(({ name }) => name);
  const names = Object.fromEntries(fieldNames.map((name, index) => [left + index, name]));
  const active = new Map(config.rowFields.map((column) => [column, "axisRow"]));
  if (config.columnField >= 0) active.set(config.columnField, "axisCol");
  if (config.filterField >= 0) active.set(config.filterField, "axisPage");
  const fields = fieldNames.map((name, index) => xlsxPivotCacheField(name, active.has(left + index)));
  const fieldAt = (column) => fields[column - left];
  let groups;
  const report = await pivotReport(engine, source, config, (result) => { groups = result; });
  const usedCaptions = new Set(fieldNames.map((name) => name.toUpperCase()));
  const measures = config.values.map(({ column, summary }) => {
    const base = `${pivotSummaries[summary]} of ${names[column]}`;
    let caption = base, suffix = 2;
    while (usedCaptions.has(caption.toUpperCase())) caption = `${base} ${suffix++}`;
    usedCaptions.add(caption.toUpperCase());
    return caption;
  });
  const display = xlsxPivotSheetRows(report, groups, config, names, measures);
  entry.pivotRows = display.rows;

  const rowItems = groups.rows.map((values) => "<i>" + values.map((value, index) =>
    `<x v="${fieldAt(config.rowFields[index]).index(value)}"/>`).join("") + "</i>");
  rowItems.push('<i t="grand"><x/></i>');
  const hasColumns = config.columnField >= 0;
  const multi = measures.length > 1;
  const columns = hasColumns ? groups.columns.map((value) => fieldAt(config.columnField).index(value)) : [];
  const columnItems = hasColumns ? columns.flatMap((column) => measures.map((_, index) =>
    `<i${multi ? ` i="${index}"` : ""}><x v="${column}"/>${multi ? `<x v="${index}"/>` : ""}</i>`)) :
    measures.map((_, index) => multi ? `<i i="${index}"><x v="${index}"/></i>` : "<i/>");
  if (hasColumns) columnItems.push(...measures.map((_, index) => multi
    ? `<i t="grand" i="${index}"><x/><x v="${index}"/></i>` : '<i t="grand"><x/></i>'));

  const { table, cache, records } = xlsxPivotPaths(entry.id);
  // Large sources rebuild their cache when the workbook opens.
  const saveData = (bottom - top) * fields.length <= 2_000_000;
  let recordCount = 0;
  if (saveData) {
    const output = new TextChunks();
    for (let row = top + 1; row <= bottom; row++) {
      const values = fields.map((_, index) => engine.value(source.id, row, left + index));
      if (values.some((value) => value.kind !== ValueKind.blank)) {
        output.append("<r>" + values.map((value, index) => fields[index].record(value)).join("") + "</r>");
        recordCount++;
      }
      if ((row - top) % 1024 === 0) await yieldToBrowser();
    }
    await zip.add("xl/" + records, [xmlHeader + `<pivotCacheRecords xmlns="${sheetNamespace}" count="${recordCount}">`,
      ...output.chunks, output.buffer, "</pivotCacheRecords>"]);
    await zip.add(relationshipPath("xl/" + cache), [xmlRelationships([{ id: 1, type: "pivotCacheRecords", target: records.split("/").at(-1) }])]);
  }
  const filter = config.filterField >= 0 ? fieldAt(config.filterField) : null;
  let filterItems = [];
  if (filter) {
    filterItems = filter.items.map(({ text }, index) => text.toUpperCase() === config.filterValue.toUpperCase() ? index : -1)
      .filter((index) => index >= 0);
    if (!filterItems.length) filterItems = [filter.index({ kind: config.filterValue ? ValueKind.text : ValueKind.blank, text: config.filterValue })];
  }
  const list = (tag, items) => items.length ? `<${tag} count="${items.length}">${items.join("")}</${tag}>` : "";
  const cacheXml = xmlHeader + `<pivotCacheDefinition xmlns="${sheetNamespace}" xmlns:r="${officeRels}"` +
    (saveData ? ' r:id="rId1"' : ' saveData="0" refreshOnLoad="1"') +
    ` recordCount="${recordCount}" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3">` +
    `<cacheSource type="worksheet"><worksheetSource ref="${rangeAddress(config.source)}" sheet="${xlsxText(config.sourceSheet)}"/></cacheSource>` +
    list("cacheFields", fields.map((field) => field.xml())) + "</pivotCacheDefinition>";
  const pivotFields = fields.map((field, index) => {
    const column = left + index;
    const axis = active.get(column);
    const data = config.values.some((value) => value.column === column) ? ' dataField="1"' : "";
    if (!axis) return `<pivotField showAll="0"${data}/>`;
    const page = axis === "axisPage";
    const items = field.items.map((_, i) => `<item x="${i}"${page && filterItems.length > 1 && !filterItems.includes(i) ? ' h="1"' : ""}/>`);
    return `<pivotField axis="${axis}" showAll="0" defaultSubtotal="0"${data}${page && filterItems.length > 1 ? ' multipleItemSelectionAllowed="1"' : ""}>` +
      list("items", items) + "</pivotField>";
  });
  const axisField = (column) => `<field x="${column - left}"/>`;
  const tableXml = xmlHeader + `<pivotTableDefinition xmlns="${sheetNamespace}" name="GridsNTabsPivot${entry.id}" cacheId="${entry.id}"` +
    ' dataCaption="Values" createdVersion="6" updatedVersion="6" minRefreshableVersion="3" compact="0" compactData="0" indent="0">' +
    `<location ref="A${display.top + 1}:${cellName(display.top + display.height - 1, display.width - 1)}" firstHeaderRow="1"` +
    ` firstDataRow="${display.firstDataRow}" firstDataCol="${display.firstDataCol}"${filter ? ' rowPageCount="1" colPageCount="1"' : ""}/>` +
    list("pivotFields", pivotFields) + list("rowFields", config.rowFields.map(axisField)) + list("rowItems", rowItems) +
    list("colFields", [...(hasColumns ? [axisField(config.columnField)] : []), ...(multi ? ['<field x="-2"/>'] : [])]) +
    list("colItems", columnItems) +
    (filter ? list("pageFields", [`<pageField fld="${config.filterField - left}" hier="-1"${filterItems.length === 1 ? ` item="${filterItems[0]}"` : ""}/>`]) : "") +
    list("dataFields", config.values.map(({ column, summary }, index) =>
      `<dataField name="${xlsxText(measures[index])}" fld="${column - left}" subtotal="${xlsxPivotSummaries[summary]}" baseField="0" baseItem="0"/>`)) +
    '<pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0"/>' +
    "</pivotTableDefinition>";
  await zip.add("xl/" + cache, [cacheXml]);
  await zip.add("xl/" + table, [tableXml]);
  await zip.add(relationshipPath("xl/" + table), [xmlRelationships([{ id: 1, type: "pivotCacheDefinition", target: "../" + cache }])]);
  return { id: 2, type: "pivotTable", target: "../" + table };
}

function xlsxPivotFilterText(item, engine) {
  const value = item?.getAttribute("v");
  if (item?.localName === "m") return "";
  if (item?.localName === "b") return value === "1" || value === "true" ? "TRUE" : "FALSE";
  if (item?.localName === "d") {
    const time = Date.parse(value?.endsWith("Z") ? value : value + "Z");
    return Number.isFinite(time) ? String(serialDate(time, engine.date1904)) : undefined;
  }
  return value === null || value === undefined ? undefined : decodeXlsxText(value);
}

function xlsxDedicatedPivotSheet(engine, sheet, location, page) {
  if (sheet.chart) return false;
  for (let column = 0; column < engine.columns; column++) {
    const last = engine.lastRow(sheet.id, column);
    if (last < 0) continue;
    if (column < location.left || column > location.right || last > location.bottom) return false;
    for (let row = engine.nextRow(sheet.id, column, -1); row >= 0 && row < location.top;
      row = engine.nextRow(sheet.id, column, row)) {
      if (!page || row < location.top - 2 || column > location.left + 1) return false;
    }
  }
  return true;
}

async function readXlsxPivot(zip, path, cachePaths, tables, engine, sheet, sheets) {
  const read = async (name) => readXml(await zip.text(name));
  const xml = await read(path);
  const cachePath = cachePaths.get(xml.getAttribute("cacheId"));
  if (!cachePath || child(xml, "filters") || child(xml, "conditionalFormats") ||
      ["0", "false"].includes(xml.getAttribute("rowGrandTotals")) ||
      ["0", "false"].includes(xml.getAttribute("colGrandTotals"))) return null;
  const cache = await read(cachePath);
  const cacheSource = child(cache, "cacheSource");
  const worksheet = child(cacheSource, "worksheetSource");
  if (cacheSource?.getAttribute("type") !== "worksheet" || !worksheet || drawingId(worksheet)) return null;
  const table = tables.get(worksheet.getAttribute("name"));
  const sheetName = decodeXlsxText(worksheet.getAttribute("sheet") || table?.sheet || "");
  const range = worksheet.getAttribute("ref") || table?.ref;
  const sourceSheet = sheets.find((candidate) => candidate !== sheet && candidate.name === sheetName && !candidate.chart);
  if (!range || !sourceSheet) return null;
  const source = sourceRange(range, engine);
  const fieldIndex = (node, name) => Number(node.getAttribute(name) ?? NaN);
  const rowFields = children(child(xml, "rowFields"), "field").map((node) => fieldIndex(node, "x"));
  const columnFields = children(child(xml, "colFields"), "field").map((node) => fieldIndex(node, "x")).filter((index) => index !== -2);
  const pages = children(child(xml, "pageFields"), "pageField");
  if (columnFields.length > 1 || pages.length > 1) return null;
  const fields = children(child(xml, "pivotFields"), "pivotField");
  if ([...rowFields, ...columnFields].some((index) => children(child(fields[index], "items"), "item")
    .some((node) => ["1", "true"].includes(node.getAttribute("h"))))) return null;
  if (rowFields.length > 1 && !["0", "false"].includes(fields[rowFields[0]]?.getAttribute("defaultSubtotal"))) return null;
  const values = children(child(xml, "dataFields"), "dataField").map((node) => ({
    column: source.left + fieldIndex(node, "fld"), summary: xlsxPivotSummaries.indexOf(node.getAttribute("subtotal") || "sum")
  }));
  let filterField = -1, filterValue = "";
  if (pages.length) {
    const page = pages[0], index = fieldIndex(page, "fld");
    const items = children(child(fields[index], "items"), "item");
    const requested = page.getAttribute("item");
    const selection = requested !== null ? [items[Number(requested)]].filter(Boolean) :
      items.some((item) => ["1", "true"].includes(item.getAttribute("h"))) ?
        items.filter((item) => item.hasAttribute("x") && !["1", "true"].includes(item.getAttribute("h"))) : [];
    const cacheField = children(child(cache, "cacheFields"), "cacheField")[index];
    const shared = Array.from(child(cacheField, "sharedItems")?.children || []);
    const selected = selection.map((item) => xlsxPivotFilterText(shared[fieldIndex(item, "x")], engine));
    if (!selected.length || selected.some((value) => value === undefined || value.toUpperCase() !== selected[0]?.toUpperCase())) return null;
    filterField = source.left + index;
    filterValue = selected[0];
  }
  const ref = child(xml, "location")?.getAttribute("ref");
  if (!ref || !xlsxDedicatedPivotSheet(engine, sheet, sourceRange(ref, engine), pages.length)) return null;
  return validatePivot({ sourceSheet: sourceSheet.name, source,
    rowFields: rowFields.map((index) => source.left + index),
    columnField: columnFields.length ? source.left + columnFields[0] : -1, filterField, filterValue, values }, engine);
}

function writeXlsxPivotRows(output, entry, engine, styles) {
  const { sheet, pivotRows } = entry;
  const last = engine.lastRow(sheet.id, 0);
  for (const [row, values] of pivotRows.entries()) {
    if (!values.some(Boolean)) continue;
    const height = sheet.heights.get(row);
    output.append(`<row r="${row + 1}"${height ? ` ht="${height * 0.75}" customHeight="1"` : ""}>`);
    for (const [column, raw] of values.entries()) {
      if (!raw) continue;
      const modelRow = row === pivotRows.length - 1 ? last : row === 0 ? 0 : -1;
      const style = modelRow >= 0 ? styles.index(sheet.styles.get(cellKey(modelRow, column, engine.columns))) : 0;
      const start = `<c r="${cellName(row, column)}"${style ? ` s="${style}"` : ""}`;
      if (raw.startsWith("'")) output.append(start + ` t="inlineStr"><is><t xml:space="preserve">${xlsxText(raw.slice(1))}</t></is></c>`);
      else if (xlsxErrors.has(raw)) output.append(start + ` t="e"><v>${raw}</v></c>`);
      else if (raw === "TRUE" || raw === "FALSE") output.append(start + ` t="b"><v>${Number(raw === "TRUE")}</v></c>`);
      else output.append(start + `><v>${xmlEscape(raw)}</v></c>`);
    }
    output.append("</row>");
  }
}
