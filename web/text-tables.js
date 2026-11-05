const textSeparators = [",", ";", "\t", "|"];
const textControlCharacters = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

function spacedTokens(line) {
  return [...line.matchAll(/[^ ]+(?: [^ ]+)*/g)];
}

function spacedFields(line, layout, aligned, row) {
  if (!line.trim()) return [""];
  if (line.includes("\t")) throw new DelimitedInputError("Row " + (row + 1) + " contains a tab in a space-aligned table.");
  const tokens = spacedTokens(line);
  if (aligned) {
    let boundary = 1;
    const crosses = tokens.some((token) => {
      while (boundary < layout.length && layout[boundary].start <= token.index) boundary++;
      return boundary < layout.length && layout[boundary].start < token.index + token[0].length;
    });
    if (!crosses) return layout.map((_, index) => line.slice(index ? layout[index].start : 0, layout[index + 1]?.start).trim());
  }
  if (tokens.length !== layout.length) throw new DelimitedInputError("Row " + (row + 1) + " does not match the detected columns.");
  return tokens.map(([text]) => text);
}

function inspectSpacedTable(sample, truncated, maxColumns) {
  if (sample.includes("\t")) return null;
  const lines = sample.split(/\r\n|\r|\n/);
  if (truncated || lines.at(-1) === "") lines.pop();
  const records = lines.map((line, row) => ({ line, row, tokens: spacedTokens(line) })).filter(({ tokens }) => tokens.length);
  if (records.filter(({ tokens }) => tokens.length >= 2).length < 2) return null;
  const count = records[0].tokens.length;
  const regular = count > 1 && count <= maxColumns && records.every(({ tokens }) => tokens.length === count);
  const occupied = new Uint8Array(Math.max(...records.map(({ line }) => line.length)));
  for (const { tokens } of records) {
    for (const token of tokens) occupied.fill(1, token.index, token.index + token[0].length);
  }
  const spans = [];
  let start = -1, end = -1;
  for (let index = 0; index < occupied.length; index++) {
    if (!occupied[index]) continue;
    if (start === -1 || index - end > 2) {
      if (start >= 0) spans.push({ start, width: end + 1 - start });
      start = index;
    }
    end = index;
  }
  spans.push({ start, width: end + 1 - start });
  const aligned = spans.length > 1 && spans.length <= maxColumns &&
    (!regular || (spans.length === count && records.every(({ tokens }) =>
      tokens.every((token, index) => token.index >= spans[index].start &&
        token.index + token[0].length <= spans[index].start + spans[index].width))));
  if (!aligned && !regular) return null;

  const layout = aligned ? spans : [];
  if (!aligned) {
    let start = Math.min(...records.map(({ tokens }) => tokens[0].index));
    for (let column = 0; column < count; column++) {
      const width = Math.max(...records.map(({ tokens }) => tokens[column][0].length));
      layout.push({ start, width });
      start += width + 2;
    }
  }
  if (aligned) {
    for (const [index, column] of layout.entries()) {
      const observations = [];
      for (const { line, row } of records) {
        const field = line.slice(index ? column.start : 0, layout[index + 1]?.start);
        if (!field.trim()) continue;
        const offset = index ? column.start : 0;
        observations.push({ row, start: offset + field.length - field.trimStart().length, end: offset + field.trimEnd().length });
      }
      const rightAligned = (cells) => cells.length >= 2 && cells.every(({ end }) => end === column.start + column.width) &&
        cells.some(({ start }) => start !== cells[0].start);
      if (rightAligned(observations)) column.right = true;
      else if (observations[0]?.row === records[0].row && rightAligned(observations.slice(1))) {
        column.right = true;
        column.headerRow = observations[0].row;
      }
    }
  }
  const recordLength = records[0].line.length;
  const rightPadding = aligned && records.every(({ line }) => line.length === recordLength) &&
    records.some(({ line }) => line.endsWith(" ")) ? recordLength - end - 1 : undefined;
  return { layout, aligned, columns: layout.length, rightPadding };
}

function separatorTouchesSpacing(sample, separator) {
  return sample.split(/\r\n|\r|\n/).some((line) => {
    const tokens = spacedTokens(line);
    return tokens.slice(0, -1).some((token, index) =>
      token[0].endsWith(separator) || tokens[index + 1][0].startsWith(separator));
  });
}

function spacedTableReader(format, onRow, engine) {
  let pending = "", afterCR = false, row = 0;
  const read = (line) => {
    const fields = spacedFields(line, format.layout, format.aligned, row++);
    if (fields.some((field) => field.length > engine.inputLimit)) throw new DelimitedInputError("A text field is too large.");
    onRow(fields);
  };
  return {
    feed(text) {
      if (afterCR && text.startsWith("\n")) text = text.slice(1);
      afterCR = text.endsWith("\r");
      const lines = (pending + text).split(/\r\n|\r|\n/);
      pending = lines.pop();
      if (pending.length > engine.columns * (engine.inputLimit + 2)) throw new DelimitedInputError("A text row is too large.");
      for (const line of lines) read(line);
    },
    finish() { if (pending) read(pending); }
  };
}

function validateTextImport(format, engine) {
  const { name, encoding, bom, eol, trailingNewline, rows, width, separator, layout, rightPadding } = format;
  const aligned = Array.isArray(layout) && layout.length >= 2 && layout.length <= engine.columns &&
    layout.every((column, index) => Number.isInteger(column?.start) && Number.isInteger(column?.width) &&
      column.start >= 0 && column.width > 0 && column.start + column.width <= 131_072 &&
      (!index || column.start >= layout[index - 1].start + layout[index - 1].width + 2));
  if (typeof name !== "string" || !name.length || name.length > 255 ||
      !["utf-8", "utf-16le", "utf-16be"].includes(encoding) || !["\n", "\r\n", "\r"].includes(eol) ||
      !Number.isInteger(rows) || rows < 0 || rows > engine.rows ||
      !Number.isInteger(width) || width < 0 || width > engine.columns ||
      (!textSeparators.includes(separator) && !aligned)) throw new Error("Invalid original text format.");
  return { name, encoding, bom: Boolean(bom), eol, trailingNewline: Boolean(trailingNewline), rows, width,
    separator: aligned ? undefined : separator,
    rightPadding: aligned && Number.isInteger(rightPadding) && rightPadding >= 0 && rightPadding <= 65_536 ? rightPadding : undefined,
    layout: aligned ? layout.map(({ start, width, right, headerRow }) => ({ start, width, right: Boolean(right),
      headerRow: Number.isInteger(headerRow) && headerRow >= 0 && headerRow < rows ? headerRow : undefined })) : undefined };
}

function originalTextValue(engine, sheet, row, column) {
  const raw = engine.raw(sheet.id, row, column);
  if (raw.startsWith("'")) return raw.slice(1);
  const style = sheet.styles.get(cellKey(row, column, engine.columns));
  if (dateFormats[style?.format]) return cellDisplay(engine.value(sheet.id, row, column), style);
  return raw.startsWith("=") ? engine.value(sheet.id, row, column).text : raw;
}

async function exportOriginalText(engine, sheet, overwrite = false) {
  const format = sheet.textImport;
  if (!format) throw new Error("Open a sheet imported from a text file first.");
  let { rows, width } = format;
  const widths = format.layout?.map((column) => column.width);
  let scanned = 0;
  for (let column = 0; column < engine.columns; column++) {
    const last = engine.lastRow(sheet.id, column);
    if (last === -1) continue;
    rows = Math.max(rows, last + 1);
    width = Math.max(width, column + 1);
    if (widths) {
      for (const row of occupiedColumn(engine, sheet, column)) {
        const text = originalTextValue(engine, sheet, row, column);
        if (/[\t\r\n]/.test(text)) throw new Error("Cell " + cellName(row, column) + " contains a tab or line break. Use Export CSV to keep it.");
        widths[column] = Math.max(widths[column] ?? 1, text.length);
        if (++scanned % 16384 === 0) await yieldToBrowser();
      }
    }
  }
  if (rows * width > 12_000_000) throw new Error("The original text export exceeds 12,000,000 fields.");
  const output = new TextChunks();
  const gaps = widths ? Array.from({ length: width }, (_, index) => {
    const a = format.layout[index], b = format.layout[index + 1];
    return " ".repeat(a && b ? Math.max(2, b.start - a.start - a.width) : 2);
  }) : null;
  const indent = " ".repeat(format.layout?.[0].start ?? 0);
  const padding = " ".repeat(format.rightPadding ?? 0);
  for (let row = 0; row < rows; row++) {
    const fields = [];
    for (let column = 0; column < width; column++) {
      const text = originalTextValue(engine, sheet, row, column);
      if (widths) {
        const layout = format.layout[column];
        const size = widths[column] ?? 1;
        const padded = layout?.right && layout.headerRow !== row ? text.padStart(size) : text.padEnd(size);
        fields.push(padded + (column < width - 1 ? gaps[column] : ""));
      } else fields.push(quoteDelimited(text, format.separator));
    }
    const line = widths ? indent + fields.join("") : fields.join(format.separator);
    output.append(widths ? (format.rightPadding === undefined ? line.trimEnd() : line + padding) : line);
    if (row < rows - 1 || format.trailingNewline) output.append(format.eol);
    if (row % 16384 === 16383) await yieldToBrowser();
  }
  return output.download(filename(format.name), "text/plain;charset=" + format.encoding, format.encoding, format.bom, overwrite);
}
