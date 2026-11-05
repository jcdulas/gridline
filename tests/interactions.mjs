import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BroadcastChannel, MessageChannel } from "node:worker_threads";
import vm from "node:vm";

const html = await readFile(new URL("../gridline.html", import.meta.url), "utf8");
const [wasm, , script] = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

// Simulate the browser creating a shared scope and connecting separate ports.
const workers = new Map();
class SharedWorker {
  constructor(url, name) {
    const key = name + url;
    if (!workers.has(key)) {
      const self = {};
      vm.runInNewContext(decodeURIComponent(url.slice(url.indexOf(",") + 1)), { self });
      workers.set(key, self);
    }
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    port1.unref();
    port2.unref();
    workers.get(key).onconnect({ ports: [port2] });
  }
  addEventListener() {}
}

const context = vm.createContext({
  WebAssembly, TextEncoder, TextDecoder, Blob, atob, assert, setTimeout, clearTimeout, clearInterval,
  SharedWorker, BroadcastChannel, location: { pathname: "/gridline.html" },
  performance, navigator: {}, document: { getElementById: () => ({ textContent: wasm }) }
});
const definitions = script.slice(0, script.lastIndexOf("initializeIcons(document);"));
await vm.runInContext(definitions + `
(async () => {
  const first = new GridlineClipboard();
  const second = new GridlineClipboard();
  try {
    first.write({ text: "1\\t2", html: "<table></table>" });
    assert.equal((await first.read()).text, "1\\t2");
    assert.equal((await second.read()).html, "<table></table>");
    second.write({ text: "3\\t4" });
    assert.equal((await second.read()).text, "3\\t4");
    assert.equal((await first.read()).text, "3\\t4");
  } finally { first.port?.close(); second.port?.close(); }

  globalThis.SharedWorker = undefined;
  const original = new GridlineClipboard();
  original.write({ text: "5\\t6", html: "<table><tr><td>5</td><td>6</td></tr></table>" });
  const otherWindow = new GridlineClipboard();
  try { assert.match((await otherWindow.read()).html, /<td>6/); }
  finally { original.channel?.close(); otherWindow.channel?.close(); }

  const engine = await WorkbookEngine.load();
  const sheet = newSheetModel(engine.addSheet("References"), "References");
  engine.set(sheet.id, 0, 1, "7");
  engine.set(sheet.id, 1, 1, "8");
  const cell = { row: 0, column: 0 };
  const input = (value) => ({
    value, selectionStart: value.length, selectionEnd: value.length,
    focus() {}, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  });
  const canvas = { focus() {}, setPointerCapture() {}, hasPointerCapture() { return false; } };
  const view = {
    hit: () => ({ row: 0, column: 1 }),
    requestDraw() {},
    visibleRows: [], visibleColumns: []
  };
  const app = Object.assign(Object.create(GridlineApp.prototype), {
    engine, sheet, canvas, view, formula: input("=SUM("), editor: input(""),
    edit: { mode: "formula", cell, original: "" }, dialog: { open: false },
    setEditing() {}, refreshSelection() {}, status() {},
    change(patches) {
      for (const { row, column, after } of patches) engine.set(sheet.id, row, column, after);
    }
  });
  const controls = Object.assign(Object.create(GridControls.prototype), { app, view, canvas });
  app.gridControls = controls;
  const down = { button: 0, pointerId: 1, preventDefault() {} };
  controls.pointerDown(down);
  assert.equal(app.formula.value, "=SUM(B1");
  controls.updateDrag({ row: 1, column: 1 });
  assert.equal(app.formula.value, "=SUM(B1:B2");
  controls.finish(false);
  assert.equal(app.formula.value, "=SUM(");
  controls.pointerDown(down);
  controls.finish(true);
  controls.pointerDown(down);
  controls.updateDrag({ row: 1, column: 1 });
  controls.finish(true);
  assert.equal(app.formula.value, "=SUM(B1:B2");
  app.formula.value += ")";
  assert.ok(app.commitEdit());
  assert.equal(engine.value(sheet.id, 0, 0).number, 15);

  const moves = [];
  app.move = (row, column) => moves.push([row, column]);
  for (const [key, cursor] of [["ArrowUp", 1], ["ArrowDown", 1], ["ArrowLeft", 0], ["ArrowRight", 2], ["ArrowRight", 1]]) {
    app.formula = input("15");
    app.formula.setSelectionRange(cursor, cursor);
    app.edit = { mode: "formula", cell, original: "=SUM(B1:B2)" };
    app.editKey({ key, preventDefault() {} });
  }
  assert.equal(JSON.stringify(moves), "[[-1,0],[1,0],[0,-1],[0,1]]");
  assert.ok(app.edit, "An arrow within the text must leave the editor open");
  app.commitEdit(true);

  const geometry = { scale: 1, headerWidth: 40, headerHeight: 24 };
  const box = { x: 100, y: 90, width: 200, height: 100, item: { placement: "floating" } };
  const west = resizedObjectBox({ object: box, horizontal: -1, vertical: 0, x: 100, y: 140 },
    { x: 145, y: 140 }, geometry);
  assert.equal(west.width, 155);
  assert.equal(west.x + west.width, 300);
  const corner = resizedObjectBox({ object: box, horizontal: 1, vertical: 1, x: 300, y: 190 },
    { x: 400, y: 240 }, geometry);
  assert.equal(corner.width / corner.height, 2);
  const embedded = { ...box, item: { placement: "cell" } };
  const contained = resizedObjectBox({ object: embedded, horizontal: -1, vertical: -1, x: 100, y: 90 },
    { x: 90, y: 80 }, geometry);
  assert.equal(contained.x, 100);
  assert.equal(contained.height, 110);

  engine.set(sheet.id, 3, 0, "Category");
  engine.set(sheet.id, 3, 1, "Jan");
  engine.set(sheet.id, 3, 2, "Feb");
  engine.set(sheet.id, 4, 0, "Revenue");
  engine.set(sheet.id, 4, 1, "12");
  engine.set(sheet.id, 4, 2, "9");
  const table = { top: 3, bottom: 4, left: 0, right: 2, axis: "row" };
  assert.equal(tableHeaderField(table, { row: 4, column: 0 }), 4);
  const hidden = await tableFilterRanges(engine, sheet, { table, field: 4, condition: "greater", text: "10" });
  assert.equal(JSON.stringify(hidden), "[[2,2]]");
  assert.equal(skipHidden(2, 1, hidden), 3);
  const chart = validateChart({ sourceSheet: sheet.name, source: table, title: "Revenue",
    orientation: "rows", type: "line" }, engine);
  assert.equal(JSON.stringify(chartData(engine, sheet, chart).series[0].values), "[12,9]");
  assert.ok(xlsxChartXml(engine, [sheet], chart).includes("$B$5:$C$5"));

  const sourceCell = { row: 9, column: 1 };
  const copiedStyle = { bold: true, fill: "#eaf5ee", border: "#14774c", format: "percent", decimals: 1 };
  engine.set(sheet.id, sourceCell.row, sourceCell.column, "=SUM(B1:B2)");
  sheet.styles.set(cellKey(sourceCell.row, sourceCell.column, engine.columns), copiedStyle);
  app.select(sourceCell, sourceCell, false);
  const clipboard = new Map();
  let cached;
  app.clipboardCache = { write: (data) => { cached = data; } };
  app.clipboardEvent({ clipboardData: { setData: (type, value) => clipboard.set(type, value) }, preventDefault() {} }, false);
  assert.equal(clipboard.get("text/plain"), "=SUM(B1:B2)");
  assert.match(clipboard.get("text/html"), /border:1px solid #14774c/);
  assert.equal(cached.html, clipboard.get("text/html"));
  const field = readClipboardCell({
    getAttribute: () => JSON.stringify(["=SUM(B1:B2)", copiedStyle])
  });
  const destination = { row: 10, column: 1 };
  engine.set(sheet.id, destination.row, destination.column, "=SUM(B1:B2)");
  assert.equal(app.inputPatch(destination, field.text, field).newStyle.border, copiedStyle.border);

  let received;
  app.paste = (data) => { received = data; };
  app.clipboardCache = { read: async () => cached };
  let systemReads = 0;
  const session = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => session.get(key),
    setItem: (key, value) => session.set(key, value)
  };
  navigator.clipboard = { readText: async () => { systemReads++; throw new Error("Clipboard blocked"); } };
  for (const state of ["denied", "prompt", "prompt"]) {
    navigator.permissions = { query: async ({ name }) => {
      assert.equal(name, "clipboard-read");
      return { state };
    } };
    received = "";
    await app.pasteFromMenu();
    assert.equal(received.html, cached.html);
  }
  assert.equal(systemReads, 1, "The browser prompt is attempted only once");
  app.clipboardPromptRequested = false;
  await app.pasteFromMenu();
  assert.equal(systemReads, 1, "Reloading the page does not repeat the prompt in the same tab");
  delete navigator.permissions;
  await app.pasteFromMenu();
  assert.equal(systemReads, 1);
  assert.equal(received.text, cached.text);
  navigator.permissions = { query: async () => ({ state: "granted" }) };
  navigator.clipboard.readText = async () => { systemReads++; return "System clipboard"; };
  await app.pasteFromMenu();
  assert.equal(systemReads, 2);
  assert.equal(received.text, "System clipboard");
  navigator.clipboard.read = async () => [{
    types: ["text/plain", "text/html"],
    getType: async (type) => new Blob([clipboard.get(type)])
  }];
  await app.pasteFromMenu();
  assert.equal(received.html, cached.html);
  delete navigator.clipboard.read;
  navigator.clipboard.readText = async () => { throw new Error("Clipboard blocked"); };
  await app.pasteFromMenu();
  assert.equal(received.html, cached.html);
})()`, context);
console.log("Formula pointing, editing keys, resize geometry, table filtering, row charts, and clipboard checks passed.");
