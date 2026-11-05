import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const document = await readFile(new URL("../gridline.html", import.meta.url), "utf8");
const payload = /id="engine-wasm">([A-Za-z0-9+/=]+)<\/script>/.exec(document);
assert.ok(payload, "The deliverable embeds WebAssembly");
const { instance } = await WebAssembly.instantiate(Buffer.from(payload[1], "base64"), {
  env: { emscripten_notify_memory_growth() {} },
  wasi_snapshot_preview1: { proc_exit(code) { throw new Error(`WASM exited with ${code}`); } }
});
const wasm = instance.exports;
wasm._initialize();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function write(text) {
  const bytes = encoder.encode(text);
  new Uint8Array(wasm.memory.buffer, wasm.workbook_input(), bytes.length).set(bytes);
  return bytes.length;
}

function output() {
  return decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.workbook_output(), wasm.workbook_output_size()));
}

const main = wasm.workbook_add_sheet(write("Main"));
const rates = wasm.workbook_add_sheet(write("Rates & costs"));
function set(row, column, text, sheet = main) {
  assert.equal(wasm.workbook_set(sheet, row, column, write(text)), 1);
}
function value(row, column, sheet = main) {
  wasm.workbook_value(sheet, row, column);
  return output();
}
function formula(source, expected) {
  set(0, 4, source);
  assert.equal(value(0, 4), expected, source);
}

assert.equal(wasm.workbook_rows(), 8_000_000);
assert.equal(wasm.workbook_columns(), 400);
assert.equal(wasm.workbook_set(main, 8_000_000, 399, write("1")), 0);
assert.equal(wasm.workbook_set(main, 7_999_999, 400, write("1")), 0);
set(7_999_999, 399, "9");
set(0, 0, "2");
set(1, 0, "5");
set(2, 0, "8");
set(7_999_999, 0, "10");
set(0, 1, "North");
set(1, 1, "West");
set(2, 1, "Northwest");
set(0, 0, "0.25", rates);

formula("=OJ8000000+SUM(A:A)", "34");
formula("=2+3*4^2", "50");
formula("=10%+1E-1", "0.2");
formula("=ROUND((A1+A2)*'Rates & costs'!$A$1,2)", "1.75");
assert.equal(wasm.workbook_rename_sheet(rates, write("New rates")), 1);
assert.equal(value(0, 4), "1.75");
wasm.workbook_raw(main, 0, 4);
assert.equal(output(), "=ROUND((A1+A2)*'New rates'!$A$1,2)");
set(0, 0, "0.5", rates);
assert.equal(value(0, 4), "3.5");
formula('=IF(A1<A2,"Yes",E1)', "Yes");
formula("=IFERROR(1/0,42)", "42");
formula("=IFERROR(E1,42)", "#CYCLE!");
formula("=AVERAGE(C1:C10)", "#DIV/0!");
formula("=SUM(B1)", "0");
formula("=A8000001", "#REF!");
formula("=A1+#REF!", "#REF!");
formula('=COUNTIF(B:B,"North*")', "2");
formula('=COUNTIF(B1:B8000000,"")', "7999997");
formula('=SUMIF(B1:B3,"North*",A1)', "10");
formula('=AVERAGEIF(B1:B3,"North*",A1:A3)', "5");
formula('=VLOOKUP(5,A1:B3,2,FALSE)', "West");
formula('=_xlfn.XLOOKUP("West",B1:B3,A1:A3)', "5");
formula('=XLOOKUP("Other",B1:B3,A1:A3,"Missing")', "Missing");
formula('=MATCH("North*",B1:B3,0)', "1");
formula("=INDEX(A1:B3,3,2)", "Northwest");
formula('=CONCAT("a","""",B1)', 'a"North');
formula("=SUM(", "#FORMULA!");
assert.equal(wasm.workbook_last_row(main, 399), 7_999_999);
assert.equal(wasm.workbook_jump_row(main, 0, 0, 1), 2);
assert.equal(wasm.workbook_jump_row(main, 2, 0, 1), 7_999_999);
assert.equal(wasm.workbook_jump_row(main, 2, 0, -1), 0);
assert.equal(wasm.workbook_jump_row(main, 7_999_998, 0, 1), 7_999_999);
formula('=SUMIFS(A1:A3,B1:B3,"North*",A1:A3,">2")', "8");
formula('=COUNTIFS(A:A,"",B:B,"")', "7999996");
formula("=SUMPRODUCT(A1:A3,A1:A3)", "93");
formula("=MEDIAN(A1:A3)", "5");
formula("=STDEV.S(A1:A3)", "3");
formula('=TEXTJOIN("|",TRUE,A1:B2)', "2|North|5|West");
formula('=LEFT("École",2)', "Éc");
formula('=IFNA(NA(),"OK")', "OK");
formula("=ROUNDUP(-12.31,1)", "-12.4");
formula("=DAY(DATE(2024,3,0))", "29");
formula("=DAY(DATE(2100,3,0))", "28");
formula("=DAY(EDATE(DATE(2024,1,31),1))", "29");
formula("=DAYS(DATE(2024,3,1),DATE(2024,2,28))", "2");
formula('=HOUR(TIMEVALUE("2:45 PM"))', "14");
wasm.workbook_set_calendar(1, 1);
formula("=DATE(1904,1,1)", "0");
formula("=TODAY()", "1");
wasm.workbook_set_calendar(0, 0);
formula("=DATE(1900,2,29)", "60");

const sales = wasm.workbook_add_sheet(write("Test sales"));
for (const [row, fields] of [
  ["Region", "Channel", "Sales"],
  ["East", "Direct", "4"], ["East", "Retail", "10"], ["West", "Direct", "8"], ["East", "Direct", "6"]
].entries()) fields.forEach((text, column) => set(row, column, text, sales));
assert.equal(wasm.workbook_pivot_start(sales, 0, 7_999_999, 0, 2, 1, -1, write("")), 1);
assert.equal(wasm.workbook_pivot_row_field(0), 1);
assert.equal(wasm.workbook_pivot_measure(2, 0), 1);
assert.equal(wasm.workbook_pivot_measure(2, 2), 1);
assert.equal(wasm.workbook_pivot_step(2), 1);
assert.equal(wasm.workbook_pivot_step(2), 0);
assert.equal(wasm.workbook_pivot_count(0), 2);
assert.equal(wasm.workbook_pivot_count(1), 2);
wasm.workbook_pivot_label(0, 0, 0);
assert.equal(output(), "East");
wasm.workbook_pivot_value(0, 0, 0);
assert.equal(output(), "10");
wasm.workbook_pivot_value(0, 0, 1);
assert.equal(output(), "5");
wasm.workbook_pivot_value(-1, -1, 0);
assert.equal(output(), "28");
wasm.workbook_pivot_close();
console.log("Engine and worksheet boundary checks passed.");

if (process.argv.includes("--stress")) {
  const start = performance.now();
  const large = wasm.workbook_add_sheet(write("Large sheet"));
  const size = write("1");
  for (let row = 0; row < 8_000_000; row++) {
    if (!wasm.workbook_set(large, row, 0, size)) throw new Error(`Failed to write row ${row + 1}`);
  }
  set(7_999_999, 399, "=SUM(A:A)", large);
  assert.equal(value(7_999_999, 399, large), "8000000");
  console.log(`8,000,000 populated rows summed correctly in ${((performance.now() - start) / 1000).toFixed(2)} s, using ${Math.round(wasm.memory.buffer.byteLength / 2 ** 20)} MiB of WASM memory.`);
}
