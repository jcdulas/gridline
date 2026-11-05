const formulaColors = ["#245eae", "#a73555", "#16734d", "#8244a5", "#9a4e0c", "#007787"];
const formulaReferenceEnd = /\s*\(/y;

function formulaReferenceBounds(first, last, { rows, columns }) {
  const from = parseAddress(first, rows, columns);
  const to = last ? parseAddress(last, rows, columns) : from;
  if (from && to) return selectionBounds({ anchor: from, end: to });
  if (!last) return null;
  if ([first, last].every((part) => /^\$?[a-z]{1,3}$/i.test(part))) {
    const left = parseAddress(first + "1", rows, columns);
    const right = parseAddress(last + "1", rows, columns);
    if (left && right) return { top: 0, bottom: rows - 1,
      left: Math.min(left.column, right.column), right: Math.max(left.column, right.column) };
  }
  if ([first, last].every((part) => /^\$?\d{1,7}$/.test(part))) {
    const top = parseAddress("A" + first, rows, columns);
    const bottom = parseAddress("A" + last, rows, columns);
    if (top && bottom) return { top: Math.min(top.row, bottom.row), bottom: Math.max(top.row, bottom.row),
      left: 0, right: columns - 1 };
  }
  return null;
}

function formulaReferences(text, activeSheet, engine) {
  if (!text.startsWith("=")) return [];
  // Consume quoted text and structured reference brackets before looking for A1 references.
  const tokens = /"(?:[^"]|"")*(?:"|$)|\[[^\]]*(?:\]|$)|(?<![\p{L}\p{N}_.$!#\]])(?:(?<sheet>'(?:[^']|'')*'|[\p{L}_][\p{L}\p{N}_.]*)!)?(?<first>\$?[a-z]{1,3}(?:\$?\d{1,7})?|\$?\d{1,7})(?:\s*:\s*(?<last>\$?[a-z]{1,3}(?:\$?\d{1,7})?|\$?\d{1,7}))?(?![\p{L}\p{N}_.$!])/giu;
  const references = [];
  const assigned = new Map();
  const currentSheet = activeSheet.toUpperCase();
  for (const match of text.matchAll(tokens)) {
    const { sheet, first, last } = match.groups;
    if (!first) continue;
    const end = match.index + match[0].length;
    formulaReferenceEnd.lastIndex = end;
    if (!sheet && !last && formulaReferenceEnd.test(text)) continue;
    const bounds = formulaReferenceBounds(first, last, engine);
    if (!bounds) continue;
    const sheetName = (sheet?.startsWith("'") ? sheet.slice(1, -1).replaceAll("''", "'") : sheet || activeSheet).toUpperCase();
    const key = JSON.stringify([sheetName, bounds.top, bounds.bottom, bounds.left, bounds.right]);
    const existing = assigned.get(key);
    const color = existing || formulaColors[assigned.size % formulaColors.length];
    assigned.set(key, color);
    references.push({ start: match.index, end, color, bounds: sheetName === currentSheet && !existing ? bounds : null });
  }
  return references;
}

function syncFormulaPreview(input, preview) {
  preview.scrollLeft = input.scrollLeft;
  preview.scrollTop = input.scrollTop;
}

function showFormulaPreview(input, preview, references) {
  const visible = !input.hidden && references.length > 0;
  preview.hidden = !visible;
  input.classList.toggle("formula-colored", visible);
  if (!visible) {
    preview.replaceChildren();
    return;
  }
  const fragment = document.createDocumentFragment();
  const text = input.value;
  let start = 0;
  for (const reference of references) {
    fragment.append(text.slice(start, reference.start));
    const span = document.createElement("span");
    span.style.color = reference.color;
    span.textContent = text.slice(reference.start, reference.end);
    fragment.append(span);
    start = reference.end;
  }
  fragment.append(text.slice(start));
  preview.replaceChildren(fragment);
  syncFormulaPreview(input, preview);
}
