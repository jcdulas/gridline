const ValueKind = Object.freeze({ blank: 0, number: 1, boolean: 2, text: 3, error: 4 });

class WorkbookEngine {
  static async load() {
    const base64 = document.getElementById("engine-wasm").textContent.trim();
    const bytes = Uint8Array.from(atob(base64), (byte) => byte.charCodeAt(0));
    const { instance } = await WebAssembly.instantiate(bytes, WorkbookEngine.imports);
    return new WorkbookEngine(instance.exports);
  }

  static imports = {
    env: { emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: {
      proc_exit(code) { throw new Error(`The workbook engine stopped (code ${code}).`); }
    }
  };

  constructor(wasm) {
    this.wasm = wasm;
    wasm._initialize();
    this.rows = wasm.workbook_rows();
    this.columns = wasm.workbook_columns();
    this.inputLimit = wasm.workbook_input_limit();
    this.inputPointer = wasm.workbook_input();
    this.inputBytes = new Uint8Array(wasm.memory.buffer, this.inputPointer, this.inputLimit);
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
    this.setDateSystem(false);
  }

  write(text) {
    const memory = this.wasm.memory.buffer;
    if (this.inputBytes.buffer !== memory) {
      this.inputBytes = new Uint8Array(memory, this.inputPointer, this.inputLimit);
    }
    // Short ASCII values can be copied directly into the engine's input buffer.
    if (text.length <= 64) {
      let index = 0;
      for (; index < text.length; index++) {
        const character = text.charCodeAt(index);
        if (character > 127) break;
        this.inputBytes[index] = character;
      }
      if (index === text.length) return index;
    }
    const { read, written } = this.encoder.encodeInto(text, this.inputBytes);
    if (read !== text.length) throw new Error("A cell can contain at most 65,536 UTF-8 bytes.");
    return written;
  }

  output(length = this.wasm.workbook_output_size()) {
    const pointer = this.wasm.workbook_output();
    return this.decoder.decode(new Uint8Array(this.wasm.memory.buffer, pointer, length));
  }

  addSheet(name) { return this.wasm.workbook_add_sheet(this.write(name)); }
  removeSheet(id) { this.wasm.workbook_remove_sheet(id); }
  renameSheet(id, name) { return this.wasm.workbook_rename_sheet(id, this.write(name)); }
  clearSheet(id) { this.wasm.workbook_clear_sheet(id); }
  reset() {
    this.wasm.workbook_reset();
    this.setDateSystem(false);
  }

  setDateSystem(date1904) {
    this.date1904 = Boolean(date1904);
    this.wasm.workbook_set_calendar(Number(this.date1904), serialDate(localToday(), this.date1904));
  }

  set(id, row, column, text) {
    if (!this.wasm.workbook_set(id, row, column, this.write(text))) {
      throw new Error("This cell is outside the worksheet.");
    }
  }

  raw(id, row, column) { return this.output(this.wasm.workbook_raw(id, row, column)); }

  value(id, row, column) {
    return this.readValue(this.wasm.workbook_value(id, row, column));
  }

  readValue(kind) {
    if (kind === ValueKind.blank) return { kind, text: "", number: 0 };
    return { kind, text: this.output(), number: this.wasm.workbook_number() };
  }

  nextRow(id, column, previousRow) { return this.wasm.workbook_next_row(id, column, previousRow); }
  lastRow(id, column) { return this.wasm.workbook_last_row(id, column); }
  jumpRow(id, row, column, direction) { return this.wasm.workbook_jump_row(id, row, column, direction); }
  recalculate() {
    this.setDateSystem(this.date1904);
    this.wasm.workbook_recalculate();
  }

  startPivot(id, config) {
    const { top, bottom, left, right } = config.source;
    const { columnField, filterField, filterValue } = config;
    if (!this.wasm.workbook_pivot_start(id, top, bottom, left, right,
      columnField, filterField, this.write(filterValue))) return false;
    return config.rowFields.every((column) => this.wasm.workbook_pivot_row_field(column)) &&
      config.values.every(({ column, summary }) => this.wasm.workbook_pivot_measure(column, summary));
  }

  pivotStep() { return this.wasm.workbook_pivot_step(4096); }
  pivotCount(axis) { return this.wasm.workbook_pivot_count(axis); }
  pivotLabel(axis, index, field) { return this.readValue(this.wasm.workbook_pivot_label(axis, index, field)); }
  pivotValue(row, column, field) { return this.readValue(this.wasm.workbook_pivot_value(row, column, field)); }
  closePivot() { this.wasm.workbook_pivot_close(); }
}

function columnName(column) {
  let name = "";
  for (let number = column + 1; number > 0; number = Math.floor((number - 1) / 26)) {
    name = String.fromCharCode(65 + (number - 1) % 26) + name;
  }
  return name;
}

function cellName(row, column) { return columnName(column) + (row + 1); }

function parseAddress(text, rows, columns) {
  const match = /^\$?([a-z]{1,3})\$?(\d{1,7})$/i.exec(text.trim());
  if (!match) return null;
  let column = 0;
  for (const letter of match[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
  const row = Number(match[2]);
  return row >= 1 && row <= rows && column >= 1 && column <= columns
    ? { row: row - 1, column: column - 1 } : null;
}

function selectionBounds(selection) {
  const { anchor, end } = selection;
  return {
    top: Math.min(anchor.row, end.row), bottom: Math.max(anchor.row, end.row),
    left: Math.min(anchor.column, end.column), right: Math.max(anchor.column, end.column)
  };
}

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function cellKey(row, column, columns) { return row * columns + column; }

const gridAxes = {
  column: { sizes: "widths", first: "left", last: "right", min: 28, max: 500, defaultSize: 105 },
  row: { sizes: "heights", first: "top", last: "bottom", min: 16, max: 160, defaultSize: 24 }
};
