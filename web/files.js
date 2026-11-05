function newSheetModel(id, name) {
  const first = { row: 0, column: 0 };
  return {
    id, name, top: 0, left: 0, selection: { anchor: first, end: first },
    styles: new Map(), widths: new Map(), heights: new Map()
  };
}

function* occupiedColumn(engine, sheet, column, top = 0, bottom = engine.rows - 1) {
  for (let row = engine.nextRow(sheet.id, column, top - 1); row !== -1 && row <= bottom;
    row = engine.nextRow(sheet.id, column, row)) yield row;
}

class TextChunks {
  constructor() {
    this.chunks = [];
    this.buffer = "";
  }

  append(text) {
    this.buffer += text;
    if (this.buffer.length >= 131072) {
      this.chunks.push(this.buffer);
      this.buffer = "";
    }
  }

  download(filename, type, encoding = "utf-8", bom = false, overwrite = false) {
    let parts = [...this.chunks, this.buffer];
    if (encoding !== "utf-8") {
      const littleEndian = encoding === "utf-16le";
      parts = parts.map((text) => {
        const data = new DataView(new ArrayBuffer(text.length * 2));
        for (let index = 0; index < text.length; index++) data.setUint16(index * 2, text.charCodeAt(index), littleEndian);
        return data.buffer;
      });
    }
    if (bom) parts.unshift(Uint8Array.from(encoding === "utf-16le" ? [255, 254] :
      encoding === "utf-16be" ? [254, 255] : [239, 187, 191]));
    return saveOutputBlob(new Blob(parts, { type }), filename, overwrite);
  }
}

function filename(title) { return title.replace(/[\\/:*?"<>|]/g, "_") || "Workbook"; }
function yieldToBrowser() { return new Promise((resolve) => setTimeout(resolve, 0)); }

async function saveWorkbook(engine, title, sheets, overwrite = false) {
  const output = new TextChunks();
  const append = (record) => output.append(JSON.stringify(record) + "\n");
  append({ format: "gridline", version: 1, title, date1904: engine.date1904 });
  let count = 0;
  for (const sheet of sheets) {
    append(["sheet", sheet.name, [...sheet.widths], [...sheet.heights],
      { pivot: sheet.pivot, chart: sheet.chart, textImport: sheet.textImport }]);
    for (const image of sheet.images || []) append(["image", image]);
    for (const chart of sheet.embeddedCharts || []) append(["chart", chart]);
    for (let column = 0; column < engine.columns; column++) {
      for (const row of occupiedColumn(engine, sheet, column)) {
        append(["cell", row, column, engine.raw(sheet.id, row, column)]);
        if (++count % 32768 === 0) await yieldToBrowser();
      }
    }
    for (const [key, style] of sheet.styles) {
      append(["style", Math.floor(key / engine.columns), key % engine.columns, style]);
      if (++count % 32768 === 0) await yieldToBrowser();
    }
  }
  return output.download(filename(title) + ".gridline", "application/x-ndjson;charset=utf-8", "utf-8", false, overwrite);
}

async function* fileLines(file) {
  const stream = file.stream().pipeThrough(new TextDecoderStream());
  let rest = "";
  for await (const chunk of stream) {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop();
    if (rest.length > 4_000_000) throw new Error("A workbook record is too large.");
    yield* lines;
  }
  if (rest) yield rest;
}

function validSheetName(name) {
  return typeof name === "string" && name === name.trim() && name.length > 0 &&
    Array.from(name).length <= 31 && !/[\[\]:*?/\\\x00-\x1f]/.test(name);
}

function boundedSizes(entries, count, minimum, maximum) {
  if (!Array.isArray(entries)) throw new Error("Invalid worksheet dimensions.");
  const result = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry)) throw new Error("Invalid worksheet dimensions.");
    const [index, size] = entry;
    if (!Number.isInteger(index) || index < 0 || index >= count ||
        !Number.isInteger(size) || size < minimum || size > maximum) {
      throw new Error("Invalid worksheet dimensions.");
    }
    result.set(index, size);
  }
  return result;
}

function cleanStyle(style) {
  if (!style || typeof style !== "object" || Array.isArray(style)) throw new Error("Invalid cell style.");
  const result = {};
  for (const key of ["bold", "italic", "underline"]) if (style[key] === true) result[key] = true;
  for (const key of ["fill", "color", "border"]) {
    if (typeof style[key] === "string" && /^#[\da-f]{6}$/i.test(style[key])) result[key] = style[key];
  }
  if (fonts.includes(style.font)) result.font = style.font;
  if (Number.isInteger(style.size) && style.size >= 9 && style.size <= 32) result.size = style.size;
  if (["left", "center", "right"].includes(style.align)) result.align = style.align;
  if (formats.some(([format]) => format === style.format)) result.format = style.format;
  if (Number.isInteger(style.decimals) && style.decimals >= 0 && style.decimals <= 10) result.decimals = style.decimals;
  // The older native workbook format used a different key for the same value.
  const formatCode = style.xlsxFormat ?? style.excelFormat;
  if (typeof formatCode === "string" && formatCode.length <= 255) result.xlsxFormat = formatCode;
  if (style.date1904 === true) result.date1904 = true;
  return result;
}

async function openWorkbook(file) {
  const engine = await WorkbookEngine.load();
  const sheets = [];
  let title = "";
  let date1904;
  let sheet;
  let count = 0;
  for await (const line of fileLines(file)) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); }
    catch { throw new Error("This file is not a valid Gridline workbook."); }
    if (title === "") {
      if (record?.format !== "gridline" || record.version !== 1 || typeof record.title !== "string") {
        throw new Error("This file is not a supported Gridline workbook.");
      }
      title = record.title.trim().slice(0, 120) || "Workbook";
      date1904 = record.date1904;
      continue;
    }
    if (!Array.isArray(record)) throw new Error("Invalid workbook record.");
    const [type, first, second, third] = record;
    if (type === "image" && sheet && !sheet.chart) {
      (sheet.images ??= []).push(validateImage(first, engine));
      continue;
    }
    if (type === "chart" && sheet && !sheet.chart) {
      (sheet.embeddedCharts ??= []).push(validateEmbeddedChart(first, engine));
      continue;
    }
    if (type === "sheet") {
      if (!validSheetName(first)) throw new Error("Invalid worksheet name.");
      const id = engine.addSheet(first);
      if (!id) throw new Error("Worksheet names must be unique.");
      sheet = newSheetModel(id, first);
      sheet.widths = boundedSizes(second, engine.columns, 28, 500);
      sheet.heights = boundedSizes(third, engine.rows, 16, 160);
      const reports = record[4];
      if (reports?.pivot && reports?.chart) throw new Error("A worksheet cannot contain both report types.");
      if (reports?.pivot) sheet.pivot = validatePivot(reports.pivot, engine);
      if (reports?.chart) sheet.chart = validateChart(reports.chart, engine);
      if (reports?.textImport) sheet.textImport = validateTextImport(reports.textImport, engine);
      sheets.push(sheet);
      continue;
    }
    if (!sheet || !Number.isInteger(first) || first < 0 || first >= engine.rows ||
        !Number.isInteger(second) || second < 0 || second >= engine.columns) {
      throw new Error("The file contains an invalid cell address.");
    }
    if (type === "cell" && typeof third === "string") engine.set(sheet.id, first, second, third);
    else if (type === "style") sheet.styles.set(cellKey(first, second, engine.columns), cleanStyle(third));
    else throw new Error("Invalid workbook record.");
    if (++count % 32768 === 0) await yieldToBrowser();
  }
  if (!sheets.length) throw new Error("The workbook contains no worksheets.");
  engine.setDateSystem(date1904 ?? sheets.some((sheet) => [...sheet.styles.values()].some((style) => style.date1904)));
  const sourceNames = new Set(sheets.filter((sheet) => !sheet.pivot && !sheet.chart).map((sheet) => sheet.name));
  if (sheets.some((sheet) => {
    const reports = [sheet.pivot, sheet.chart, ...(sheet.embeddedCharts || []).map(({ chart }) => chart)];
    return reports.some((report) => report && !sourceNames.has(report.sourceSheet));
  })) throw new Error("A report references a missing source worksheet.");
  return { title, engine, sheets };
}

class DelimitedInputError extends Error {}

class DelimitedReader {
  constructor(separator, onRow, maxColumns, maxFieldSize) {
    this.separator = separator;
    this.onRow = onRow;
    this.maxColumns = maxColumns;
    this.maxFieldSize = maxFieldSize;
    this.row = [];
    this.field = "";
    this.state = "unquoted";
    this.afterCR = false;
  }

  feed(text) {
    for (const character of text) {
      if (this.afterCR) {
        this.afterCR = false;
        if (character === "\n") continue;
      }
      if (this.state === "quoted") {
        if (character === '"') this.state = "after quote";
        else this.append(character);
        continue;
      }
      if (this.state === "after quote") {
        if (character === '"') {
          this.append(character);
          this.state = "quoted";
          continue;
        }
        if (![this.separator, "\n", "\r"].includes(character)) {
          throw new DelimitedInputError("Unexpected characters after a quoted CSV field.");
        }
      }
      if (character === this.separator) this.endField();
      else if (character === "\n" || character === "\r") {
        this.endRow();
        this.afterCR = character === "\r";
      } else if (character === '"' && this.field.length === 0) this.state = "quoted";
      else this.append(character);
    }
  }

  append(character) {
    this.field += character;
    if (this.field.length > this.maxFieldSize) throw new DelimitedInputError("A CSV field is too large.");
  }

  endField() {
    if (this.row.length >= this.maxColumns) throw new DelimitedInputError("The data exceeds the worksheet width.");
    this.row.push(this.field);
    this.field = "";
    this.state = "unquoted";
  }

  endRow() {
    this.endField();
    this.onRow(this.row);
    this.row = [];
  }

  finish() {
    if (this.state === "quoted") throw new DelimitedInputError("The CSV file ends inside a quoted field.");
    if (this.field || this.row.length || this.state === "after quote") this.endRow();
  }
}

function declaredDelimiter(file) {
  if (/\.tsv$/i.test(file.name)) return "\t";
  if (/\.csv$/i.test(file.name)) return ",";
  if (file.type === "text/tab-separated-values") return "\t";
  if (file.type === "text/csv") return ",";
  return null;
}

function isTextImportCandidate(file) {
  return /\.(txt|text)$/i.test(file.name) || file.type.startsWith("text/") ||
    !file.type || file.type === "application/octet-stream";
}

function blankDelimitedRow(fields) {
  return fields.length === 1 && !fields[0].trim();
}

async function inspectDelimitedFile(file, engine) {
  const declared = declaredDelimiter(file);
  const bytes = new Uint8Array(await file.slice(0, 65_536).arrayBuffer());
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" :
    bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  const bom = encoding !== "utf-8" || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
  const truncated = bytes.length < file.size;
  const error = () => new DelimitedInputError("No clear table was found. Use at least two tabular rows separated by commas, semicolons, tabs, pipes, or several spaces.");
  let sample;
  try { sample = new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: truncated }); }
  catch {
    if (!declared) throw error();
    sample = "";
  }
  const base = { encoding, bom, eol: sample.match(/\r\n|\r|\n/)?.[0] ?? "\n" };
  if (textControlCharacters.test(sample)) {
    if (declared) return { ...base, separator: declared };
    throw error();
  }

  const matches = [];
  for (const separator of textSeparators) {
    let columns = 0, records = 0, consistent = true;
    const reader = new DelimitedReader(separator, (fields) => {
      if (blankDelimitedRow(fields)) return;
      if (!columns) columns = fields.length;
      if (fields.length !== columns) consistent = false;
      if (fields.some((field) => field.trim())) records++;
    }, engine.columns, engine.inputLimit);
    try {
      reader.feed(sample);
      // The sample can end inside a quoted field or partway through a row.
      if (!truncated) reader.finish();
      if (consistent && columns > 1 && records >= 2) matches.push({ separator, columns });
    } catch { /* This separator does not fit the sample. */ }
  }
  matches.sort((a, b) => b.columns - a.columns);
  const [best, alternative] = matches;
  if (declared && matches.some(({ separator }) => separator === declared)) return { ...base, separator: declared };
  const spaced = inspectSpacedTable(sample, truncated, engine.columns);
  // A stable space layout can contain a delimiter within values, such as
  // decimal commas. Punctuation at a space boundary favors that delimiter.
  if (spaced?.aligned && best && !sample.includes('"') &&
      !matches.some(({ separator }) => separatorTouchesSpacing(sample, separator))) return { ...base, ...spaced };
  if (best && best.columns !== alternative?.columns) return { ...base, ...best };
  if (spaced) return { ...base, ...spaced };
  if (declared) return { ...base, separator: declared };
  throw error();
}

async function importDelimited(engine, sheet, file, format) {
  const { separator, encoding, columns } = format;
  let row = 0, width = columns ?? 0, trailingNewline = false;
  const onRow = (fields) => {
    if (row >= engine.rows) throw new DelimitedInputError("The file exceeds 8,000,000 rows.");
    if (columns && fields.length !== columns && !blankDelimitedRow(fields)) {
      throw new DelimitedInputError("Row " + (row + 1) + " has " + fields.length + " fields. The detected table has " + columns + " columns.");
    }
    for (const [column, text] of fields.entries()) {
      if (!text) continue;
      const cell = calendarInput(text, undefined, engine);
      engine.set(sheet.id, row, column, /^[=']/.test(text) ? "'" + text : cell.text);
      if (cell.style) sheet.styles.set(cellKey(row, column, engine.columns), cell.style);
    }
    width = Math.max(width, fields.length);
    row++;
  };
  const reader = format.layout ? spacedTableReader(format, onRow, engine) :
    new DelimitedReader(separator, onRow, engine.columns, engine.inputLimit);
  let previousYield = performance.now();
  for await (const chunk of file.stream().pipeThrough(new TextDecoderStream(encoding, { fatal: Boolean(columns) }))) {
    if (columns && textControlCharacters.test(chunk)) throw new DelimitedInputError("The file contains non-text characters.");
    if (chunk.length) trailingNewline = /[\r\n]$/.test(chunk);
    reader.feed(chunk);
    if (performance.now() - previousYield > 45) {
      await yieldToBrowser();
      previousYield = performance.now();
    }
  }
  reader.finish();
  sheet.textImport = validateTextImport({ ...format, name: file.name, rows: row, width, trailingNewline }, engine);
  return row;
}

function delimitedSheetName(name) {
  return Array.from(name.replace(/\.[^.]+$/, "").replace(/[\[\]:*?/\\\x00-\x1f]/g, "_").trim()).slice(0, 25).join("") || "Import";
}

async function createDelimitedSheet(engine, file, name) {
  const format = await inspectDelimitedFile(file, engine);
  const id = engine.addSheet(name);
  if (!id) throw new Error("The worksheet could not be created.");
  const sheet = newSheetModel(id, name);
  try {
    return { sheet, rows: await importDelimited(engine, sheet, file, format) };
  } catch (error) {
    engine.removeSheet(id);
    throw error;
  }
}

function quoteDelimited(value, separator) {
  return value.includes(separator) || /["\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
}

async function exportCsv(engine, sheet, bounds) {
  if (!bounds) {
    let right = -1;
    let bottom = -1;
    for (let column = 0; column < engine.columns; column++) {
      const last = engine.lastRow(sheet.id, column);
      if (last !== -1) {
        right = column;
        bottom = Math.max(bottom, last);
      }
      if (column % 10 === 0) await yieldToBrowser();
    }
    bounds = { top: 0, left: 0, bottom, right };
  }
  const { top, bottom, left, right } = bounds;
  if ((bottom - top + 1) * (right - left + 1) > 12_000_000) {
    throw new Error("Select a smaller range for CSV, or save the sparse workbook as a Gridline file.");
  }
  const output = new TextChunks();
  for (let row = top; row <= bottom; row++) {
    const fields = [];
    for (let column = left; column <= right; column++) {
      const value = engine.value(sheet.id, row, column);
      let text = value.text;
      // Protect text that another spreadsheet might interpret as executable formulas.
      if (value.kind === ValueKind.text && /^\s*[=+@-]/.test(text)) text = "'" + text;
      fields.push(quoteDelimited(text, ","));
    }
    output.append(fields.join(",") + "\r\n");
    if ((row - top) % 16384 === 16383) await yieldToBrowser();
  }
  return output.download(filename(sheet.name) + ".csv", "text/csv;charset=utf-8");
}
