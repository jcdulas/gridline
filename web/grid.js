const generalFormats = {
  number: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  currency: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 },
  "currency-eur": { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 },
  percent: { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 },
  integer: { maximumFractionDigits: 0 }
};
const numberFormatters = new Map();

function cellFont(style, scale = 1) {
  return `${style?.italic ? "italic " : ""}${style?.bold ? "650 " : ""}${(style?.size || 13) * scale}px "${style?.font || "Segoe UI"}", sans-serif`;
}

function cellDisplay(value, style) {
  if (value.kind !== ValueKind.number || !style?.format || style.format === "general") return value.text;
  if (Object.hasOwn(dateFormats, style.format)) return calendarDisplay(value.number, style) ?? value.text;
  const key = `${style.format}:${style.decimals ?? ""}`;
  if (!numberFormatters.has(key)) {
    const options = { ...generalFormats[style.format] };
    if (style.decimals !== undefined) {
      options.minimumFractionDigits = style.decimals;
      options.maximumFractionDigits = style.decimals;
    }
    numberFormatters.set(key, new Intl.NumberFormat("en-US", options));
  }
  return numberFormatters.get(key).format(value.number);
}

class WorksheetView {
  constructor(canvas, model) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.model = model;
    this.frame = 0;
    this.visibleRows = [];
    this.visibleColumns = [];
    this.width = 0;
    this.height = 0;
    this.vertical = document.getElementById("vertical-scroll");
    this.horizontal = document.getElementById("horizontal-scroll");
    this.bindScrollbar(this.vertical, true);
    this.bindScrollbar(this.horizontal, false);
    new ResizeObserver(() => this.requestDraw()).observe(canvas);
    window.addEventListener("resize", () => this.requestDraw());
  }

  get scale() { return this.model.zoom / 100; }
  get headerWidth() { return Math.round(65 * this.scale); }
  get headerHeight() { return Math.round(25 * this.scale); }
  rowHeight(row) { return Math.round((this.model.sheet.heights.get(row) || gridAxes.row.defaultSize) * this.scale); }
  columnWidth(column) { return Math.round((this.model.sheet.widths.get(column) || gridAxes.column.defaultSize) * this.scale); }

  skipFiltered(axis, index, direction) {
    const filter = this.model.sheet.filter;
    return filter && filter.table.axis !== axis ? skipHidden(index, direction, filter.hidden) : index;
  }

  visibleIndex(axis, index, direction) {
    const last = (axis === "row" ? this.model.engine.rows : this.model.engine.columns) - 1;
    index = clamp(index, 0, last);
    const visible = this.skipFiltered(axis, index, direction);
    return visible >= 0 && visible <= last ? visible : this.skipFiltered(axis, index, -direction);
  }

  visibleStart(axis, end, space, size) {
    let start = end;
    let remaining = space - size(end);
    for (let previous = this.skipFiltered(axis, start - 1, -1);
      previous >= 0 && remaining >= size(previous);
      previous = this.skipFiltered(axis, start - 1, -1)) {
      start = previous;
      remaining -= size(start);
    }
    return start;
  }

  get maxTop() {
    return this.visibleStart("row", this.visibleIndex("row", this.model.engine.rows - 1, -1),
      this.height - this.headerHeight, (row) => this.rowHeight(row));
  }

  get maxLeft() {
    return this.visibleStart("column", this.visibleIndex("column", this.model.engine.columns - 1, -1),
      this.width - this.headerWidth, (column) => this.columnWidth(column));
  }

  requestDraw() {
    if (this.frame || !this.model.sheet) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  scrollTo(row, column) {
    const sheet = this.model.sheet;
    sheet.top = Math.min(this.visibleIndex("row", Math.round(row), row < sheet.top ? -1 : 1), this.maxTop);
    sheet.left = Math.min(this.visibleIndex("column", Math.round(column), column < sheet.left ? -1 : 1), this.maxLeft);
    this.requestDraw();
  }

  reveal(row, column) {
    const sheet = this.model.sheet;
    row = this.visibleIndex("row", row, row < sheet.top ? -1 : 1);
    column = this.visibleIndex("column", column, column < sheet.left ? -1 : 1);
    let top = sheet.top;
    let left = sheet.left;
    if (row < top) top = row;
    else if (this.offsetToRow(row, top) + this.rowHeight(row) > this.height) {
      top = this.visibleStart("row", row, this.height - this.headerHeight, (index) => this.rowHeight(index));
    }
    if (column < left) left = column;
    else if (this.offsetToColumn(column, left) + this.columnWidth(column) > this.width) {
      left = this.visibleStart("column", column, this.width - this.headerWidth, (index) => this.columnWidth(index));
    }
    this.scrollTo(top, left);
  }

  offsetToRow(row, first) {
    let y = this.headerHeight;
    for (let index = this.skipFiltered("row", first, 1); index < row && y <= this.height;
      index = this.skipFiltered("row", index + 1, 1)) y += this.rowHeight(index);
    return y;
  }

  offsetToColumn(column, first) {
    let x = this.headerWidth;
    for (let index = this.skipFiltered("column", first, 1); index < column && x <= this.width;
      index = this.skipFiltered("column", index + 1, 1)) x += this.columnWidth(index);
    return x;
  }

  hit(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const row = this.visibleRows.find((item) => y >= item.start && y < item.end);
    const column = this.visibleColumns.find((item) => x >= item.start && x < item.end);
    return { x, y, row: row?.index, column: column?.index };
  }

  headerBoundary({ x, y }) {
    if (y < this.headerHeight && x >= this.headerWidth - 4) {
      const column = this.visibleColumns.find(({ end }) => Math.abs(x - end) <= 4 && end <= this.width);
      if (column) return { axis: "column", index: column.index, start: column.start };
    }
    if (x < this.headerWidth && y >= this.headerHeight - 4) {
      const row = this.visibleRows.find(({ end }) => Math.abs(y - end) <= 4 && end <= this.height);
      if (row) return { axis: "row", index: row.index, start: row.start };
    }
    return null;
  }

  fillHandle() {
    if (this.model.activeObject || this.model.sheet.selection.extra?.length) return null;
    const bounds = this.model.bounds();
    if (cellCount(bounds) > 100_000) return null;
    const rect = this.cellRect(bounds.bottom, bounds.right);
    if (!rect) return null;
    const x = rect.x + rect.width - 2;
    const y = rect.y + rect.height - 2;
    return x < this.width && y < this.height ? { x, y } : null;
  }

  cellRect(row, column) {
    const vertical = this.visibleRows.find((item) => item.index === row);
    const horizontal = this.visibleColumns.find((item) => item.index === column);
    if (!vertical || !horizontal) return null;
    return {
      x: horizontal.start, y: vertical.start,
      width: horizontal.end - horizontal.start, height: vertical.end - vertical.start
    };
  }

  layout() {
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    const bufferWidth = Math.round(this.width * ratio);
    const bufferHeight = Math.round(this.height * ratio);
    if (this.canvas.width !== bufferWidth) this.canvas.width = bufferWidth;
    if (this.canvas.height !== bufferHeight) this.canvas.height = bufferHeight;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const { sheet, engine } = this.model;
    sheet.top = Math.min(this.visibleIndex("row", sheet.top, 1), this.maxTop);
    sheet.left = Math.min(this.visibleIndex("column", sheet.left, 1), this.maxLeft);
    this.visibleRows = [];
    this.visibleColumns = [];
    let y = this.headerHeight;
    for (let index = sheet.top; index < engine.rows && y < this.height;
      index = this.skipFiltered("row", index + 1, 1)) {
      const end = y + this.rowHeight(index);
      this.visibleRows.push({ index, start: y, end });
      y = end;
    }
    let x = this.headerWidth;
    for (let index = sheet.left; index < engine.columns && x < this.width;
      index = this.skipFiltered("column", index + 1, 1)) {
      const end = x + this.columnWidth(index);
      this.visibleColumns.push({ index, start: x, end });
      x = end;
    }
  }

  draw() {
    if (this.model.sheet.chart || this.model.openedChart) return;
    this.layout();
    const ctx = this.ctx;
    const { sheet, engine, showFormulas } = this.model;
    const selections = this.model.selectionAreas();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, this.width, this.height);
    if (!this.visibleRows.length || !this.visibleColumns.length) return;

    const xEnd = this.visibleColumns.at(-1).end;
    const yEnd = this.visibleRows.at(-1).end;
    const data = this.visibleRows.map((row) => this.visibleColumns.map((column) => {
      const style = sheet.styles.get(cellKey(row.index, column.index, engine.columns));
      if (style?.fill) {
        ctx.fillStyle = style.fill;
        ctx.fillRect(column.start, row.start, column.end - column.start, row.end - row.start);
      }
      const value = showFormulas ? null : engine.value(sheet.id, row.index, column.index);
      const raw = showFormulas ? engine.raw(sheet.id, row.index, column.index) : "";
      return { style, value, text: value ? cellDisplay(value, style) : raw };
    }));

    if (this.model.gridlines) {
      ctx.strokeStyle = "#e2e8ee";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const row of this.visibleRows) {
        ctx.moveTo(this.headerWidth, row.end - 0.5);
        ctx.lineTo(xEnd, row.end - 0.5);
      }
      for (const column of this.visibleColumns) {
        ctx.moveTo(column.end - 0.5, this.headerHeight);
        ctx.lineTo(column.end - 0.5, yEnd);
      }
      ctx.stroke();
    }

    for (const bounds of selections) this.drawSelection(bounds);
    this.drawCells(data);
    drawWorksheetObjects(this);
    this.drawHeaders(selections, xEnd, yEnd);
    this.drawInteraction();
    this.updateScrollbar(this.vertical, true, sheet.top, this.maxTop, this.visibleRows.length, engine.rows);
    this.updateScrollbar(this.horizontal, false, sheet.left, this.maxLeft, this.visibleColumns.length, engine.columns);
    this.model.positionEditor();
  }

  drawCells(data) {
    const ctx = this.ctx;
    ctx.textBaseline = "middle";
    for (const [rowIndex, row] of this.visibleRows.entries()) {
      for (const [columnIndex, column] of this.visibleColumns.entries()) {
        const { style, value, text } = data[rowIndex][columnIndex];
        if (style?.border) {
          ctx.strokeStyle = style.border;
          ctx.lineWidth = 1;
          ctx.strokeRect(column.start + 0.5, row.start + 0.5,
            column.end - column.start - 1, row.end - row.start - 1);
        }
        if (!text) continue;
        const numeric = value?.kind === ValueKind.number;
        const align = style?.align || (numeric ? "right" : "left");
        const inset = Math.round(7 * this.scale);
        const y = (row.start + row.end) / 2;
        let textEnd = column.end;
        ctx.font = cellFont(style, this.scale);
        const singleLine = text.split(/\r?\n/, 1)[0];
        if (!numeric && align === "left" && !style?.fill &&
            ctx.measureText(singleLine).width > column.end - column.start - 2 * inset) {
          for (let next = columnIndex + 1; next < this.visibleColumns.length; next++) {
            if (data[rowIndex][next].text || data[rowIndex][next].style?.fill) break;
            textEnd = this.visibleColumns[next].end;
            if (textEnd - column.start >= ctx.measureText(singleLine).width + 2 * inset) break;
          }
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(column.start + 2, row.start + 1, textEnd - column.start - 4, row.end - row.start - 2);
        ctx.clip();
        ctx.fillStyle = style?.color || (value?.kind === ValueKind.error ? "#ac2840" : "#223346");
        ctx.textAlign = align;
        const x = align === "right" ? column.end - inset
          : align === "center" ? (column.start + column.end) / 2 : column.start + inset;
        const shown = numeric && ctx.measureText(singleLine).width > column.end - column.start - 2 * inset
          ? "##### " : singleLine;
        ctx.fillText(shown, x, y);
        if (style?.underline) {
          const length = ctx.measureText(shown).width;
          const start = align === "right" ? x - length : align === "center" ? x - length / 2 : x;
          ctx.fillRect(start, y + 6 * this.scale, length, 1);
        }
        ctx.restore();
      }
    }
  }

  drawSelection(bounds, stroke = "#137747", fill = "#1684521a") {
    const ctx = this.ctx;
    const rows = this.visibleRows.filter(({ index }) => index >= bounds.top && index <= bounds.bottom);
    const columns = this.visibleColumns.filter(({ index }) => index >= bounds.left && index <= bounds.right);
    if (!rows.length || !columns.length) return;
    const x = columns[0].start;
    const y = rows[0].start;
    const right = columns.at(-1).end;
    const bottom = rows.at(-1).end;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.headerWidth, this.headerHeight, this.width - this.headerWidth, this.height - this.headerHeight);
    ctx.clip();
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, right - x, bottom - y);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (rows[0].index === bounds.top) { ctx.moveTo(x, y + 1); ctx.lineTo(right, y + 1); }
    if (rows.at(-1).index === bounds.bottom) { ctx.moveTo(x, bottom - 1); ctx.lineTo(right, bottom - 1); }
    if (columns[0].index === bounds.left) { ctx.moveTo(x + 1, y); ctx.lineTo(x + 1, bottom); }
    if (columns.at(-1).index === bounds.right) { ctx.moveTo(right - 1, y); ctx.lineTo(right - 1, bottom); }
    ctx.stroke();
    ctx.restore();
  }

  objectHandles() {
    const object = this.objectRects?.find(({ item }) => item === this.model.activeObject);
    if (!object || this.model.edit) return [];
    const handles = [];
    for (const horizontal of [-1, 0, 1]) {
      for (const vertical of [-1, 0, 1]) {
        if (!horizontal && !vertical) continue;
        const x = object.x + object.width * (horizontal + 1) / 2;
        const y = object.y + object.height * (vertical + 1) / 2;
        if (x < this.headerWidth || y < this.headerHeight || x > this.width || y > this.height) continue;
        const cursor = !horizontal ? "ns-resize" : !vertical ? "ew-resize"
          : horizontal === vertical ? "nwse-resize" : "nesw-resize";
        handles.push({ object, x, y, horizontal, vertical, cursor });
      }
    }
    return handles;
  }

  drawInteraction() {
    const ctx = this.ctx;
    const reference = this.model.edit?.reference;
    if (reference) this.drawSelection(reference.bounds, "#2962bd", "#2962bd16");
    const filter = this.model.sheet.filter;
    if (filter) {
      const rect = filter.table.axis === "column" ? this.cellRect(filter.table.top, filter.field)
        : this.cellRect(filter.field, filter.table.left);
      if (rect) {
        const x = rect.x + rect.width - 11, y = rect.y + 4;
        ctx.fillStyle = "#14774c";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 8, y);
        ctx.lineTo(x + 5, y + 4);
        ctx.lineTo(x + 5, y + 8);
        ctx.lineTo(x + 3, y + 7);
        ctx.lineTo(x + 3, y + 4);
        ctx.fill();
      }
    }
    this.tableCorner = null;
    const table = this.model.tableSuggestion;
    if (table && !this.model.edit && !this.resizeGuide) {
      const rect = this.cellRect(table.top, table.left);
      if (rect) {
        const x = rect.x - 14, y = rect.y + 2;
        this.tableCorner = { x, y, width: 13, height: 13 };
        ctx.fillStyle = "#14774c";
        ctx.fillRect(x, y, 13, 13);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 3.5, y + 3.5, 6, 6);
        ctx.beginPath();
        ctx.moveTo(x + 4, y + 6);
        ctx.lineTo(x + 9, y + 6);
        ctx.stroke();
      }
    }
    if (this.objectGuide) {
      const { x, y, width, height } = this.objectGuide;
      ctx.strokeStyle = "#137747";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x, y, width, height);
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#14774c";
      ctx.lineWidth = 1;
      for (const { x, y } of this.objectHandles()) {
        ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
        ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
      }
    }
    const handle = this.fillHandle();
    if (handle && !this.model.edit && !this.resizeGuide) {
      ctx.fillStyle = "#137747";
      ctx.fillRect(handle.x - 3, handle.y - 3, 7, 7);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.strokeRect(handle.x - 3.5, handle.y - 3.5, 8, 8);
    }
    if (this.fillPreview) this.drawSelection(this.fillPreview);
    if (!this.resizeGuide) return;
    const { axis, offset } = this.resizeGuide;
    ctx.strokeStyle = "#137747";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    if (axis === "column") {
      ctx.moveTo(offset + 0.5, 0);
      ctx.lineTo(offset + 0.5, this.height);
    } else {
      ctx.moveTo(0, offset + 0.5);
      ctx.lineTo(this.width, offset + 0.5);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawHeaders(selections, xEnd, yEnd) {
    const ctx = this.ctx;
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, this.width, this.headerHeight);
    ctx.fillRect(0, this.headerHeight, this.headerWidth, this.height - this.headerHeight);
    ctx.font = `600 ${11 * this.scale}px "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const column of this.visibleColumns) {
      const active = selections.some(({ left, right }) => column.index >= left && column.index <= right);
      if (active) {
        ctx.fillStyle = "#dbece2";
        ctx.fillRect(column.start, 0, column.end - column.start, this.headerHeight);
        ctx.fillStyle = "#268356";
        ctx.fillRect(column.start, this.headerHeight - 2, column.end - column.start, 2);
      }
      ctx.fillStyle = active ? "#12623b" : "#52667a";
      ctx.fillText(columnName(column.index), (column.start + column.end) / 2, this.headerHeight / 2);
      ctx.fillStyle = "#dbe4ed";
      ctx.fillRect(column.end - 1, 0, 1, this.headerHeight);
    }
    for (const row of this.visibleRows) {
      const active = selections.some(({ top, bottom }) => row.index >= top && row.index <= bottom);
      if (active) {
        ctx.fillStyle = "#dbece2";
        ctx.fillRect(0, row.start, this.headerWidth, row.end - row.start);
        ctx.fillStyle = "#268356";
        ctx.fillRect(this.headerWidth - 2, row.start, 2, row.end - row.start);
      }
      ctx.fillStyle = active ? "#12623b" : "#52667a";
      ctx.fillText(String(row.index + 1), this.headerWidth / 2, (row.start + row.end) / 2);
      ctx.fillStyle = "#dbe4ed";
      ctx.fillRect(0, row.end - 1, this.headerWidth, 1);
    }
    ctx.fillStyle = "#cedae4";
    ctx.fillRect(0, this.headerHeight - 1, Math.max(xEnd, this.width), 1);
    ctx.fillRect(this.headerWidth - 1, 0, 1, Math.max(yEnd, this.height));
    ctx.fillStyle = "#9aafbd";
    ctx.beginPath();
    ctx.moveTo(this.headerWidth - 17 * this.scale, this.headerHeight - 5 * this.scale);
    ctx.lineTo(this.headerWidth - 5 * this.scale, this.headerHeight - 17 * this.scale);
    ctx.lineTo(this.headerWidth - 5 * this.scale, this.headerHeight - 5 * this.scale);
    ctx.fill();
  }

  updateScrollbar(track, vertical, offset, maximum, visible, total) {
    const size = vertical ? track.clientHeight : track.clientWidth;
    const length = Math.min(size, Math.max(18, Math.round(size * visible / total)));
    const thumb = track.firstElementChild;
    const start = maximum ? (size - length) * offset / maximum : 0;
    thumb.style[vertical ? "top" : "left"] = `${start}px`;
    thumb.style[vertical ? "height" : "width"] = `${length}px`;
    track.setAttribute("aria-valuemax", maximum + 1);
    track.setAttribute("aria-valuenow", offset + 1);
  }

  bindScrollbar(track, vertical) {
    const thumb = track.firstElementChild;
    let drag = null;
    const metric = (event) => vertical ? event.clientY : event.clientX;
    const extent = () => vertical ? track.clientHeight - thumb.offsetHeight : track.clientWidth - thumb.offsetWidth;
    const maximum = () => vertical ? this.maxTop : this.maxLeft;
    const offset = () => vertical ? this.model.sheet.top : this.model.sheet.left;
    const go = (value) => {
      if (!this.model.isFormulaEdit() && !this.model.commitEdit()) return;
      this.scrollTo(vertical ? value : this.model.sheet.top, vertical ? this.model.sheet.left : value);
    };
    track.addEventListener("pointerdown", (event) => {
      if (!this.model.sheet || event.button !== 0) return;
      track.setPointerCapture(event.pointerId);
      const start = vertical ? thumb.getBoundingClientRect().top : thumb.getBoundingClientRect().left;
      const length = vertical ? thumb.offsetHeight : thumb.offsetWidth;
      if (event.target === thumb) drag = { start: metric(event), offset: offset() };
      else go(offset() + Math.sign(metric(event) - start - length / 2) * this.pageSize(vertical));
      event.preventDefault();
    });
    track.addEventListener("pointermove", (event) => {
      if (drag && extent() > 0) go(drag.offset + (metric(event) - drag.start) * maximum() / extent());
    });
    track.addEventListener("lostpointercapture", () => { drag = null; });
    track.addEventListener("keydown", (event) => {
      if (!this.model.sheet) return;
      const jumps = {
        ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1,
        PageUp: -this.pageSize(vertical), PageDown: this.pageSize(vertical),
        Home: -maximum(), End: maximum()
      };
      if (!Object.hasOwn(jumps, event.key)) return;
      event.preventDefault();
      go(offset() + jumps[event.key]);
    });
  }

  pageSize(vertical) {
    return Math.max(1, (vertical ? this.visibleRows.length : this.visibleColumns.length) - 1);
  }
}
