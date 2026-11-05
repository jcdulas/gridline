class GridsNTabsApp {
  constructor(engine) {
    this.engine = engine;
    this.clipboardCache = new GridsNTabsClipboard();
    this.title = "Untitled workbook";
    this.sheets = [newSheetModel(engine.addSheet("Sheet 1"), "Sheet 1")];
    this.sheet = this.sheets[0];
    this.zoom = 100;
    this.gridlines = true;
    this.showFormulas = false;
    this.undoStack = [];
    this.redoStack = [];
    this.contentRevision = 0;
    this.edit = null;
    this.dirty = false;
    this.busy = false;
    this.ribbonTab = "Home";
    this.canvas = document.getElementById("grid");
    this.formula = document.getElementById("formula");
    this.formulaPreview = document.getElementById("formula-preview");
    this.nameBox = document.getElementById("name-box");
    this.editor = document.getElementById("cell-editor");
    this.editorPreview = document.getElementById("cell-editor-preview");
    this.dialog = document.getElementById("dialog");
    this.dialogContent = document.getElementById("dialog-content");
    this.view = new WorksheetView(this.canvas, this);
    this.chartView = new ChartView(this);
    this.colorPalette = new CellColorPalette(this);
    this.formula.disabled = false;
    this.bindEvents();
    this.setRibbon("Home");
    this.refresh();
  }

  status(message = "Ready") {
    const target = document.getElementById("status");
    target.textContent = message;
    target.toggleAttribute("data-visible", message !== "Ready");
    clearTimeout(this.statusTimer);
    if (message !== "Ready") {
      this.statusTimer = setTimeout(() => target.removeAttribute("data-visible"), 4000);
    }
  }

  refresh() {
    document.title = `${this.title} — Grids&Tabs`;
    document.getElementById("workbook-title").textContent = this.title + (this.dirty ? " •" : "");
    const saveSource = document.getElementById("save-source");
    saveSource.hidden = !gridsNTabsHost;
    saveSource.disabled = !this.hostedSource;
    const tabs = document.getElementById("sheet-tabs");
    const key = JSON.stringify(this.sheets.map(({ id, name }) => [id, name]));
    if (key !== this.sheetTabsKey) {
      tabs.replaceChildren(...this.sheets.map((sheet) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sheet-tab";
        button.dataset.action = "switch-sheet";
        button.dataset.sheet = String(sheet.id);
        button.setAttribute("role", "tab");
        button.textContent = sheet.name;
        return button;
      }));
      this.sheetTabsKey = key;
    }
    for (const button of tabs.children) {
      button.setAttribute("aria-selected", String(Number(button.dataset.sheet) === this.sheet.id));
    }
    tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.chartView.refresh();
    this.refreshTableFilter();
    this.refreshSelection();
  }

  active() { return this.sheet.selection.anchor; }
  bounds() { return selectionBounds(this.sheet.selection); }
  selectionAreas() { return [this.bounds(), ...(this.sheet.selection.extra || [])]; }
  raw({ row, column }) { return this.engine.raw(this.sheet.id, row, column); }
  style({ row, column }) { return this.sheet.styles.get(cellKey(row, column, this.engine.columns)); }

  refreshSelection() {
    const { row, column } = this.active();
    const address = cellName(row, column);
    const bounds = this.bounds();
    this.nameBox.value = cellCount(bounds) === 1 ? address :
      `${cellName(bounds.top, bounds.left)}:${cellName(bounds.bottom, bounds.right)}`;
    if (!this.edit) this.formula.value = this.editableText(this.active());
    this.refreshFormulaColors();
    const activeCell = document.getElementById("active-cell");
    activeCell.setAttribute("aria-rowindex", row + 1);
    activeCell.setAttribute("aria-colindex", column + 1);
    const value = this.engine.value(this.sheet.id, row, column);
    activeCell.textContent = `${address} ${cellDisplay(value, this.style(this.active())) || "empty"}`;
    if (!this.gridControls?.drag) this.refreshTableSuggestion();
    this.refreshToolbar();
    this.view.requestDraw();
  }

  select(anchor, end = anchor, reveal = true, extra = []) {
    this.activeObject = null;
    this.sheet.selection = { anchor, end, extra };
    if (reveal) this.view.reveal(end.row, end.column);
    this.refreshSelection();
  }

  refreshTableSuggestion() {
    const cell = this.active();
    const bounds = this.bounds();
    const isWholeHeader = (bounds.top === 0 && bounds.bottom === this.engine.rows - 1) ||
      (bounds.left === 0 && bounds.right === this.engine.columns - 1);
    const current = this.tableSuggestion;
    const within = current && cell.row >= current.top && cell.row <= current.bottom &&
      cell.column >= current.left && cell.column <= current.right;
    if (isWholeHeader || this.tableSheet !== this.sheet || this.tableRevision !== this.contentRevision || !within) {
      this.tableSuggestion = isWholeHeader ? null : detectedTable(this, cell);
      this.tableSheet = this.sheet;
      this.tableRevision = this.contentRevision;
    }
    this.view.requestDraw();
  }

  useSuggestedTable(format) {
    if (!this.tableSuggestion) this.refreshTableSuggestion();
    if (!this.tableSuggestion) throw new Error("Select a populated cell inside the table.");
    const bounds = extendTable(this, this.tableSuggestion);
    if (format) {
      this.checkBatch(bounds);
      const columnHeaders = bounds.axis === "column";
      this.change(Array.from(rectangle(bounds), (cell) => {
        const heading = columnHeaders ? cell.row === bounds.top : cell.column === bounds.left;
        const band = columnHeaders ? cell.row - bounds.top : cell.column - bounds.left;
        const oldStyle = this.style(cell);
        const newStyle = heading ? { ...oldStyle, bold: true, color: "#ffffff", fill: "#24614e" }
          : { ...oldStyle, fill: band % 2 ? "#f4f8fa" : "#ffffff" };
        return { ...cell, oldStyle, newStyle };
      }));
    }
    this.select({ row: bounds.top, column: bounds.left }, { row: bounds.bottom, column: bounds.right }, false);
    this.status(`${format ? "Formatted" : "Selected"} table ${rangeAddress(bounds)}`);
    this.canvas.focus();
  }

  refreshTableFilter() {
    const { engine, sheet, contentRevision } = this;
    const filter = sheet.filter;
    if (!filter || filter.revision === contentRevision) return;
    filter.revision = contentRevision;
    void tableFilterRanges(engine, sheet, filter).then((hidden) => {
      if (this.engine !== engine || sheet.filter !== filter || filter.revision !== contentRevision) return;
      filter.hidden = hidden;
      if (this.sheet === sheet) this.view.requestDraw();
    }).catch((error) => {
      if (this.sheet === sheet) this.status(error.message);
    });
  }

  clearTableFilter() {
    this.sheet.filter = null;
    this.view.requestDraw();
    this.status("Filter cleared");
  }

  setRibbon(tab) {
    this.ribbonTab = tab;
    for (const button of document.querySelectorAll("[data-ribbon]")) {
      button.setAttribute("aria-pressed", String(button.dataset.ribbon === tab));
    }
    const ribbon = document.getElementById("ribbon");
    ribbon.hidden = false;
    renderRibbon(tab, ribbon);
    const collapse = document.getElementById("collapse-ribbon");
    collapse.setAttribute("aria-expanded", "true");
    collapse.setAttribute("aria-label", "Collapse ribbon");
    collapse.title = "Collapse ribbon";
    collapse.innerHTML = icon("chevron-up");
    this.refreshToolbar();
  }

  refreshToolbar() {
    const style = this.style(this.active()) || {};
    const pressed = {
      bold: style.bold, italic: style.italic, underline: style.underline, border: style.border,
      "align-left": style.align === "left", "align-center": style.align === "center",
      "align-right": style.align === "right", "toggle-gridlines": this.gridlines,
      "toggle-formulas": this.showFormulas
    };
    for (const [action, value] of Object.entries(pressed)) {
      document.querySelector(`#ribbon [data-action="${action}"]`)?.setAttribute("aria-pressed", String(Boolean(value)));
    }
    const selected = { font: style.font || "Segoe UI", size: style.size || 13, format: style.format || "general" };
    for (const [property, value] of Object.entries(selected)) {
      const input = document.querySelector(`#ribbon [data-style="${property}"]`);
      if (input) input.value = value;
    }
    document.querySelector('#ribbon [data-action="fill"]')?.style.setProperty("--swatch", style.fill || "#e8be45");
    document.querySelector('#ribbon [data-action="color"]')?.style.setProperty("--swatch", style.color || "#223346");
    document.querySelector('[data-action="undo"]').disabled = !this.undoStack.length;
    document.querySelector('[data-action="redo"]').disabled = !this.redoStack.length;
    for (const action of ["pivot-edit", "pivot-refresh"]) {
      const button = document.querySelector(`#ribbon [data-action="${action}"]`);
      if (button) button.disabled = !this.sheet.pivot;
    }
    const editChart = document.querySelector('#ribbon [data-action="chart-edit"]');
    if (editChart) editChart.disabled = !this.sheet.chart && !this.activeObject?.chart && !this.openedChart;
  }

  setEditing(enabled) {
    document.querySelector('[data-action="cancel-edit"]').disabled = !enabled;
    document.querySelector('[data-action="accept-edit"]').disabled = !enabled;
  }

  editableText(cell) {
    const raw = this.raw(cell);
    const style = this.style(cell);
    if (!raw || raw.startsWith("=") || !dateFormats[style?.format] || style.format === "time") return raw;
    const value = this.engine.value(this.sheet.id, cell.row, cell.column);
    if (value.kind !== ValueKind.number) return raw;
    const format = style.format === "datetime" ? "datetime" : "date";
    return calendarDisplay(value.number, { format, date1904: this.engine.date1904 }) ?? raw;
  }

  inputPatch(cell, text, clipboardCell) {
    const oldStyle = this.style(cell);
    const style = clipboardCell ? clipboardCell.style : oldStyle;
    const parsed = clipboardCell?.exact ? { text, style } : calendarInput(text, style, this.engine);
    const dateFormula = !clipboardCell?.exact &&
      /^=\s*(?:_xlfn\.)?(DATE|DATEVALUE|TODAY|EDATE|EOMONTH|WORKDAY(?:\.INTL)?|TIME|TIMEVALUE)\s*\(/i.exec(text);
    if (dateFormula && (!style?.format || style.format === "general")) {
      parsed.style = { ...style, format: /^TIME/i.test(dateFormula[1]) ? "time" : "date",
        date1904: this.engine.date1904 || undefined };
    }
    const before = this.raw(cell);
    if (before === parsed.text && (oldStyle === parsed.style || JSON.stringify(oldStyle) === JSON.stringify(parsed.style))) return null;
    return { ...cell, before, after: parsed.text, oldStyle, newStyle: parsed.style };
  }

  startEdit(text = this.editableText(this.active()), mode = "inline") {
    if (this.sheet.pivot || this.sheet.chart) {
      this.status("Use the report controls to change this worksheet.");
      return;
    }
    this.edit = { mode, cell: this.active(), original: this.editableText(this.active()) };
    this.formula.value = text;
    this.setEditing(true);
    if (mode === "inline") {
      this.editor.hidden = false;
      this.editor.value = text;
      this.positionEditor();
      this.editor.focus();
      this.editor.setSelectionRange(text.length, text.length);
    }
    this.refreshFormulaColors();
  }

  refreshFormulaColors() {
    this.formulaReferences = formulaReferences(this.formula.value, this.sheet.name, this.engine);
    showFormulaPreview(this.formula, this.formulaPreview, this.formulaReferences);
    showFormulaPreview(this.editor, this.editorPreview, this.formulaReferences);
    this.view.requestDraw();
  }

  get editInput() { return this.edit?.mode === "inline" ? this.editor : this.formula; }

  isFormulaEdit() {
    return Boolean(this.edit && this.editInput.value.startsWith("="));
  }

  referenceDraft() {
    const input = this.editInput;
    const { value, selectionStart, selectionEnd } = input;
    const reference = this.edit.reference;
    const replacePrevious = reference && selectionStart === reference.end && selectionEnd === reference.end &&
      value.slice(reference.start, reference.end) === reference.text;
    return { edit: this.edit, value, selectionStart, selectionEnd, reference,
      start: replacePrevious ? reference.start : Math.max(1, selectionStart),
      end: Math.max(1, selectionEnd) };
  }

  updateFormulaReference(draft, anchor, end = anchor) {
    if (this.edit !== draft.edit) return;
    let text = draft.value;
    let { selectionStart, selectionEnd, reference } = draft;
    if (anchor) {
      const bounds = selectionBounds({ anchor, end });
      const address = anchor.row === end.row && anchor.column === end.column
        ? cellName(anchor.row, anchor.column) : rangeAddress(bounds);
      text = draft.value.slice(0, draft.start) + address + draft.value.slice(draft.end);
      selectionStart = selectionEnd = draft.start + address.length;
      reference = { bounds, text: address, start: draft.start, end: selectionEnd };
    }
    this.edit.reference = reference;
    const input = this.editInput;
    this.formula.value = text;
    input.value = text;
    input.focus({ preventScroll: true });
    input.setSelectionRange(selectionStart, selectionEnd);
    this.positionEditor();
    this.refreshFormulaColors();
  }

  positionEditor() {
    if (this.edit?.mode !== "inline") return;
    const { row, column } = this.edit.cell;
    const rect = this.view.cellRect(row, column);
    const formula = this.isFormulaEdit();
    if (!rect) {
      if (formula && document.activeElement === this.editor) {
        const { selectionStart, selectionEnd } = this.editor;
        this.formula.focus({ preventScroll: true });
        this.formula.setSelectionRange(selectionStart, selectionEnd);
      }
      return;
    }
    const preferred = formula ? rect.width : Math.max(rect.width, 110, Math.min(410, this.editor.value.length * 7 + 22));
    const width = Math.min(this.view.width - rect.x, preferred);
    const position = {
      left: `${rect.x}px`, top: `${rect.y}px`, width: `${width}px`, height: `${rect.height}px`
    };
    Object.assign(this.editor.style, position);
    Object.assign(this.editorPreview.style, position);
  }

  commitEdit(cancel = false) {
    if (!this.edit) return true;
    const { mode, cell, original } = this.edit;
    const text = mode === "inline" ? this.editor.value : this.formula.value;
    if (!cancel && text !== original) {
      try { this.engine.write(text); }
      catch (error) {
        this.status(error.message);
        (mode === "inline" ? this.editor : this.formula).focus();
        return false;
      }
    }
    if (this.gridControls?.drag?.type === "reference") this.gridControls.finish(true);
    this.edit = null;
    this.editor.hidden = true;
    this.setEditing(false);
    if (!cancel && text !== original) {
      const patch = this.inputPatch(cell, text);
      if (patch) this.change([patch]);
      else this.refreshSelection();
    } else this.refreshSelection();
    return true;
  }

  change(patches) {
    if (!patches.length) return;
    if (this.sheet.pivot || this.sheet.chart) throw new Error("Use the report controls to change this worksheet.");
    // Validate every input before applying any changes in a batch.
    for (const patch of patches) if (patch.after !== undefined) this.engine.write(patch.after);
    this.recordOperation({ sheet: this.sheet, patches });
  }

  recordOperation(operation) {
    this.apply(operation, true);
    this.undoStack.push(operation);
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack.length = 0;
    this.dirty = true;
    this.refresh();
  }

  apply(operation, forward) {
    if (operation.objects) {
      const { key, before, after } = operation.objects;
      operation.sheet[key] = forward ? after : before;
      this.activeObject = null;
      return;
    }
    if (operation.sizes) {
      for (const { sizes: axis, index, before, after } of operation.patches) {
        const sizes = operation.sheet[axis];
        const size = forward ? after : before;
        if (size === undefined) sizes.delete(index);
        else sizes.set(index, size);
      }
      return;
    }
    this.contentRevision++;
    for (const patch of operation.patches) {
      const text = forward ? patch.after : patch.before;
      if (text !== undefined) this.engine.set(operation.sheet.id, patch.row, patch.column, text);
      if (!Object.hasOwn(patch, "newStyle")) continue;
      const style = forward ? patch.newStyle : patch.oldStyle;
      const key = cellKey(patch.row, patch.column, this.engine.columns);
      if (style && Object.keys(style).length) operation.sheet.styles.set(key, style);
      else operation.sheet.styles.delete(key);
    }
  }

  history(redo) {
    const source = redo ? this.redoStack : this.undoStack;
    const destination = redo ? this.undoStack : this.redoStack;
    const operation = source.pop();
    if (!operation) return;
    this.apply(operation, redo);
    this.openedChart = null;
    destination.push(operation);
    this.sheet = operation.sheet;
    if (operation.patches && !operation.sizes) {
      const { row, column } = operation.patches[0];
      this.select({ row, column });
    }
    this.dirty = true;
    this.refresh();
    this.status(redo ? "Change reapplied" : "Change undone");
    this.canvas.focus();
  }

  checkBatch(bounds) {
    if (cellCount(bounds) > 100_000) throw new Error("This command supports up to 100,000 cells per selection.");
  }

  contiguousSelection() {
    if (this.sheet.selection.extra?.length) throw new Error("Select one continuous range for this command.");
    return this.bounds();
  }

  *axisIndices(ranges) {
    for (const [first, last] of ranges) {
      for (let index = first; index <= last; index++) yield index;
    }
  }

  checkAxisBatch(ranges) {
    const count = ranges.reduce((total, [first, last]) => total + last - first + 1, 0);
    if (count > 100_000) throw new Error("Resize up to 100,000 rows per command.");
  }

  axisSizePatches(axis, ranges, sizeFor) {
    this.checkAxisBatch(ranges);
    const { sizes, defaultSize } = gridAxes[axis];
    const patches = [];
    for (const index of this.axisIndices(ranges)) {
      const before = this.sheet[sizes].get(index);
      const size = sizeFor(index);
      const after = size === defaultSize ? undefined : size;
      if (before !== after) patches.push({ sizes, index, before, after });
    }
    return patches;
  }

  resizeAxes(axis, ranges, sizeFor) {
    const patches = this.axisSizePatches(axis, ranges, sizeFor);
    if (patches.length) this.recordOperation({ sheet: this.sheet, sizes: true, patches });
  }

  resizeObjectCell(item, width, height) {
    const patches = [
      ...this.axisSizePatches("column", [[item.column, item.column]], () => width),
      ...this.axisSizePatches("row", [[item.row, item.row]], () => height)
    ];
    if (patches.length) this.recordOperation({ sheet: this.sheet, sizes: true, patches });
  }

  async autoFit(axis, ranges) {
    await this.work(axis === "column" ? "Fitting columns" : "Fitting rows", async () => {
      this.checkAxisBatch(ranges);
      const { min, max, defaultSize } = gridAxes[axis];
      const { ctx } = this.view;
      const sizes = new Map();
      let lastYield = performance.now();
      let visited = 0;
      const measure = (row, column) => {
        const style = this.style({ row, column });
        const value = this.engine.value(this.sheet.id, row, column);
        const text = this.showFormulas ? this.raw({ row, column }) : cellDisplay(value, style);
        if (!text) return 0;
        if (axis === "row") return Math.max(min, Math.ceil((style?.size || 13) * 1.4 + 5));
        ctx.font = cellFont(style);
        return Math.min(max, Math.ceil(ctx.measureText(text.split(/\r?\n/, 1)[0]).width + 16));
      };
      for (const index of this.axisIndices(ranges)) {
        let size = 0;
        const scan = axis === "column" ? occupiedColumn(this.engine, this.sheet, index)
          : this.axisIndices([[0, this.engine.columns - 1]]);
        for (const offset of scan) {
          size = Math.max(size, axis === "column" ? measure(offset, index) : measure(index, offset));
          if (size >= max) break;
          if (++visited % 1024 === 0 && performance.now() - lastYield > 24) {
            await yieldToBrowser();
            lastYield = performance.now();
          }
        }
        sizes.set(index, size ? clamp(size, min, max) : defaultSize);
      }
      this.resizeAxes(axis, ranges, (index) => sizes.get(index));
      this.status(axis === "column" ? "Column widths fitted" : "Row heights fitted");
    });
  }

  axisCommand(action, axis, index, onlyHeaders) {
    const ranges = this.gridControls.axisRanges(axis, index, onlyHeaders);
    const { min, max, sizes, defaultSize } = gridAxes[axis];
    if (action === "axis-autofit") return this.autoFit(axis, ranges);
    if (action === "axis-reset") return this.resizeAxes(axis, ranges, () => defaultSize);
    const name = axis === "column" ? "Column width" : "Row height";
    this.ask(name, `Size in pixels (${min}–${max})`, String(this.sheet[sizes].get(index) ?? defaultSize), (text) => {
      const size = Number(text);
      if (!Number.isInteger(size) || size < min || size > max) throw new Error(`Enter a whole number from ${min} to ${max}.`);
      this.resizeAxes(axis, ranges, () => size);
    }, { type: "number" });
  }

  formatSelection(update, replace = false) {
    const bounds = this.contiguousSelection();
    this.checkBatch(bounds);
    this.change(Array.from(rectangle(bounds), (cell) => {
      const oldStyle = this.style(cell);
      const newStyle = replace ? {} : { ...oldStyle };
      for (const [property, value] of Object.entries(update)) {
        if (value === null || value === false) delete newStyle[property];
        else newStyle[property] = value;
      }
      return { ...cell, oldStyle, newStyle };
    }));
  }

  clearCells() {
    const patches = [];
    for (const { top, bottom, left, right } of this.selectionAreas()) {
      for (let column = left; column <= right; column++) {
        for (const row of occupiedColumn(this.engine, this.sheet, column, top, bottom)) {
          if (patches.length === 100_000) throw new Error("Clear up to 100,000 populated cells per command.");
          patches.push({ row, column, before: this.raw({ row, column }), after: "" });
        }
      }
    }
    this.change(patches);
  }

  setCell(text) {
    const patch = this.inputPatch(this.active(), text);
    if (patch) this.change([patch]);
  }

  move(rowDelta, columnDelta, extend) {
    const { anchor, end } = this.sheet.selection;
    const from = extend ? end : anchor;
    const cell = {
      row: rowDelta ? this.view.visibleIndex("row", from.row + rowDelta, Math.sign(rowDelta)) : from.row,
      column: columnDelta ? this.view.visibleIndex("column", from.column + columnDelta, Math.sign(columnDelta)) : from.column
    };
    this.select(extend ? anchor : cell, cell);
  }

  goTo(text) {
    const addresses = text.split(":").map((part) => parseAddress(part, this.engine.rows, this.engine.columns));
    if (addresses.length > 2 || addresses.some((address) => !address)) {
      throw new Error(`Enter a cell or range between A1 and ${cellName(this.engine.rows - 1, this.engine.columns - 1)}.`);
    }
    this.select(addresses[0], addresses.at(-1));
    this.canvas.focus();
  }

  setZoom(value) {
    this.zoom = clamp(value, 60, 160);
    this.status(`Zoom ${this.zoom}%`);
    this.view.requestDraw();
  }

  addSheet(name) {
    if (!validSheetName(name)) throw new Error("Use 1–31 characters and omit worksheet punctuation such as /, :, and brackets.");
    const id = this.engine.addSheet(name);
    if (!id) throw new Error("A sheet with this name already exists.");
    const sheet = newSheetModel(id, name);
    this.sheets.push(sheet);
    this.sheet = sheet;
    this.activeObject = null;
    this.openedChart = null;
    this.dirty = true;
    this.refresh();
    return sheet;
  }

  unusedSheetName(base) {
    const names = new Set(this.sheets.map((sheet) => sheet.name.toUpperCase()));
    if (!names.has(base.toUpperCase())) return base;
    for (let index = 2; ; index++) {
      const name = base.slice(0, 25) + " " + index;
      if (!names.has(name.toUpperCase())) return name;
    }
  }

  replaceWorkbook({ engine = this.engine, sheets, title }) {
    this.activeObject = null;
    this.openedChart = null;
    this.hostedSource = null;
    this.contentRevision++;
    this.engine = engine;
    this.sheets = sheets;
    this.sheet = sheets[0];
    this.title = title;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.refresh();
  }

  bindEvents() {
    const fileMenu = document.getElementById("file-menu");
    const fileTab = document.querySelector(".file-tab");
    fileMenu.addEventListener("toggle", () => {
      fileTab.setAttribute("aria-expanded", String(fileMenu.matches(":popover-open")));
    });
    document.getElementById("sheet-tabs").addEventListener("dblclick", (event) => {
      if (event.target.closest(".sheet-tab")) void this.runAction("rename-sheet");
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action],button[data-ribbon]");
      if (!button || button.disabled) return;
      if (button.hasAttribute("popovertarget")) event.preventDefault();
      if (fileMenu.contains(button)) fileMenu.hidePopover();
      if (button.dataset.ribbon) {
        if (!this.busy && this.commitEdit()) this.setRibbon(button.dataset.ribbon);
        return;
      }
      void this.runAction(button.dataset.action, button);
    });
    document.getElementById("ribbon").addEventListener("change", (event) => {
      const { style } = event.target.dataset;
      if (!style || !this.commitEdit()) return;
      try {
        const value = style === "size" ? Number(event.target.value) : event.target.value;
        this.formatSelection(style === "format" ? { format: value, decimals: null, xlsxFormat: null,
          date1904: dateFormats[value] && this.engine.date1904 ? true : null } : { [style]: value });
      } catch (error) { this.status(error.message); }
      this.canvas.focus();
    });
    this.dialog.addEventListener("cancel", (event) => {
      if (this.busy) event.preventDefault();
    });
    this.nameBox.addEventListener("focus", () => {
      if (this.commitEdit()) this.nameBox.select();
    });
    this.nameBox.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.refreshSelection();
        this.canvas.focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        try { this.goTo(this.nameBox.value); }
        catch (error) { this.status(error.message); this.nameBox.select(); }
      }
    });
    this.formula.addEventListener("focus", () => {
      if (!this.edit) this.startEdit(this.formula.value, "formula");
      else if (this.edit.mode === "inline") {
        this.edit.mode = "formula";
        this.editor.hidden = true;
        this.refreshFormulaColors();
      }
    });
    for (const input of [this.editor, this.formula]) {
      input.addEventListener("keydown", (event) => this.editKey(event));
      input.addEventListener("input", () => {
        if (this.edit?.reference) this.edit.reference = null;
        if (input === this.editor) {
          this.formula.value = this.editor.value;
          this.positionEditor();
        }
        this.refreshFormulaColors();
      });
      const preview = input === this.editor ? this.editorPreview : this.formulaPreview;
      input.addEventListener("scroll", () => syncFormulaPreview(input, preview));
    }
    this.bindGrid();
    this.bindFiles();
    document.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "a" && !event.shiftKey && !event.isComposing && !event.defaultPrevented) {
        // Keep VS Code's webview listener from forwarding Select All to the host.
        if (event.target.isContentEditable || event.target.closest?.("input, textarea, select")) {
          event.stopPropagation();
          return;
        }
        if (this.dialog.open || this.openedChart || this.sheet.chart) return;
        event.preventDefault();
        event.stopPropagation();
        window.getSelection()?.removeAllRanges();
        if (this.busy || !this.commitEdit()) return;
        this.gridControls.selectHeader("column", 0, this.engine.columns - 1);
        this.canvas.focus();
        return;
      }
      if (this.dialog.open) return;
      if (key === "s") {
        event.preventDefault();
        void this.runAction("save");
      } else if (key === "f" && event.target === this.canvas) {
        event.preventDefault();
        void this.runAction("find");
      }
    });
  }

  editKey(event) {
    if (event.isComposing) return;
    const plainArrow = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
    const vertical = plainArrow && (event.key === "ArrowUp" || event.key === "ArrowDown");
    const input = this.editInput;
    const atEdge = plainArrow && input.selectionStart === input.selectionEnd &&
      ((event.key === "ArrowLeft" && input.selectionStart === 0) ||
       (event.key === "ArrowRight" && input.selectionEnd === input.value.length));
    if (event.key === "Escape") {
      event.preventDefault();
      this.commitEdit(true);
      this.canvas.focus();
    } else if (vertical || atEdge || (event.key === "Enter" && !event.altKey) || event.key === "Tab") {
      event.preventDefault();
      if (!this.commitEdit()) return;
      const distance = event.shiftKey || event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
      if (atEdge || event.key === "Tab") this.move(0, distance, false);
      else this.move(distance, 0, false);
      this.canvas.focus();
    }
  }

  bindGrid() {
    this.gridControls = new GridControls(this);
    let wheelX = 0;
    let wheelY = 0;
    this.canvas.addEventListener("wheel", (event) => {
      if (event.ctrlKey || this.busy || this.gridControls.drag) return;
      event.preventDefault();
      if (!this.isFormulaEdit() && !this.commitEdit()) return;
      const lineSize = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? this.view.height : 1;
      wheelY += (event.shiftKey ? 0 : event.deltaY) * lineSize;
      wheelX += (event.deltaX || (event.shiftKey ? event.deltaY : 0)) * lineSize;
      const rows = Math.trunc(wheelY / 28);
      const columns = Math.trunc(wheelX / 85);
      wheelY -= rows * 28;
      wheelX -= columns * 85;
      this.view.scrollTo(this.sheet.top + rows, this.sheet.left + columns);
    }, { passive: false });
    this.canvas.addEventListener("keydown", (event) => this.gridKey(event));
    this.canvas.addEventListener("copy", (event) => this.clipboardEvent(event, false));
    this.canvas.addEventListener("cut", (event) => this.clipboardEvent(event, true));
    this.canvas.addEventListener("paste", (event) => {
      if (!event.clipboardData) return;
      event.preventDefault();
      try {
        this.paste({ text: event.clipboardData.getData("text/plain"), html: event.clipboardData.getData("text/html") });
      }
      catch (error) { this.status(error.message); }
    });
  }

  gridKey(event) {
    if (this.busy || event.isComposing || event.defaultPrevented || event.altKey) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key;
    const arrows = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    const anchor = this.active();
    const end = this.sheet.selection.end;
    const sign = event.shiftKey ? -1 : 1;
    try {
      if (modifier && key.toLowerCase() === "z") this.history(event.shiftKey);
      else if (modifier && key.toLowerCase() === "y") this.history(true);
      else if (modifier && ["d", "r"].includes(key.toLowerCase())) {
        this.fillSelection(key.toLowerCase() === "d" ? "row" : "column");
      } else if (event.code === "Space" && (modifier || event.shiftKey)) {
        const axis = modifier ? "column" : "row";
        this.gridControls.selectHeader(axis, anchor[axis], end[axis]);
      } else if (key === "ContextMenu" || (event.shiftKey && key === "F10")) {
        this.gridControls.openKeyboardMenu();
      } else if (key === "Escape" && this.gridControls.drag) {
        this.gridControls.finish(false);
      } else if (modifier && ["b", "i", "u"].includes(key.toLowerCase())) {
        void this.runAction({ b: "bold", i: "italic", u: "underline" }[key.toLowerCase()]);
      } else if (Object.hasOwn(arrows, key)) {
        if (modifier) {
          const [dr, dc] = arrows[key];
          const from = event.shiftKey ? end : anchor;
          const cell = dr
            ? { ...from, row: this.view.visibleIndex("row", this.engine.jumpRow(this.sheet.id, from.row, from.column, dr), dr) }
            : { ...from, column: this.view.visibleIndex("column", this.jumpColumn(from, dc), dc) };
          this.select(event.shiftKey ? anchor : cell, cell);
        } else this.move(...arrows[key], event.shiftKey);
      } else if (modifier && (key === "PageUp" || key === "PageDown")) {
        this.switchSheet(this.sheets.indexOf(this.sheet) + (key === "PageUp" ? -1 : 1));
      } else if (key === "PageUp" || key === "PageDown") {
        this.move(this.view.pageSize(true) * (key === "PageUp" ? -1 : 1), 0, event.shiftKey);
      } else if (key === "Home" || (modifier && key === "End")) {
        const cell = key === "End" ? this.usedEnd() : { row: modifier ? 0 : end.row, column: 0 };
        this.select(event.shiftKey ? anchor : cell, cell);
      } else if (key === "F2") this.startEdit();
      else if (key === "Delete" || key === "Backspace") {
        if (this.activeObject) this.replaceObject(null);
        else this.clearCells();
      }
      else if (key === "Enter" && this.activeObject?.chart) this.openEmbeddedChart(this.activeObject);
      else if (key === "Enter") this.move(sign, 0, false);
      else if (key === "Tab") this.move(0, sign, false);
      else if (!modifier && key.length === 1) this.startEdit(key);
      else return;
      event.preventDefault();
    } catch (error) {
      event.preventDefault();
      this.status(error.message);
    }
  }

  jumpColumn({ row, column }, direction) {
    const edge = direction > 0 ? this.engine.columns - 1 : 0;
    if (column === edge) return column;
    const populated = (index) => Boolean(this.raw({ row, column: index }));
    let next = column + direction;
    if (populated(column) && populated(next)) {
      while (next !== edge && populated(next + direction)) next += direction;
    } else {
      while (next !== edge && !populated(next)) next += direction;
    }
    return next;
  }

  usedEnd() {
    let row = 0;
    let column = 0;
    for (let index = 0; index < this.engine.columns; index++) {
      const last = this.engine.lastRow(this.sheet.id, index);
      if (last < 0) continue;
      row = Math.max(last, row);
      column = index;
    }
    return { row, column };
  }

  copySelection() {
    const bounds = this.contiguousSelection();
    this.checkBatch(bounds);
    const lines = [];
    const rows = [];
    for (let row = bounds.top; row <= bounds.bottom; row++) {
      const fields = [];
      const cells = [];
      for (let column = bounds.left; column <= bounds.right; column++) {
        const cell = { row, column };
        const text = this.raw(cell);
        fields.push(quoteDelimited(text, "\t"));
        cells.push(clipboardCellHtml(text, this.style(cell)));
      }
      lines.push(fields.join("\t"));
      rows.push("<tr>" + cells.join("") + "</tr>");
    }
    return { text: lines.join("\n"), html: '<table style="white-space:pre-wrap">' + rows.join("") + "</table>" };
  }

  clipboardEvent(event, cut) {
    if (!event.clipboardData) return;
    event.preventDefault();
    try {
      const data = this.copySelection();
      event.clipboardData.setData("text/plain", data.text);
      event.clipboardData.setData("text/html", data.html);
      if (cut) this.clearCells();
      this.clipboardCache.write(data);
      this.status(cut ? "Cells cut" : "Cells copied");
    } catch (error) { this.status(error.message); }
  }

  claimClipboardPrompt() {
    if (this.clipboardPromptRequested) return false;
    this.clipboardPromptRequested = true;
    try {
      const key = "gridsntabs:clipboard-prompt-requested";
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, "1");
    } catch {
      // Local files and restricted contexts may have no session storage.
    }
    return true;
  }

  async pasteFromMenu() {
    const { sheet } = this;
    const { selection } = sheet;
    const stillSelected = () => !this.busy && !this.dialog.open &&
      this.sheet === sheet && sheet.selection === selection && !this.edit;
    let data;
    let blocked = true;
    try {
      const permission = await navigator.permissions?.query({ name: "clipboard-read" });
      if (!stillSelected()) return;
      const clipboard = navigator.clipboard;
      if ((clipboard?.read || clipboard?.readText) && (permission?.state === "granted" ||
          (permission?.state === "prompt" && this.claimClipboardPrompt()))) {
        data = await readSystemClipboard(clipboard);
        blocked = false;
      }
    } catch {
      // Use the in-memory clipboard when browser access cannot be confirmed.
    }
    if (!stillSelected()) return;
    if (!data?.text && !data?.html) data = await this.clipboardCache.read();
    if (!stillSelected()) return;
    if (data?.text || data?.html) this.paste(data);
    else if (blocked) {
      this.canvas.focus({ preventScroll: true });
      this.status("Press Ctrl+V or ⌘+V to paste from the system clipboard.");
    } else this.status("The clipboard does not contain text.");
  }

  paste({ text, html }) {
    if (!text && !html) return;
    this.contiguousSelection();
    const rich = readClipboardTable(html, this.engine.columns);
    if (!rich && !text) return;
    const matrix = rich ?? parseClipboard(text, this.engine.columns, this.engine.inputLimit);
    const { row: top, column: left } = this.active();
    const width = matrix.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    if (top + matrix.length > this.engine.rows || left + width > this.engine.columns) {
      throw new Error("The paste would extend beyond the worksheet.");
    }
    const patches = [];
    let count = 0;
    for (const [offset, fields] of matrix.entries()) {
      const row = top + offset;
      for (const [index, field] of fields.entries()) {
        if (++count > 100_000) throw new Error("Paste up to 100,000 cells at a time, or use CSV import.");
        const column = left + index;
        const patch = this.inputPatch({ row, column }, rich ? field.text : field, rich ? field : undefined);
        if (patch) patches.push(patch);
      }
    }
    this.change(patches);
    if (matrix.length && width) this.select({ row: top, column: left },
      { row: top + matrix.length - 1, column: left + width - 1 }, false);
    this.status(`${count.toLocaleString("en-US")} cells pasted`);
  }

  showDialog(title) {
    document.getElementById("dialog-title").textContent = title;
    this.dialogContent.replaceChildren();
    if (!this.dialog.open) this.dialog.showModal();
    return this.dialogContent;
  }

  menu(title, items) {
    const body = this.showDialog(title);
    const list = this.actionList(items);
    body.append(list);
    list.querySelector("button")?.focus();
  }

  actionList(items) {
    const list = document.createElement("div");
    list.className = "dialog-list";
    for (const [action, label, detail, symbol] of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = action;
      const text = document.createElement("span");
      const name = document.createElement("strong");
      const description = document.createElement("small");
      name.textContent = label;
      description.textContent = detail;
      text.append(name, description);
      button.innerHTML = icon(symbol);
      button.append(text);
      list.append(button);
    }
    return list;
  }

  ask(title, label, value, submit, options = {}) {
    const body = this.showDialog(title);
    const form = document.createElement("form");
    const text = document.createElement("label");
    text.textContent = label;
    const input = document.createElement(options.multiline ? "textarea" : "input");
    input.className = "dialog-input";
    if (!options.multiline) input.type = options.type || "text";
    if (options.multiline) input.rows = 5;
    input.value = value;
    input.required = options.required !== false;
    text.append(input);
    const message = document.createElement("div");
    message.className = "form-message";
    message.setAttribute("role", "alert");
    const buttons = document.createElement("div");
    buttons.className = "dialog-actions";
    buttons.innerHTML = '<button type="button" data-action="close-dialog">Cancel</button><button type="submit" class="primary">Apply</button>';
    form.append(text, message, buttons);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (this.busy) return;
      try {
        await submit(input.value);
        if (this.dialog.open && this.dialogContent.contains(form)) this.dialog.close();
        this.canvas.focus();
      } catch (error) { message.textContent = error.message; }
    });
    body.append(form);
    input.focus();
    input.select?.();
  }

  confirmDiscard(next) {
    if (!this.dirty) { next(); return; }
    const body = this.showDialog("Unsaved changes");
    body.innerHTML = '<p>Save your current workbook before replacing it, or continue and discard the current changes.</p>';
    const buttons = document.createElement("div");
    buttons.className = "dialog-actions";
    buttons.innerHTML = '<button type="button" data-action="close-dialog">Cancel</button><button type="button">Continue</button>';
    buttons.lastElementChild.addEventListener("click", () => { this.dialog.close(); next(); });
    body.append(buttons);
  }

  async work(message, task) {
    this.busy = true;
    const body = this.showDialog(message);
    body.textContent = "Working…";
    const close = this.dialog.querySelector('[data-action="close-dialog"]');
    close.disabled = true;
    try {
      await yieldToBrowser();
      await task();
      this.dialog.close();
      this.canvas.focus();
    } catch (error) {
      body.textContent = error.message || String(error);
      this.status("The operation could not be completed.");
    } finally {
      close.disabled = false;
      this.busy = false;
    }
  }

  bindFiles() {
    const open = document.getElementById("open-file");
    const imported = document.getElementById("import-file");
    open.addEventListener("change", () => {
      const file = open.files[0];
      open.value = "";
      if (file) void this.openLocalFile(file);
    });
    imported.addEventListener("change", () => {
      const file = imported.files[0];
      imported.value = "";
      if (file) void this.importLocalFile(file);
    });
    const image = document.getElementById("image-file");
    image.addEventListener("change", () => {
      const file = image.files[0];
      image.value = "";
      if (file) void this.insertImage(file, this.active());
    });
    bindFileDrops(this);
  }

  openLocalFile(file) {
    return this.work("Opening workbook", () => this.loadLocalWorkbook(file));
  }

  async loadLocalWorkbook(file) {
    const workbook = /\.xlsx$/i.test(file.name)
      ? await openXlsx(file, (sheet, count) => {
        this.dialogContent.textContent = `Reading ${sheet} · ${count.toLocaleString("en-US")} cells…`;
      })
      : await openWorkbook(file);
    this.replaceWorkbook(workbook);
    this.status(`Opened ${file.name}${workbook.notice ? " · " + workbook.notice : ""}`);
  }

  saveSource() {
    const source = this.hostedSource;
    if (!source) return;
    return this.work("Saving " + source.name, async () => {
      let extendedRows = false;
      if (/\.xlsx$/i.test(source.name)) {
        extendedRows = await saveXlsx(this.engine, this.title, this.sheets,
          (chart) => this.chartView.snapshot(chart), true);
      } else if (/\.gridsntabs$/i.test(source.name)) {
        await saveWorkbook(this.engine, this.title, this.sheets, true);
      } else {
        if (this.sheets.length !== 1 || this.sheets[0] !== source.sheet) {
          throw new Error("The source text file stores one worksheet. Save as XLSX to keep this workbook.");
        }
        await exportOriginalText(this.engine, source.sheet, true);
      }
      this.dirty = false;
      this.refresh();
      this.status("Saved " + source.name + (extendedRows ? " · Some readers support up to 1,048,576 rows per sheet" : ""));
    });
  }

  importLocalFile(file) {
    return this.work("Importing data", async () => {
      const name = this.unusedSheetName(delimitedSheetName(file.name));
      const { sheet, rows } = await createDelimitedSheet(this.engine, file, name);
      this.sheets.push(sheet);
      this.sheet = sheet;
      this.activeObject = null;
      this.openedChart = null;
      this.dirty = true;
      this.refresh();
      this.status(`Imported ${rows.toLocaleString("en-US")} rows`);
    });
  }

  insertImage(file, cell) {
    if (this.sheet.chart || this.openedChart) {
      this.status("Switch to a worksheet to place an image.");
      return;
    }
    return this.work("Inserting image", async () => {
      const image = validateImage(await embedImage(file, cell), this.engine);
      this.addObject(image);
      this.status(`Image inserted at ${cellName(cell.row, cell.column)}`);
    });
  }

  addObject(object) {
    const key = object.chart ? "embeddedCharts" : "images";
    const before = this.sheet[key] || [];
    this.recordOperation({ sheet: this.sheet, objects: { key, before, after: [...before, object] } });
    this.selectObject(object);
  }

  selectObject(object) {
    this.activeObject = object;
    this.refreshToolbar();
    this.view.requestDraw();
  }

  replaceObject(replacement) {
    if (!this.activeObject) return;
    const key = this.activeObject.chart ? "embeddedCharts" : "images";
    const before = this.sheet[key] || [];
    if (!before.includes(this.activeObject)) return;
    const after = before.flatMap((object) => object === this.activeObject ? (replacement ? [replacement] : []) : [object]);
    this.recordOperation({ sheet: this.sheet, objects: { key, before, after } });
    this.selectObject(replacement);
  }

  openEmbeddedChart(object) {
    this.openedChart = object;
    this.selectObject(object);
    this.chartView.refresh();
    document.getElementById("chart-back").focus();
  }

  fileMenu(button) {
    const menu = document.getElementById("file-menu");
    if (menu.matches(":popover-open")) {
      menu.hidePopover();
      return;
    }
    const list = this.actionList([
      ["new", "New workbook", "Start with a blank worksheet.", "sheet"],
      ["open", "Open workbook", "Open an XLSX (.xlsx) or Grids&Tabs (.gridsntabs) workbook.", "folder"],
      ["save", "Save Grids&Tabs workbook", "Save all worksheets and formulas in the native format.", "save"],
      ["save-xlsx", "Save as XLSX (.xlsx)", "Save the workbook with its worksheet tabs.", "download"],
      ["import", "Import delimited data", "Load a CSV, TSV, or delimited text file into a new worksheet.", "upload"],
      ["export", "Export CSV", "Export calculated values from the current sheet or selected range.", "download"],
      ...(!this.sheet.chart ? [["save-delimited", "Save delimited data…",
        this.sheet.textImport ? "Keep the source file's separator or column alignment." : "Save the current worksheet as CSV.", "download"]] : []),
      ...(gridsNTabsHost ? [
        ["rename-workbook", "Rename workbook", "Change the name used when exporting the workbook.", "file"],
        ["help", "Help and shortcuts", "See the controls and keyboard shortcuts.", "help"]
      ] : [])
    ]);
    const bounds = button.getBoundingClientRect();
    menu.style.top = (bounds.bottom + 3) + "px";
    menu.style.left = bounds.left + "px";
    menu.style.maxHeight = Math.max(0, window.innerHeight - bounds.bottom - 9) + "px";
    menu.replaceChildren(list);
    menu.showPopover({ source: button });
    list.querySelector("button")?.focus();
  }

  help() {
    const body = this.showDialog("Using Grids&Tabs");
    body.innerHTML = `<p>Each worksheet has 8,000,000 addressable rows and 400 columns. Use the name box to jump to <code>OJ8000000</code> or select a range such as <code>B2:F20</code>.</p>
      <dl class="shortcut-list"><dt>Move or extend a selection</dt><dd><kbd>Arrow keys</kbd> / <kbd>Shift + Arrow</kbd></dd>
      <dt>Edit the active cell</dt><dd><kbd>F2</kbd> / Double-click</dd><dt>Save a Grids&amp;Tabs workbook</dt><dd><kbd>Ctrl / ⌘ + S</kbd></dd>
      <dt>Undo / redo</dt><dd><kbd>Ctrl / ⌘ + Z</kbd> / <kbd>Ctrl / ⌘ + Y</kbd></dd>
      <dt>Copy, cut, or paste</dt><dd><kbd>Ctrl / ⌘ + C</kbd> / <kbd>X</kbd> / <kbd>V</kbd></dd>
      <dt>Select a column or row</dt><dd><kbd>Ctrl + Space</kbd> / <kbd>Shift + Space</kbd></dd>
      <dt>Jump between data blocks</dt><dd><kbd>Ctrl + Arrow</kbd></dd>
      <dt>Fill down or right</dt><dd><kbd>Ctrl + D</kbd> / <kbd>Ctrl + R</kbd></dd></dl>
      <p>Drag a header separator to resize. Double-click it to fit the contents. Use Ctrl-click on headers to resize several at once.</p>
      <p>Drag the selection handle to extend dates, weekday names, or number patterns. Click the green table corner to select a detected table.</p>
      <p>Drop an XLSX workbook, CSV, TSV, text file, or image into the worksheet. Grids&amp;Tabs detects tables in text files. Right-click charts and pictures to choose their placement.</p>
      <p>Start formulas with <code>=</code>. Try <code>=SUM(A:A)</code>, <code>=IF(B2&gt;0,"Yes","No")</code>, or <code>='Sales overview'!$B$6</code>. Function arguments use commas.</p>
      <p>Grids&amp;Tabs can save and reopen XLSX sheets with up to 8,000,000 rows. Some XLSX readers may truncate or reject sheets above 1,048,576 rows. Use Insert Function to see the supported functions.</p>`;
  }

  functionPicker(filter = "") {
    const body = this.showDialog("Insert function");
    const paragraph = document.createElement("p");
    paragraph.textContent = "Choose a spreadsheet formula and replace its example references.";
    const list = document.createElement("div");
    list.className = "dialog-list function-list";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search implemented functions";
    search.setAttribute("aria-label", "Search implemented functions");
    search.className = "dialog-input";
    search.hidden = Boolean(filter);
    const render = () => {
      const query = filter || search.value.trim().toUpperCase();
      const entries = functionExamples.filter(([name]) => !query || (filter ? name === filter : name.includes(query)));
      list.replaceChildren();
      if (!entries.length) list.textContent = "No matching function is implemented.";
      for (const [, example, detail] of entries) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.action = "insert-function";
        button.dataset.example = example;
        const text = document.createElement("span");
        const strong = document.createElement("strong");
        strong.textContent = "=" + example;
        text.append(strong);
        if (detail) {
          const description = document.createElement("small");
          description.textContent = detail;
          text.append(description);
        }
        button.append(text);
        list.append(button);
      }
    };
    search.addEventListener("input", render);
    body.append(paragraph, search, list);
    render();
    if (!filter) search.focus();
  }

  autoAggregate(functionName) {
    if (this.sheet.pivot || this.sheet.chart) {
      this.status("Use the report controls to change this worksheet.");
      return;
    }
    const bounds = this.bounds();
    const active = this.active();
    let range = "";
    if (cellCount(bounds) > 1) {
      const next = bounds.bottom + 1;
      if (next >= this.engine.rows) throw new Error("Select a range with space for the result below it.");
      range = `${cellName(bounds.top, bounds.left)}:${cellName(bounds.bottom, bounds.right)}`;
      this.select({ row: next, column: bounds.left });
    } else if (active.row > 0 && this.raw({ row: active.row - 1, column: active.column })) {
      let row = active.row - 1;
      while (row > 0 && active.row - row < 100_000 && this.raw({ row: row - 1, column: active.column })) row--;
      range = `${cellName(row, active.column)}:${cellName(active.row - 1, active.column)}`;
    } else if (active.column > 0 && this.raw({ row: active.row, column: active.column - 1 })) {
      let column = active.column - 1;
      while (column > 0 && this.raw({ row: active.row, column: column - 1 })) column--;
      range = `${cellName(active.row, column)}:${cellName(active.row, active.column - 1)}`;
    }
    const prefix = `=${functionName}(`;
    this.startEdit(prefix + range + ")");
    this.editor.setSelectionRange(prefix.length, this.editor.value.length - 1);
  }

  fillSelection(axis) {
    const bounds = this.contiguousSelection();
    const { first, last } = gridAxes[axis];
    if (bounds[first] === bounds[last]) throw new Error(`Select the source ${axis} and a destination.`);
    this.fillRange({ ...bounds, [last]: bounds[first] }, bounds);
  }

  fillRange(source, target, smart = false) {
    this.checkBatch(target);
    const height = source.bottom - source.top + 1;
    const width = source.right - source.left + 1;
    const repeat = (position, start, length) => start + ((position - start) % length + length) % length;
    const vertical = target.top !== source.top || target.bottom !== source.bottom;
    const patterns = new Map();
    const patches = [];
    for (const cell of rectangle(target)) {
      const origin = {
        row: repeat(cell.row, source.top, height),
        column: repeat(cell.column, source.left, width)
      };
      if (origin.row === cell.row && origin.column === cell.column) continue;
      const key = vertical ? cell.column : cell.row;
      if (smart && !patterns.has(key)) {
        const samples = Array.from({ length: vertical ? height : width }, (_, index) => {
          const sample = vertical ? { row: source.top + index, column: key }
            : { row: key, column: source.left + index };
          return { raw: this.raw(sample), style: this.style(sample),
            value: this.engine.value(this.sheet.id, sample.row, sample.column) };
        });
        patterns.set(key, seriesPattern(samples, this.engine));
      }
      const pattern = patterns.get(key);
      const after = pattern ? pattern(vertical ? cell.row - source.top : cell.column - source.left)
        : shiftFormula(this.raw(origin), cell.row - origin.row, cell.column - origin.column, this.engine);
      patches.push({ ...cell, before: this.raw(cell), after, oldStyle: this.style(cell), newStyle: this.style(origin) });
    }
    this.change(patches);
  }

  sort(direction, table = null, field = null) {
    const horizontal = table?.axis === "row";
    const bounds = table ? { ...table, top: table.top + (horizontal ? 0 : 1), left: table.left + (horizontal ? 1 : 0) }
      : this.contiguousSelection();
    this.checkBatch(bounds);
    const [first, last, acrossFirst, acrossLast] = horizontal
      ? [bounds.left, bounds.right, bounds.top, bounds.bottom] : [bounds.top, bounds.bottom, bounds.left, bounds.right];
    if (first === last) throw new Error(`Select at least two data ${horizontal ? "columns" : "rows"} to sort.`);
    const coordinate = (position, across) => horizontal ? { row: across, column: position } : { row: position, column: across };
    const items = [];
    for (let index = first; index <= last; index++) {
      const { row, column } = coordinate(index, field ?? bounds.left);
      items.push({ index, key: this.engine.value(this.sheet.id, row, column) });
    }
    items.sort((a, b) => {
      if (a.key.kind === ValueKind.blank || b.key.kind === ValueKind.blank) return compareValues(a.key, b.key);
      return direction * compareValues(a.key, b.key);
    });
    const patches = [];
    for (const [offset, source] of items.entries()) {
      const index = first + offset;
      if (index === source.index) continue;
      for (let across = acrossFirst; across <= acrossLast; across++) {
        const cell = coordinate(index, across);
        const origin = coordinate(source.index, across);
        patches.push({ ...cell, before: this.raw(cell),
          after: shiftFormula(this.raw(origin), cell.row - origin.row, cell.column - origin.column, this.engine),
          oldStyle: this.style(cell), newStyle: this.style(origin) });
      }
    }
    this.change(patches);
    if (table) this.status(direction > 0 ? "Table sorted ascending" : "Table sorted descending");
  }

  async find(text) {
    const query = text.toLowerCase();
    const start = cellKey(this.active().row, this.active().column, this.engine.columns);
    const startRow = this.active().row;
    let next = Infinity;
    let first = Infinity;
    let visited = 0;
    for (let column = 0; column < this.engine.columns; column++) {
      const search = async (top, bottom) => {
        for (const row of occupiedColumn(this.engine, this.sheet, column, top, bottom)) {
          if (this.raw({ row, column }).toLowerCase().includes(query) ||
              this.engine.value(this.sheet.id, row, column).text.toLowerCase().includes(query)) {
            return cellKey(row, column, this.engine.columns);
          }
          if (++visited % 32768 === 0) await yieldToBrowser();
        }
        return Infinity;
      };
      next = Math.min(next, await search(startRow + (column <= start % this.engine.columns ? 1 : 0),
        Number.isFinite(next) ? Math.floor(next / this.engine.columns) : this.engine.rows - 1));
      if (!Number.isFinite(next)) first = Math.min(first, await search(0, startRow));
    }
    const key = Number.isFinite(next) ? next : first;
    if (!Number.isFinite(key)) throw new Error("No matching cell was found.");
    this.select({ row: Math.floor(key / this.engine.columns), column: key % this.engine.columns });
  }

  async runAction(action, button) {
    if (this.busy) return;
    try {
      if (button && this.gridControls.menu.contains(button)) {
        this.gridControls.menu.hidePopover();
        this.canvas.focus();
      }
      if (action === "close-dialog") { this.dialog.close(); return; }
      if (action === "cancel-edit" || action === "accept-edit") {
        if (this.commitEdit(action === "cancel-edit")) this.canvas.focus();
        return;
      }
      if (!this.commitEdit()) return;
      const active = this.active();
      const style = this.style(active) || {};
      const actions = {
        file: () => this.fileMenu(button),
        help: () => this.help(),
        new: () => this.confirmDiscard(() => {
          this.dialog.close();
          this.engine.reset();
          this.replaceWorkbook({ title: "Untitled workbook", sheets: [newSheetModel(this.engine.addSheet("Sheet 1"), "Sheet 1")] });
          this.status();
          this.canvas.focus();
        }),
        open: () => this.confirmDiscard(() => {
          this.dialog.close();
          document.getElementById("open-file").click();
        }),
        "save-source": () => this.saveSource(),
        save: () => this.work("Saving workbook", async () => {
          if (!await saveWorkbook(this.engine, this.title, this.sheets)) return;
          this.dirty = false;
          this.refresh();
          this.status("Grids&Tabs workbook saved");
        }),
        "save-xlsx": () => this.work("Saving XLSX workbook", async () => {
          const extendedRows = await saveXlsx(this.engine, this.title, this.sheets, (chart) => this.chartView.snapshot(chart));
          if (extendedRows === null) return;
          this.dirty = false;
          this.refresh();
          this.status(extendedRows ? "Extended XLSX saved · Some readers support up to 1,048,576 rows per sheet" : "XLSX workbook saved");
        }),
        import: () => { this.dialog.close(); document.getElementById("import-file").click(); },
        export: () => this.work("Exporting CSV", async () => {
          const bounds = this.contiguousSelection();
          if (await exportCsv(this.engine, this.sheet, cellCount(bounds) > 1 ? bounds : null)) this.status("CSV exported");
        }),
        "save-delimited": () => this.work("Saving delimited data", async () => {
          const saved = this.sheet.textImport ? await exportOriginalText(this.engine, this.sheet)
            : await exportCsv(this.engine, this.sheet, null);
          if (saved) this.status("Delimited data saved");
        }),
        "rename-workbook": () => this.ask("Rename workbook", "Workbook name", this.title, (name) => {
          const title = name.trim();
          if (!title || title.length > 120) throw new Error("Enter a name between 1 and 120 characters.");
          this.title = title;
          this.dirty = true;
          this.refresh();
        }),
        "add-sheet": () => this.ask("New worksheet", "Worksheet name", this.unusedSheetName("Sheet"), (name) => this.addSheet(name.trim())),
        "rename-sheet": () => this.ask("Rename worksheet", "Worksheet name", this.sheet.name, (text) => {
          const name = text.trim();
          if (name === this.sheet.name) return;
          if (!validSheetName(name)) throw new Error("Use 1–31 characters and omit worksheet punctuation such as /, :, and brackets.");
          const oldName = this.sheet.name;
          const result = this.engine.renameSheet(this.sheet.id, name);
          if (result === -1) throw new Error("Renaming would exceed the maximum formula length.");
          if (!result) throw new Error("A sheet with this name already exists.");
          this.sheet.name = name;
          for (const sheet of this.sheets) {
            for (const report of [sheet.pivot, sheet.chart, ...(sheet.embeddedCharts || []).map(({ chart }) => chart)]) {
              if (report?.sourceSheet === oldName) report.sourceSheet = name;
            }
          }
          this.contentRevision++;
          this.undoStack = [];
          this.redoStack = [];
          this.dirty = true;
          this.refresh();
        }),
        "switch-sheet": () => this.switchSheet(this.sheets.findIndex((sheet) => sheet.id === Number(button.dataset.sheet))),
        "previous-sheet": () => this.switchSheet(this.sheets.indexOf(this.sheet) - 1),
        "next-sheet": () => this.switchSheet(this.sheets.indexOf(this.sheet) + 1),
        undo: () => this.history(false),
        redo: () => this.history(true),
        cut: () => this.copyFromRibbon(true),
        copy: () => this.copyFromRibbon(false),
        paste: () => this.pasteFromMenu(),
        bold: () => this.formatSelection({ bold: !style.bold }),
        italic: () => this.formatSelection({ italic: !style.italic }),
        underline: () => this.formatSelection({ underline: !style.underline }),
        border: () => this.formatSelection({ border: style.border ? null : "#8ca2b2" }),
        fill: () => this.colorPalette.open("fill", button),
        color: () => this.colorPalette.open("color", button),
        "align-left": () => this.formatSelection({ align: "left" }),
        "align-center": () => this.formatSelection({ align: "center" }),
        "align-right": () => this.formatSelection({ align: "right" }),
        currency: () => this.formatSelection({ format: "currency", decimals: null, xlsxFormat: null }),
        percent: () => this.formatSelection({ format: "percent", decimals: null, xlsxFormat: null }),
        "decimal-more": () => this.adjustDecimals(1),
        "decimal-less": () => this.adjustDecimals(-1),
        "clear-format": () => this.formatSelection({}, true),
        styles: () => this.menu("Cell styles", [
          ["style-header", "Heading", "Dark green fill with bold white text.", "styles"],
          ["style-highlight", "Highlight", "Soft green fill with a bold accent.", "fill"],
          ["style-warning", "Attention", "Warm yellow fill.", "fill"]
        ]),
        "style-header": () => this.applyPreset({ bold: true, fill: "#24614e", color: "#ffffff" }),
        "style-highlight": () => this.applyPreset({ bold: true, fill: "#eaf5ee", color: "#11613d" }),
        "style-warning": () => this.applyPreset({ fill: "#fff1c7", color: "#573e0b" }),
        "column-width": () => this.axisCommand("axis-size", "column", active.column, false),
        "axis-size": () => this.axisCommand(action, button.dataset.axis, Number(button.dataset.index), true),
        "axis-autofit": () => this.axisCommand(action, button.dataset.axis, Number(button.dataset.index), true),
        "axis-reset": () => this.axisCommand(action, button.dataset.axis, Number(button.dataset.index), true),
        "clear-cells": () => this.clearCells(),
        "insert-image": () => document.getElementById("image-file").click(),
        "object-delete": () => this.replaceObject(null),
        "object-placement": () => {
          const object = this.activeObject;
          if (!object) return;
          this.replaceObject({ ...object, placement: object.placement === "cell" ? "floating" : "cell", offsetX: 0, offsetY: 0 });
        },
        "object-size": () => {
          const object = this.activeObject;
          if (!object) return;
          this.ask("Resize object", "Width in pixels (aspect ratio stays fixed)", String(object.width), (text) => {
            const width = Number(text);
            const height = Math.round(object.height * width / object.width);
            const replacement = { ...object, width, height };
            this.replaceObject(object.chart ? validateEmbeddedChart(replacement, this.engine) : validateImage(replacement, this.engine));
          }, { type: "number" });
        },
        functions: () => this.functionPicker(),
        "function-if": () => this.functionPicker("IF"),
        "insert-function": () => { this.dialog.close(); this.startEdit("=" + button.dataset.example); },
        "auto-sum": () => this.autoAggregate("SUM"),
        "auto-average": () => this.autoAggregate("AVERAGE"),
        "fill-down": () => this.fillSelection("row"),
        "fill-right": () => this.fillSelection("column"),
        "table-select": () => this.useSuggestedTable(false),
        "table-format": () => this.useSuggestedTable(true),
        "table-chart": () => showChartForm(this, null, extendTable(this, JSON.parse(button.dataset.table))),
        "table-sort-ascending": () => this.sort(1, extendTable(this, JSON.parse(button.dataset.table)), Number(button.dataset.field)),
        "table-sort-descending": () => this.sort(-1, extendTable(this, JSON.parse(button.dataset.table)), Number(button.dataset.field)),
        "table-filter": () => showTableFilter(this, extendTable(this, JSON.parse(button.dataset.table)), Number(button.dataset.field)),
        "table-clear-filter": () => this.clearTableFilter(),
        "pivot-create": () => showPivotForm(this),
        "pivot-edit": () => showPivotForm(this, this.sheet),
        "pivot-refresh": () => refreshPivot(this),
        "chart-create": () => showChartForm(this),
        "chart-edit": () => showChartForm(this, this.openedChart || (this.activeObject?.chart ? this.activeObject : this.sheet)),
        "chart-open": () => { if (this.activeObject?.chart) this.openEmbeddedChart(this.activeObject); },
        "chart-close": () => {
          this.openedChart = null;
          this.chartView.refresh();
          this.view.requestDraw();
          this.canvas.focus();
        },
        "insert-date": () => {
          const initial = this.editableText(active).match(/^\d{4}-\d{2}-\d{2}/)?.[0] ||
            new Date(localToday()).toISOString().slice(0, 10);
          this.ask("Calendar", "Choose a date", initial, (text) => {
            if (!readCalendarDate(text) || serialDate(readCalendarDate(text).time, this.engine.date1904) < 0) {
              throw new Error("Choose a date within the workbook calendar.");
            }
            this.setCell(text);
          }, { type: "date" });
          const input = this.dialogContent.querySelector('input[type="date"]');
          input.min = this.engine.date1904 ? "1904-01-01" : "1900-01-01";
          input.max = "9999-12-31";
        },
        "sort-ascending": () => this.sort(1),
        "sort-descending": () => this.sort(-1),
        find: () => this.ask("Find in worksheet", "Search formulas or calculated values", "", (text) => this.find(text)),
        "go-to": () => this.ask("Go to cell or range", "Cell address", this.nameBox.value, (text) => this.goTo(text)),
        "toggle-formulas": () => { this.showFormulas = !this.showFormulas; this.refreshSelection(); },
        "toggle-gridlines": () => { this.gridlines = !this.gridlines; this.refreshSelection(); },
        calculate: () => { this.engine.recalculate(); this.contentRevision++; this.refresh(); this.status("Recalculated"); },
        "zoom-out": () => this.setZoom(this.zoom - 10),
        "zoom-in": () => this.setZoom(this.zoom + 10),
        "zoom-reset": () => this.setZoom(100),
        "toggle-ribbon": () => {
          const ribbon = document.getElementById("ribbon");
          if (ribbon.hidden) this.setRibbon(this.ribbonTab);
          else {
            ribbon.hidden = true;
            button.innerHTML = icon("chevron-down");
            button.title = "Expand ribbon";
            button.setAttribute("aria-expanded", "false");
            button.setAttribute("aria-label", "Expand ribbon");
          }
        }
      };
      await actions[action]?.();
    } catch (error) { this.status(error.message || String(error)); }
  }

  switchSheet(index) {
    const sheet = this.sheets[index];
    if (!sheet) return;
    this.sheet = sheet;
    this.activeObject = null;
    this.openedChart = null;
    this.refresh();
    this.canvas.focus();
  }

  adjustDecimals(delta) {
    const style = this.style(this.active()) || {};
    const format = Object.hasOwn(generalFormats, style.format) ? style.format : "number";
    const decimals = clamp((style.decimals ?? generalFormats[format].maximumFractionDigits) + delta, 0, 10);
    this.formatSelection({ format, decimals, xlsxFormat: null });
  }

  applyPreset(style) {
    this.formatSelection(style);
    this.dialog.close();
    this.canvas.focus();
  }

  async copyFromRibbon(cut) {
    const data = this.copySelection();
    if (!cut) this.clipboardCache.write(data);
    const { sheet } = this;
    const { selection } = sheet;
    try {
      await writeSystemClipboard(navigator.clipboard, data);
    } catch {
      this.canvas.focus();
      this.status(cut ? "Press Ctrl+X or ⌘+X to cut." : "Cells copied in Grids&Tabs");
      return;
    }
    if (cut) {
      if (this.sheet !== sheet || sheet.selection !== selection || this.busy || this.edit) return;
      this.clearCells();
      this.clipboardCache.write(data);
    }
    this.status(cut ? "Cells cut" : "Cells copied");
  }
}

initializeIcons(document);
WorkbookEngine.load().then((engine) => {
  const app = new GridsNTabsApp(engine);
  document.getElementById("engine-state").textContent = "Offline · WASM";
  app.status();
  void openHostedFile(app);
}).catch((error) => {
  document.querySelector(".engine-badge").classList.add("failure");
  document.getElementById("engine-state").textContent = "Engine unavailable";
  const status = document.getElementById("status");
  status.textContent = "The calculation engine could not start. " + error.message;
  status.setAttribute("data-visible", "");
  console.error(error);
});
