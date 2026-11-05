function detectedTable(app, cell) {
  if (app.sheet.pivot || app.sheet.chart || !app.raw(cell)) return null;
  const { row, column } = cell;
  const { rows, columns } = app.engine;
  const occupied = (row, column) => Boolean(app.raw({ row, column }));
  let left = column, right = column, top = row, bottom = row;
  const adjacentColumn = (index) => occupied(row, index) ||
    (row > 0 && occupied(row - 1, index)) || (row < rows - 1 && occupied(row + 1, index));
  while (left > 0 && adjacentColumn(left - 1)) left--;
  while (right < columns - 1 && adjacentColumn(right + 1)) right++;
  if (right === left) return null;
  const rowHasData = (index) => {
    if (occupied(index, column)) return true;
    for (let col = left; col <= right; col++) if (col !== column && occupied(index, col)) return true;
    return false;
  };
  const topLimit = Math.max(0, row - 64), bottomLimit = Math.min(rows - 1, row + 128);
  while (top > topLimit && rowHasData(top - 1)) top--;
  while (bottom < bottomLimit && rowHasData(bottom + 1)) bottom++;
  if (bottom === top) return null;
  // A visually separated summary is a useful boundary for the source range.
  if (bottom > top + 1 && /^(?:grand\s+)?(?:sub)?totals?$/i.test(app.engine.value(app.sheet.id, bottom, left).text.trim())) bottom--;
  const axis = tableHeaderAxis(app, { top, bottom, left, right });
  if (!axis) return null;
  return { top, bottom, left, right, axis,
    moreAbove: top > 0 && top === topLimit, moreBelow: bottom < rows - 1 && bottom === bottomLimit };
}

function tableHeaderAxis(app, { top, bottom, left, right }) {
  if (bottom <= top || right <= left || app.sheet.chart || app.sheet.pivot) return null;
  const score = (header, body) => {
    const names = new Set();
    let score = 0, textual = 0;
    for (let index = 0; index < header.length; index++) {
      const cell = header[index];
      const value = app.engine.value(app.sheet.id, cell.row, cell.column);
      if (value.kind !== ValueKind.text || !value.text.trim()) continue;
      const name = value.text.trim().toUpperCase();
      if (names.has(name)) { score -= 1; continue; }
      names.add(name);
      textual++;
      score += 2;
      const neighbor = body[index];
      const sample = app.engine.value(app.sheet.id, neighbor.row, neighbor.column);
      if (sample.kind === ValueKind.number || sample.kind === ValueKind.boolean) score += 2;
      const style = app.style(cell), near = app.style(neighbor);
      if ((style?.bold && !near?.bold) || (style?.fill && style.fill !== near?.fill)) score++;
    }
    return textual >= 2 && textual >= Math.ceil(header.length * 0.6) ? score / header.length : 0;
  };
  const width = Math.min(40, right - left + 1), height = Math.min(40, bottom - top + 1);
  const topCells = Array.from({ length: width }, (_, index) => ({ row: top, column: left + index }));
  const leftCells = Array.from({ length: height }, (_, index) => ({ row: top + index, column: left }));
  const columnScore = score(topCells, topCells.map((cell) => ({ ...cell, row: top + 1 })));
  const rowScore = score(leftCells, leftCells.map((cell) => ({ ...cell, column: left + 1 })));
  if (!columnScore && !rowScore) return null;
  return rowScore > columnScore + 0.45 ? "row" : "column";
}

function selectedTable(app) {
  if (app.sheet.selection.extra?.length) return null;
  const bounds = app.bounds();
  if ((bounds.top === 0 && bounds.bottom === app.engine.rows - 1) ||
      (bounds.left === 0 && bounds.right === app.engine.columns - 1)) return null;
  const axis = tableHeaderAxis(app, bounds);
  return axis ? { ...bounds, axis } : null;
}

function tableHeaderField(table, { row, column }) {
  if (table.axis === "column" && row === table.top && column >= table.left && column <= table.right) return column;
  if (table.axis === "row" && column === table.left && row >= table.top && row <= table.bottom) return row;
  return null;
}

function filterMatches(value, { condition, text }) {
  const label = value.text.trim().toLowerCase();
  const target = text.trim().toLowerCase();
  switch (condition) {
    case "equals": return label === target;
    case "not-equal": return label !== target;
    case "blank": return !label;
    case "nonblank": return Boolean(label);
    case "greater": return value.kind === ValueKind.number && value.number > Number(text);
    case "less": return value.kind === ValueKind.number && value.number < Number(text);
    default: return label.includes(target);
  }
}

async function tableFilterRanges(engine, sheet, filter) {
  const { table, field } = filter;
  const hidden = [];
  const hide = (first, last) => {
    if (first > last) return;
    const previous = hidden.at(-1);
    if (previous && previous[1] + 1 === first) previous[1] = last;
    else hidden.push([first, last]);
  };
  if (table.axis === "row") {
    for (let column = table.left + 1; column <= table.right; column++) {
      if (!filterMatches(engine.value(sheet.id, field, column), filter)) hide(column, column);
    }
    return hidden;
  }
  const matchesBlank = filterMatches({ text: "", kind: ValueKind.blank }, filter);
  let next = table.top + 1;
  let visited = 0;
  for (const row of occupiedColumn(engine, sheet, field, next, table.bottom)) {
    if (!matchesBlank) hide(next, row - 1);
    if (!filterMatches(engine.value(sheet.id, row, field), filter)) hide(row, row);
    next = row + 1;
    if (++visited % 16384 === 0) await yieldToBrowser();
  }
  if (!matchesBlank) hide(next, table.bottom);
  return hidden;
}

function skipHidden(index, direction, intervals = []) {
  let low = 0, high = intervals.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const [first, last] = intervals[middle];
    if (index < first) high = middle;
    else if (index > last) low = middle + 1;
    else return direction < 0 ? first - 1 : last + 1;
  }
  return index;
}

function showTableFilter(app, table, field) {
  const { sheet, engine } = app;
  const [row, column] = table.axis === "column" ? [table.top, field] : [field, table.left];
  const label = engine.value(sheet.id, row, column).text || cellName(row, column);
  const body = app.showDialog(`Filter ${label}`);
  const form = document.createElement("form");
  const match = formField(form, "Condition", "select");
  optionsFor(match, [["contains", "Contains"], ["equals", "Equals"], ["not-equal", "Does not equal"],
    ["greater", "Greater than"], ["less", "Less than"], ["blank", "Is blank"], ["nonblank", "Is not blank"]]);
  const value = formField(form, "Value");
  const previous = sheet.filter;
  if (previous?.field === field && previous.table.axis === table.axis) {
    match.value = previous.condition;
    value.value = previous.text;
  }
  const showValue = () => { value.parentElement.hidden = ["blank", "nonblank"].includes(match.value); };
  match.addEventListener("change", showValue);
  showValue();
  const message = document.createElement("div");
  message.className = "form-message";
  message.setAttribute("role", "alert");
  const buttons = document.createElement("div");
  buttons.className = "dialog-actions";
  buttons.innerHTML = '<button type="button" data-action="close-dialog">Cancel</button><button type="submit" class="primary">Apply</button>';
  form.append(message, buttons);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const condition = match.value;
    const text = value.value.trim();
    if ((condition === "greater" || condition === "less") && (!text || !Number.isFinite(Number(text)))) {
      message.textContent = "Enter a number for this condition.";
      return;
    }
    const filter = { table, field, condition, text, revision: app.contentRevision };
    void app.work("Filtering table", async () => {
      filter.hidden = await tableFilterRanges(engine, sheet, filter);
      sheet.filter = filter;
      app.view.requestDraw();
      const count = filter.hidden.reduce((total, [first, last]) => total + last - first + 1, 0);
      app.status(`Filter applied · ${count.toLocaleString("en-US")} ${table.axis === "column" ? "rows" : "columns"} hidden`);
    });
  });
  body.append(form);
  (value.parentElement.hidden ? match : value).focus();
}

function extendTable(app, table) {
  const { id } = app.sheet;
  const bounds = { ...table };
  // The preview searches a bounded neighborhood. Expand a long populated run
  // only when the user asks to select or use the suggested table.
  const candidates = new Set([app.active().column, table.left, table.right]);
  for (const column of candidates) {
    if (column < table.left || column > table.right) continue;
    if (table.moreAbove && app.raw({ row: table.top - 1, column })) {
      bounds.top = Math.min(bounds.top, app.engine.jumpRow(id, table.top, column, -1));
    }
    if (table.moreBelow && app.raw({ row: table.bottom + 1, column })) {
      bounds.bottom = Math.max(bounds.bottom, app.engine.jumpRow(id, table.bottom, column, 1));
    }
  }
  return bounds;
}
