function resizedObjectBox(drag, hit, view) {
  const { object: box, horizontal, vertical } = drag;
  const { scale, headerWidth, headerHeight } = view;
  const inCell = box.item.placement === "cell";
  const width = box.width / scale, height = box.height / scale;
  const dx = (hit.x - drag.x) * horizontal / scale;
  const dy = (hit.y - drag.y) * vertical / scale;
  const minWidth = inCell ? gridAxes.column.min : 12;
  const minHeight = inCell ? gridAxes.row.min : 12;
  const maxWidth = inCell ? gridAxes.column.max
    : horizontal < 0 ? Math.min(1600, width + (box.x - headerWidth) / scale) : 1600;
  const maxHeight = inCell ? gridAxes.row.max
    : vertical < 0 ? Math.min(1600, height + (box.y - headerHeight) / scale) : 1600;
  let nextWidth = width + dx, nextHeight = height + dy;
  if (!inCell && !box.item.chart && horizontal && vertical) {
    const minimum = Math.max(minWidth / width, minHeight / height);
    const maximum = Math.min(maxWidth / width, maxHeight / height);
    const ratio = clamp(1 + (width * dx + height * dy) / (width ** 2 + height ** 2), minimum, maximum);
    nextWidth = width * ratio;
    nextHeight = height * ratio;
  }
  nextWidth = Math.round(clamp(nextWidth, minWidth, maxWidth));
  nextHeight = Math.round(clamp(nextHeight, minHeight, maxHeight));
  return {
    x: !inCell && horizontal < 0 ? box.x + box.width - nextWidth * scale : box.x,
    y: !inCell && vertical < 0 ? box.y + box.height - nextHeight * scale : box.y,
    width: nextWidth, height: nextHeight
  };
}

class GridControls {
  constructor(app) {
    this.app = app;
    this.view = app.view;
    this.canvas = app.canvas;
    this.menu = document.getElementById("grid-menu");
    this.drag = null;
    this.canvas.addEventListener("pointerdown", (event) => this.pointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => {
      if (this.drag?.pointer !== event.pointerId) return;
      if (this.drag.type === "reference") this.updateDrag(this.view.hit(event.clientX, event.clientY));
      if (this.drag.type === "object-resize") this.previewObjectSize(this.view.hit(event.clientX, event.clientY));
      this.finish(true);
    });
    this.canvas.addEventListener("lostpointercapture", (event) => {
      if (this.drag?.pointer === event.pointerId) this.finish(false);
    });
    this.canvas.addEventListener("dblclick", (event) => this.doubleClick(event));
    this.canvas.addEventListener("contextmenu", (event) => this.contextMenu(event));
    this.menu.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const buttons = [...this.menu.querySelectorAll("button")];
      const step = event.key === "ArrowDown" ? 1 : -1;
      buttons[(buttons.indexOf(document.activeElement) + step + buttons.length) % buttons.length]?.focus();
    });
  }

  header({ x, y, row, column }) {
    if (y < this.view.headerHeight && column !== undefined) return "column";
    if (x < this.view.headerWidth && row !== undefined) return "row";
    return null;
  }

  headerAreas(axis) {
    const { rows, columns } = this.app.engine;
    return this.app.selectionAreas().filter((area) => axis === "column"
      ? area.top === 0 && area.bottom === rows - 1
      : area.left === 0 && area.right === columns - 1);
  }

  selectHeader(axis, anchor, end = anchor, extra = []) {
    const { rows, columns } = this.app.engine;
    if (axis === "column") {
      this.app.select({ row: 0, column: anchor }, { row: rows - 1, column: end }, false, extra);
    } else {
      this.app.select({ row: anchor, column: 0 }, { row: end, column: columns - 1 }, false, extra);
    }
  }

  toggleHeader(axis, index) {
    const { first, last } = gridAxes[axis];
    const areas = this.headerAreas(axis);
    if (!areas.some((area) => index >= area[first] && index <= area[last])) {
      this.selectHeader(axis, index, index, areas);
      return;
    }
    const remaining = [];
    for (const area of areas) {
      if (index < area[first] || index > area[last]) remaining.push(area);
      else {
        if (area[first] < index) remaining.push({ ...area, [last]: index - 1 });
        if (index < area[last]) remaining.push({ ...area, [first]: index + 1 });
      }
    }
    const active = remaining.shift();
    if (active) this.selectHeader(axis, active[first], active[last], remaining);
    else this.app.select({ row: 0, column: 0, [axis]: index }, undefined, false);
  }

  axisRanges(axis, index, onlyHeaders = false) {
    const { first, last } = gridAxes[axis];
    const areas = onlyHeaders ? this.headerAreas(axis) : this.app.selectionAreas();
    if (areas.some((area) => index >= area[first] && index <= area[last])) {
      return areas.map((area) => [area[first], area[last]]);
    }
    return [[index, index]];
  }

  onHandle({ x, y }) {
    const handle = this.view.fillHandle();
    return handle && Math.abs(x - handle.x) <= 5 && Math.abs(y - handle.y) <= 5;
  }

  onTableCorner({ x, y }) {
    const corner = this.view.tableCorner;
    return corner && x >= corner.x && x < corner.x + corner.width &&
      y >= corner.y && y < corner.y + corner.height;
  }

  objectAt({ x, y }) {
    if (x < this.view.headerWidth || y < this.view.headerHeight) return null;
    return this.view.objectRects?.findLast((rect) =>
      x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) || null;
  }

  objectHandleAt({ x, y }) {
    if (x < this.view.headerWidth || y < this.view.headerHeight) return null;
    return this.view.objectHandles().find((handle) => Math.abs(x - handle.x) <= 5 && Math.abs(y - handle.y) <= 5);
  }

  previewObjectSize(hit) {
    const drag = this.drag;
    if (!drag.target && Math.hypot(hit.x - drag.x, hit.y - drag.y) < 2) return;
    const target = resizedObjectBox(drag, hit, this.view);
    drag.target = target;
    this.view.objectGuide = { x: target.x, y: target.y,
      width: target.width * this.view.scale, height: target.height * this.view.scale };
    this.view.requestDraw();
  }

  commitObjectSize(drag) {
    const { item } = drag.object;
    const { x, y, width, height } = drag.target;
    if (item.placement === "cell") {
      this.app.resizeObjectCell(item, width, height);
      return;
    }
    const replacement = { ...item, width, height };
    const anchor = (position, items) => {
      const entry = items.find(({ end }) => position < end) ?? items.at(-1);
      return { index: entry.index, offset: clamp(Math.round((position - entry.start) / this.view.scale), 0, 1600) };
    };
    if (drag.horizontal < 0 && width !== item.width) {
      const column = anchor(x, this.view.visibleColumns);
      replacement.column = column.index;
      replacement.offsetX = column.offset;
    }
    if (drag.vertical < 0 && height !== item.height) {
      const row = anchor(y, this.view.visibleRows);
      replacement.row = row.index;
      replacement.offsetY = row.offset;
    }
    if (width !== item.width || height !== item.height) this.app.replaceObject(replacement);
  }

  pointerDown(event) {
    if (event.button !== 0 || this.drag || this.app.busy) return;
    const hit = this.view.hit(event.clientX, event.clientY);
    if (this.app.isFormulaEdit()) {
      event.preventDefault();
      if (hit.row === undefined || hit.column === undefined) return;
      const anchor = { row: hit.row, column: hit.column };
      const draft = this.app.referenceDraft();
      this.drag = { type: "reference", anchor, draft, end: anchor, pointer: event.pointerId };
      this.app.updateFormulaReference(draft, anchor);
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (!this.app.commitEdit()) return;
    this.canvas.focus({ preventScroll: true });
    const boundary = this.view.headerBoundary(hit);
    const axis = this.header(hit);
    const handle = this.objectHandleAt(hit);
    let drag;
    if (handle) {
      event.preventDefault();
      drag = { ...handle, type: "object-resize", x: hit.x, y: hit.y };
    } else if (this.onTableCorner(hit)) {
      event.preventDefault();
      this.openMenu(event.clientX, event.clientY, "table");
      return;
    } else if (boundary) {
      const { axis, index } = boundary;
      const spec = gridAxes[axis];
      drag = { type: "resize", ...boundary, ranges: this.axisRanges(axis, index, true),
        initialSize: this.app.sheet[spec.sizes].get(index) ?? spec.defaultSize,
        pointerStart: axis === "column" ? hit.x : hit.y };
    } else if (this.onHandle(hit)) {
      drag = { type: "fill", source: this.app.bounds() };
    } else if (axis) {
      const index = hit[axis];
      if (event.ctrlKey || event.metaKey) {
        this.toggleHeader(axis, index);
        return;
      }
      const anchor = event.shiftKey ? this.app.active()[axis] : index;
      this.selectHeader(axis, anchor, index);
      drag = { type: "header", axis, anchor, end: index };
    } else if (hit.x < this.view.headerWidth && hit.y < this.view.headerHeight) {
      this.selectHeader("column", 0, this.app.engine.columns - 1);
    } else if (hit.row !== undefined && hit.column !== undefined) {
      const object = this.objectAt(hit);
      if (object) {
        this.app.selectObject(object.item);
        if (object.item.placement === "cell") return;
        drag = { type: "object", object, x: hit.x, y: hit.y };
      } else {
        const cell = { row: hit.row, column: hit.column };
        const anchor = event.shiftKey ? this.app.active() : cell;
        this.app.select(anchor, cell, false);
        drag = { type: "select", anchor };
      }
    }
    if (!drag) return;
    this.drag = { ...drag, pointer: event.pointerId };
    this.canvas.setPointerCapture(event.pointerId);
  }

  pointerMove(event) {
    const hit = this.view.hit(event.clientX, event.clientY);
    const drag = this.drag;
    if (!drag) {
      if (this.app.isFormulaEdit()) {
        this.canvas.title = "";
        this.canvas.style.cursor = hit.row !== undefined && hit.column !== undefined ? "crosshair" : "default";
        return;
      }
      const axis = this.view.headerBoundary(hit)?.axis;
      const table = this.onTableCorner(hit);
      const handle = this.objectHandleAt(hit);
      this.canvas.title = table ? "Table commands" : "";
      this.canvas.style.cursor = handle?.cursor ?? (table ? "pointer" : axis ? (axis === "column" ? "col-resize" : "row-resize")
        : this.onHandle(hit) ? "crosshair" : this.header(hit) ? "pointer"
          : this.objectAt(hit)?.item.placement === "floating" ? "move" : "cell");
      return;
    }
    if (drag.pointer !== event.pointerId) return;
    if (drag.type === "object-resize") {
      this.previewObjectSize(hit);
      return;
    }
    if (drag.type === "object") {
      const dx = hit.x - drag.x, dy = hit.y - drag.y;
      if (!drag.target && Math.hypot(dx, dy) < 3) return;
      const x = clamp(drag.object.x + dx, this.view.headerWidth, this.view.width - 1);
      const y = clamp(drag.object.y + dy, this.view.headerHeight, this.view.height - 1);
      const column = this.view.visibleColumns.find((entry) => x >= entry.start && x < entry.end);
      const row = this.view.visibleRows.find((entry) => y >= entry.start && y < entry.end);
      if (!row || !column) return;
      drag.target = { row: row.index, column: column.index, offsetX: Math.round((x - column.start) / this.view.scale),
        offsetY: Math.round((y - row.start) / this.view.scale) };
      this.view.objectGuide = { ...drag.object, x, y };
      this.view.requestDraw();
      return;
    }
    if (drag.type === "resize") {
      const { axis, start, initialSize, pointerStart } = drag;
      const spec = gridAxes[axis];
      const delta = (axis === "column" ? hit.x : hit.y) - pointerStart;
      if (drag.size === undefined && Math.abs(delta) < 2) return;
      drag.size = clamp(Math.round(initialSize + delta / this.view.scale), spec.min, spec.max);
      this.view.resizeGuide = { axis, offset: start + Math.round(drag.size * this.view.scale) };
      this.app.status(`${axis === "column" ? "Width" : "Height"} · ${drag.size} px`);
      this.view.requestDraw();
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    drag.point = { x: event.clientX, y: event.clientY };
    this.updateDrag(hit);
    const outside = hit.x < this.view.headerWidth || hit.y < this.view.headerHeight ||
      hit.x >= rect.width || hit.y >= rect.height;
    if (outside && !this.scrollTimer) this.scrollTimer = setInterval(() => this.scrollDrag(), 80);
    if (!outside) this.stopScroll();
  }

  updateDrag(hit) {
    const drag = this.drag;
    const row = hit.row ?? (hit.y < this.view.headerHeight ? this.view.visibleRows[0]?.index : this.view.visibleRows.at(-1)?.index);
    const column = hit.column ?? (hit.x < this.view.headerWidth ? this.view.visibleColumns[0]?.index : this.view.visibleColumns.at(-1)?.index);
    if (row === undefined || column === undefined) return;
    if (drag.type === "reference") {
      if (row !== drag.end.row || column !== drag.end.column) {
        drag.end = { row, column };
        this.app.updateFormulaReference(drag.draft, drag.anchor, drag.end);
      }
    } else if (drag.type === "header") {
      const end = drag.axis === "column" ? column : row;
      if (end !== drag.end) {
        drag.end = end;
        this.selectHeader(drag.axis, drag.anchor, end);
      }
    } else if (drag.type === "select") {
      const end = this.app.sheet.selection.end;
      if (row !== end.row || column !== end.column) this.app.select(drag.anchor, { row, column }, false);
    } else {
      const { top, bottom, left, right } = drag.source;
      const rows = row < top ? row - top : Math.max(0, row - bottom);
      const columns = column < left ? column - left : Math.max(0, column - right);
      drag.target = null;
      if (rows && Math.abs(rows) * 24 >= Math.abs(columns) * 105) {
        drag.target = { top: Math.min(row, top), bottom: Math.max(row, bottom), left, right };
      } else if (columns) {
        drag.target = { top, bottom, left: Math.min(column, left), right: Math.max(column, right) };
      }
      this.view.fillPreview = drag.target;
      this.view.requestDraw();
    }
  }

  scrollDrag() {
    const drag = this.drag;
    if (!drag?.point) return;
    const { x, y } = this.view.hit(drag.point.x, drag.point.y);
    const rows = drag.type === "header" && drag.axis === "column" ? 0
      : y < this.view.headerHeight ? -1 : y >= this.view.height ? 1 : 0;
    const columns = drag.type === "header" && drag.axis === "row" ? 0
      : x < this.view.headerWidth ? -1 : x >= this.view.width ? 1 : 0;
    const { top, left } = this.app.sheet;
    this.view.scrollTo(top + rows, left + columns);
    requestAnimationFrame(() => {
      if (this.drag === drag) this.updateDrag(this.view.hit(drag.point.x, drag.point.y));
    });
  }

  stopScroll() {
    clearInterval(this.scrollTimer);
    this.scrollTimer = null;
  }

  finish(commit) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.stopScroll();
    if (this.canvas.hasPointerCapture(drag.pointer)) this.canvas.releasePointerCapture(drag.pointer);
    this.view.resizeGuide = null;
    this.view.fillPreview = null;
    this.view.objectGuide = null;
    this.view.requestDraw();
    if (drag.type === "reference" && !commit) this.app.updateFormulaReference(drag.draft);
    if (drag.type === "select" || drag.type === "header") this.app.refreshTableSuggestion();
    if (drag.type === "resize" && drag.size !== undefined) this.app.status();
    if (!commit) return;
    try {
      if (drag.type === "resize" && drag.size !== undefined && drag.size !== drag.initialSize) {
        this.app.resizeAxes(drag.axis, drag.ranges, () => drag.size);
      }
      if (drag.type === "object" && drag.target) this.app.replaceObject({ ...drag.object.item, ...drag.target });
      if (drag.type === "object-resize" && drag.target) this.commitObjectSize(drag);
      if (drag.type === "fill" && drag.target) {
        this.app.fillRange(drag.source, drag.target, true);
        this.app.select({ row: drag.target.top, column: drag.target.left },
          { row: drag.target.bottom, column: drag.target.right }, false);
      }
    } catch (error) { this.app.status(error.message); }
  }

  doubleClick(event) {
    if (this.app.busy || this.app.isFormulaEdit()) return;
    const hit = this.view.hit(event.clientX, event.clientY);
    if (this.objectHandleAt(hit)) return;
    const boundary = this.view.headerBoundary(hit);
    if (boundary) {
      const { axis, index } = boundary;
      void this.app.autoFit(axis, this.axisRanges(axis, index, true));
    } else if (this.objectAt(hit)?.item.chart) {
      this.app.openEmbeddedChart(this.objectAt(hit).item);
    } else if (!this.objectAt(hit) && !this.onHandle(hit) && hit.row !== undefined && hit.column !== undefined) {
      this.app.startEdit();
    }
  }

  contextMenu(event) {
    event.preventDefault();
    if (this.app.busy || this.drag || this.app.isFormulaEdit() || !this.app.commitEdit()) return;
    const hit = this.view.hit(event.clientX, event.clientY);
    const object = this.objectAt(hit);
    if (object?.item.chart) {
      this.app.selectObject(object.item);
      void this.app.runAction("chart-edit");
      return;
    }
    if (this.onTableCorner(hit)) {
      this.openMenu(event.clientX, event.clientY, "table");
      return;
    }
    if (object) {
      this.app.selectObject(object.item);
      this.openMenu(event.clientX, event.clientY, "object");
      return;
    }
    const boundary = this.view.headerBoundary(hit);
    const axis = boundary?.axis ?? this.header(hit);
    if (axis) {
      const index = boundary?.index ?? hit[axis];
      const { first, last } = gridAxes[axis];
      if (!this.headerAreas(axis).some((area) => index >= area[first] && index <= area[last])) {
        this.selectHeader(axis, index);
      }
      this.openMenu(event.clientX, event.clientY, axis, index);
    } else if (hit.row !== undefined && hit.column !== undefined) {
      const { top, bottom, left, right } = this.app.bounds();
      const { row, column } = hit;
      if (row < top || row > bottom || column < left || column > right) this.app.select({ row, column }, undefined, false);
      this.openMenu(event.clientX, event.clientY, null, undefined, hit);
    }
  }

  openKeyboardMenu() {
    const { row, column } = this.app.active();
    const rect = this.view.cellRect(row, column);
    const canvas = this.canvas.getBoundingClientRect();
    if (this.app.activeObject) {
      const object = this.view.objectRects?.find(({ item }) => item === this.app.activeObject);
      this.openMenu(canvas.left + (object?.x ?? rect?.x ?? this.view.headerWidth),
        canvas.top + (object?.y ?? rect?.y ?? this.view.headerHeight), "object");
      return;
    }
    const axis = this.headerAreas("column").length ? "column" : this.headerAreas("row").length ? "row" : null;
    this.openMenu(canvas.left + (rect?.x ?? this.view.headerWidth),
      canvas.top + (rect?.y ?? this.view.headerHeight), axis, axis === "column" ? column : row, { row, column });
  }

  openMenu(x, y, axis, index, cell) {
    const object = this.app.activeObject;
    const suggested = this.app.tableSuggestion;
    const table = axis === "table" ? suggested : !axis ? selectedTable(this.app) ?? suggested : null;
    const field = cell && table ? tableHeaderField(table, cell) : null;
    const createChart = table ? [["table-chart", "Create Linked Chart…", "chart"]] : [];
    const items = axis === "object" ? [
      ...(object.chart ? [["chart-open", "Open chart", "chart"], ["chart-edit", "Edit chart", "width"]] : []),
      ["object-placement", object.placement === "cell" ? "Float over cells" : "Place in cell", "grid"],
      ...(object.placement === "cell" ? [] : [["object-size", "Resize…", "width"]]),
      ["object-delete", "Remove", "eraser"]
    ] : axis === "table" ? [
      ["table-select", "Select Table", "styles"], ["table-format", "Format Table", "fill"], ...createChart
    ] : axis ? [
      ["axis-size", axis === "column" ? "Column width…" : "Row height…", "width"],
      ["axis-autofit", "Fit to contents", "expand"],
      ["axis-reset", "Reset to default size", "undo"],
      ["clear-cells", "Clear contents", "eraser"]
    ] : [
      ...(field === null ? [] : [
        ["table-sort-ascending", "Sort Ascending", "sort"],
        ["table-sort-descending", "Sort Descending", "sort"],
        ["table-filter", "Filter…", "find"],
        ...(this.app.sheet.filter ? [["table-clear-filter", "Clear Filter", "eraser"]] : [])
      ]),
      ["cut", "Cut", "cut"], ["copy", "Copy", "copy"], ["paste", "Paste", "paste"],
      ["clear-cells", "Clear contents", "eraser"], ["clear-format", "Clear formatting", "eraser"],
      ...createChart,
      ...(this.app.tableSuggestion ? [["table-select", "Select suggested table", "styles"],
        ["table-format", "Format suggested table", "fill"]] : [])
    ];
    this.menu.replaceChildren(...items.map(([action, label, symbol]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = action;
      if (axis) Object.assign(button.dataset, { axis, index });
      if (table) button.dataset.table = JSON.stringify(table);
      if (field !== null) button.dataset.field = field;
      button.innerHTML = icon(symbol);
      button.append(label);
      return button;
    }));
    if (!this.menu.matches(":popover-open")) this.menu.showPopover();
    this.menu.style.left = `${clamp(x, 4, innerWidth - this.menu.offsetWidth - 4)}px`;
    this.menu.style.top = `${clamp(y, 4, innerHeight - this.menu.offsetHeight - 4)}px`;
    this.menu.firstElementChild.focus();
  }
}
