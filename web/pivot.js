const pivotSummaries = ["Sum", "Count", "Average", "Min", "Max", "Count numbers"];

function validatePivot(config, engine) {
  const { sourceSheet, source, rowFields, columnField, filterField, filterValue, values } = config || {};
  const { top, bottom, left, right } = source || {};
  const field = (value) => Number.isInteger(value) && value >= left && value <= right;
  if (!validSheetName(sourceSheet) || ![top, bottom, left, right].every(Number.isInteger) ||
      top < 0 || bottom <= top || bottom >= engine.rows || left < 0 || right < left || right >= engine.columns ||
      !Array.isArray(rowFields) || rowFields.length < 1 || rowFields.length > 2 ||
      !rowFields.every(field) || new Set(rowFields).size !== rowFields.length ||
      (columnField !== -1 && (!field(columnField) || rowFields.includes(columnField))) ||
      (filterField !== -1 && !field(filterField)) || typeof filterValue !== "string" || filterValue.length > 256 ||
      !Array.isArray(values) || values.length < 1 || values.length > 3 ||
      !values.every((value) => value && field(value.column) && Number.isInteger(value.summary) &&
        value.summary >= 0 && value.summary < pivotSummaries.length)) {
    throw new Error("The pivot table configuration is invalid.");
  }
  return { sourceSheet, source: { top, bottom, left, right }, rowFields, columnField, filterField, filterValue, values };
}

function sourceRange(text, engine) {
  const ends = text.split(":").map((part) => parseAddress(part, engine.rows, engine.columns));
  if (ends.length !== 2 || ends.some((address) => !address)) {
    throw new Error("Enter a range with a header row, such as B8:K24.");
  }
  const bounds = selectionBounds({ anchor: ends[0], end: ends[1] });
  if (bounds.top === bounds.bottom) throw new Error("Include a header row and at least one data row.");
  return bounds;
}

function rangeAddress({ top, bottom, left, right }) {
  return `${cellName(top, left)}:${cellName(bottom, right)}`;
}

function sourceFields(engine, sheet, { top, left, right }) {
  const fields = [];
  for (let column = left; column <= right; column++) {
    const value = engine.value(sheet.id, top, column);
    const name = value.text.trim();
    if (!name || value.kind === ValueKind.error) throw new Error(`Enter a header in ${cellName(top, column)}.`);
    if (fields.some((field) => field.name.toUpperCase() === name.toUpperCase())) {
      throw new Error(`The header "${name}" appears more than once.`);
    }
    fields.push({ column, name });
  }
  return fields;
}

function reportSource(app) {
  const selection = app.contiguousSelection();
  if (cellCount(selection) > 1) return selection;
  if (app.tableSuggestion?.axis === "column") return extendTable(app, app.tableSuggestion);
  const active = app.active();
  if (!app.raw(active)) return selection;
  const { row, column } = active;
  const jump = (dr) => app.raw({ row: row + dr, column })
    ? app.engine.jumpRow(app.sheet.id, row, column, dr) : row;
  const horizontal = (dc) => app.raw({ row, column: column + dc }) ? app.jumpColumn(active, dc) : column;
  return { top: jump(-1), bottom: jump(1), left: horizontal(-1), right: horizontal(1) };
}

function formField(form, label, type = "input") {
  const wrapper = document.createElement("label");
  wrapper.textContent = label;
  const input = document.createElement(type);
  input.className = "dialog-input";
  wrapper.append(input);
  form.append(wrapper);
  return input;
}

function optionsFor(select, options) {
  select.replaceChildren(...options.map(([value, name]) => new Option(name, value)));
}

function reportForm(app, title, sourceSheets, config, onSource, onSubmit, fieldsFor = sourceFields, onPreview) {
  const body = app.showDialog(title);
  const form = document.createElement("form");
  form.className = "report-form";
  const sheetInput = formField(form, "Source worksheet", "select");
  optionsFor(sheetInput, sourceSheets.map(({ name }) => [name, name]));
  sheetInput.value = config.sourceSheet;
  const rangeInput = formField(form, "Source range (include headers)");
  rangeInput.value = rangeAddress(config.source);
  const message = document.createElement("div");
  message.className = "form-message";
  message.setAttribute("role", "alert");
  const settings = document.createElement("div");
  settings.className = "report-fields";
  form.append(settings, message);
  const buttons = document.createElement("div");
  buttons.className = "dialog-actions";
  buttons.innerHTML = '<button type="button" data-action="close-dialog">Cancel</button><button type="submit" class="primary">Apply</button>';
  form.append(buttons);
  body.append(form);

  let readSettings;
  const readSource = () => {
    const sheet = sourceSheets.find(({ name }) => name === sheetInput.value);
    const bounds = sourceRange(rangeInput.value, app.engine);
    return { sheet, bounds, fields: fieldsFor(app.engine, sheet, bounds) };
  };
  const currentSettings = () => {
    const { sheet, bounds } = readSource();
    return { sourceSheet: sheet.name, source: bounds, ...readSettings() };
  };
  const update = (initial) => {
    try {
      const source = readSource();
      readSettings = onSource(settings, source.fields, initial ? config : readSettings?.() || {}, source);
      message.textContent = "";
      buttons.lastElementChild.disabled = false;
    } catch (error) {
      settings.replaceChildren();
      message.textContent = error.message;
      buttons.lastElementChild.disabled = true;
    }
  };
  let previewFrame = 0;
  const schedulePreview = () => {
    if (!onPreview || previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      if (!app.dialog.open || !form.isConnected) return;
      try {
        onPreview(currentSettings());
        message.textContent = "";
        buttons.lastElementChild.disabled = false;
      } catch (error) {
        message.textContent = error.message;
        buttons.lastElementChild.disabled = true;
      }
    });
  };
  for (const input of [sheetInput, rangeInput]) {
    input.addEventListener("change", () => { update(false); schedulePreview(); });
  }
  if (onPreview) form.addEventListener("input", schedulePreview);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (app.busy) return;
    try {
      await onSubmit(currentSettings());
    } catch (error) { message.textContent = error.message; }
  });
  update(true);
  schedulePreview();
  rangeInput.focus();
  rangeInput.select();
  return body;
}

function pivotSettings(settings, fields, config) {
  settings.replaceChildren();
  const fieldOptions = fields.map(({ column, name }) => [column, name]);
  const pick = (label, selected, optional = true) => {
    const input = formField(settings, label, "select");
    optionsFor(input, optional ? [[-1, "None"], ...fieldOptions] : fieldOptions);
    if (fieldOptions.some(([column]) => column === selected)) input.value = selected;
    return input;
  };
  const row = pick("Rows", config.rowFields?.[0], false);
  const subrow = pick("Second row field", config.rowFields?.[1]);
  const column = pick("Columns", config.columnField);
  const filter = pick("Filter field", config.filterField);
  const filterValue = formField(settings, "Filter value (exact match)");
  filterValue.value = config.filterValue || "";
  filterValue.maxLength = 256;
  const updateFilter = () => { filterValue.disabled = Number(filter.value) < 0; };
  filter.addEventListener("change", updateFilter);
  updateFilter();
  const values = Array.from({ length: 3 }, (_, index) => {
    const value = pick(`Values ${index + 1}`, config.values?.[index]?.column ?? (index === 0 ? fields.at(-1).column : -1), index > 0);
    const summary = formField(settings, `Summarize values ${index + 1} by`, "select");
    optionsFor(summary, pivotSummaries.map((label, id) => [id, label]));
    summary.value = config.values?.[index]?.summary ?? 0;
    return { value, summary };
  });
  return () => ({
    rowFields: [row, subrow].map((input) => Number(input.value)).filter((id) => id >= 0),
    columnField: Number(column.value), filterField: Number(filter.value), filterValue: filterValue.value,
    values: values.map(({ value, summary }) => ({ column: Number(value.value), summary: Number(summary.value) }))
      .filter(({ column }) => column >= 0)
  });
}

function showPivotForm(app, target = null) {
  const sheets = app.sheets.filter((sheet) => !sheet.pivot && !sheet.chart);
  const source = app.sheet.pivot || app.sheet.chart ? sheets[0] : app.sheet;
  if (!source) throw new Error("Add a data worksheet first.");
  const config = target?.pivot || {
    sourceSheet: source.name,
    source: source === app.sheet ? reportSource(app) : { top: 0, bottom: 1, left: 0, right: 1 }
  };
  reportForm(app, target ? "Edit Pivot Table" : "Create Pivot Table", sheets, config, pivotSettings,
    (settings) => refreshPivot(app, target, settings));
}

function pivotCellInput(value) {
  if (value.kind === ValueKind.number) return String(value.number);
  if (value.kind === ValueKind.text) return "'" + value.text;
  if (value.kind === ValueKind.error && !xlsxErrors.has(value.text)) return "'" + value.text;
  return value.text;
}

async function pivotReport(engine, source, config, onGroups) {
  const fields = sourceFields(engine, source, config.source);
  const name = (column) => fields[column - config.source.left].name;
  try {
    if (!engine.startPivot(source.id, config)) throw new Error("The pivot table source is invalid.");
    let status;
    let lastYield = performance.now();
    while ((status = engine.pivotStep()) > 0) {
      if (performance.now() - lastYield > 24) {
        await yieldToBrowser();
        lastYield = performance.now();
      }
    }
    if (status === -2) throw new Error("The pivot result exceeds 400 columns or 100,000 cells. Choose fewer groups.");
    if (status < 0) throw new Error("The pivot calculation could not start.");

    const columnCount = engine.pivotCount(1);
    const rowCount = engine.pivotCount(0);
    if (onGroups) onGroups({
      rows: Array.from({ length: rowCount }, (_, row) => config.rowFields.map((_, field) => engine.pivotLabel(0, row, field))),
      columns: Array.from({ length: columnCount }, (_, column) => engine.pivotLabel(1, column, 0))
    });
    const groupColumns = config.columnField === -1 ? [-1]
      : [...Array.from({ length: columnCount }, (_, index) => index), -1];
    const columns = groupColumns.flatMap((column) => config.values.map((measure, field) => {
      const label = column === -1 ? "Total" : engine.pivotLabel(1, column, 0).text || "(blank)";
      const heading = `${pivotSummaries[measure.summary]} of ${name(measure.column)}`;
      return { column, field, heading: config.columnField === -1 ? heading : `${label} · ${heading}` };
    }));
    const headers = [...config.rowFields.map(name), ...columns.map(({ heading }) => heading)];
    const report = [headers.map((header) => "'" + header)];
    for (let row = 0; row < rowCount; row++) {
      const labels = config.rowFields.map((_, field) => {
        const label = engine.pivotLabel(0, row, field);
        return label.kind === ValueKind.blank ? "'(blank)" : pivotCellInput(label);
      });
      report.push([...labels, ...columns.map(({ column, field }) => pivotCellInput(engine.pivotValue(row, column, field)))]);
    }
    report.push(["'Grand total", ...config.rowFields.slice(1).map(() => ""),
      ...columns.map(({ column, field }) => pivotCellInput(engine.pivotValue(-1, column, field)))]);
    return report;
  } finally { engine.closePivot(); }
}

async function refreshPivot(app, target = app.sheet, config = target?.pivot) {
  if (!config) throw new Error("Open a pivot table worksheet first.");
  const checked = validatePivot(config, app.engine);
  const source = app.sheets.find(({ name }) => name === checked.sourceSheet);
  if (!source || source.pivot || source.chart) throw new Error("The pivot table source worksheet is unavailable.");
  await app.work(target ? "Refreshing pivot table" : "Building pivot table", async () => {
    const report = await pivotReport(app.engine, source, checked);
    for (const row of report) for (const text of row) app.engine.write(text);
    const sheet = target || app.addSheet(app.unusedSheetName("Pivot Table"));
    app.engine.clearSheet(sheet.id);
    sheet.styles.clear();
    for (const [row, values] of report.entries()) {
      for (const [column, text] of values.entries()) {
        if (text) app.engine.set(sheet.id, row, column, text);
        if (row === 0 || row === report.length - 1) {
          sheet.styles.set(cellKey(row, column, app.engine.columns), row === 0
            ? { bold: true, color: "#ffffff", fill: "#24614e" }
            : { bold: true, fill: "#e5f2eb", color: "#145639" });
        }
      }
    }
    report[0].forEach((text, column) => {
      if (!sheet.widths.has(column)) sheet.widths.set(column, clamp(text.length * 8 + 12, 105, 320));
    });
    sheet.pivot = checked;
    app.contentRevision++;
    app.dirty = true;
    app.refresh();
    app.status(`Pivot table updated from ${source.name}`);
  });
}
