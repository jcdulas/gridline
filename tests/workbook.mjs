import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../gridsntabs.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
const [wasm, vendor, app] = scripts;
let download;
const context = vm.createContext({
  assert, WebAssembly, TextEncoder, TextDecoder, TextDecoderStream, Blob, Response, CompressionStream,
  DecompressionStream, File, atob, btoa, performance, console,
  setTimeout(callback, delay) { if (delay === 0) queueMicrotask(callback); },
  URL: class extends URL {
    static createObjectURL(blob) { download = blob; return "blob:test"; }
  },
  document: {
    getElementById() { return { textContent: wasm }; },
    createElement() { return { click() {} }; }
  }
});
const main = app.slice(0, app.lastIndexOf("initializeIcons(document);"));
await vm.runInContext(vendor + "\n" + main + `
(async () => {
  const engine = await WorkbookEngine.load();
  const sheet = newSheetModel(engine.addSheet("Source"), "Source");
  const data = [
    ["X", "Y", "Z", "Other"], ["0", "1", "0", "10"], ["1", "3", "0", "20"],
    ["0", "2", "1", "30"], ["1", "6", "1", "40"]
  ];
  for (const [row, fields] of data.entries()) {
    for (const [column, text] of fields.entries()) engine.set(sheet.id, row, column, text);
  }
  const source = { top: 0, bottom: 4, left: 0, right: 3 };
  const chart = validateChart({ sourceSheet: sheet.name, source, type: "line",
    title: "Quarterly graph", xTitle: "Horizontal axis", yTitle: "Vertical axis", series: [0, 2] }, engine);
  const points = chartData(engine, sheet, chart);
  const marks = chartLayout(points, chart, 720, 400, new Set([1]));
  assert.equal(marks.hits.length, 8);
  assert.ok(marks.labels.some((label) => label.text === "Horizontal axis"));
  const surface = surfaceMesh(chart3dData(points, { axes: [0, 1, 2] }));
  assert.equal(surface.index.length, 6);
  assert.equal(surface.vertices.length, 4);
  assert.equal(surfaceMesh([[1, 3, 0], [2, 5, 1], [3, 7, 0]]).index.length, 3);
  assert.throws(() => surfaceMesh([[0, 0, 0], [1, 2, 1], [2, 4, 2]]), /non-collinear/);
  const incompleteGrid = Array.from({ length: 9 }, (_, index) => [index % 3, index, Math.floor(index / 3)])
    .filter(([, y]) => y !== 4);
  assert.equal(surfaceMesh(incompleteGrid).index.length, 12, "The center of a sampled grid remains open");
  const disconnected = surfaceMesh([[0, 0, 0], [0.7, 1, 0.1], [0.2, 2, 0.8],
    [10, 3, 10], [10.6, 4, 10.2], [10.1, 5, 10.9]]);
  assert.equal(disconnected.index.length, 6, "Distant clusters are meshed independently");
  assert.ok(chartPaletteNames.size > 30);
  for (const palette of chartPaletteNames) assert.equal(typeof GridlineThree.ChartPalettes["interpolate" + palette], "function");
  const encoded = chart3dGeometry(points, { type: "surface3d", colorBy: 3, colorPalette: "Cividis" });
  assert.equal(encoded.scale.name, "Other");
  assert.equal(encoded.scale.low, 10);
  assert.equal(encoded.scale.high, 40);
  assert.notEqual(encoded.scale.color(10), encoded.scale.color(40));
  assert.equal(chartColorScale([-1, 10], "RdBu", "Delta").color(0), GridlineThree.ChartPalettes.interpolateRdBu(0.5));
  assert.equal(normalizeColorHex(" #AbC "), "#aabbcc");
  assert.equal(normalizeColorHex("rgb(1,2,3)"), null);
  assert.equal(new Set(presetCellColors).size, 80);
  assert.equal(JSON.stringify(readContourLevels("custom", "-1, 0.25, 2e2")), "[-1,0.25,200]");
  assert.throws(() => readContourLevels("custom", "1, Infinity"), /numeric contour/);
  const spatialConfig = validateChart({ sourceSheet: sheet.name, source, type: "surface3d", title: "Surface",
    colorBy: 3, colorPalette: "RdBu", contours: [4, 2, 4, 3] }, engine);
  assert.equal(JSON.stringify(spatialConfig.contours), "[2,3,4]");
  const spatial = new Chart3D({ canvas: null }, false);
  spatial.rebuild(points, spatialConfig);
  assert.ok(spatial.scene.children.some((child) => child.isHemisphereLight));
  const mesh = spatial.scene.children.find((child) => child.material?.isMeshPhongMaterial);
  assert.equal(mesh.geometry.getAttribute("normal").count, 4);
  assert.ok(mesh.geometry.getAttribute("normal").getY(0) > 0);
  const quantities = mesh.geometry.getAttribute("surfaceQuantity");
  assert.equal(quantities.getX(0), 0);
  assert.equal(quantities.getX(3), 1);
  assert.equal(spatial.surfaceTexture.image.width, 256);
  const contours = surfaceContourSegments(spatial.surface, [0]);
  assert.ok(contours.length > 0);
  assert.ok(contours.every((value, index) => index % 3 !== 1 || value === 0));
  const weights = new GridlineThree.Vector3(0.25, 0.25, 0.5);
  assert.equal(surfaceQuantityAt(spatial.surface.vertices.slice(0, 3), weights), 22.5);
  spatial.setCamera({ yaw: 1.2, pitch: 0.4, zoom: 1.6, panX: 0.3 });
  assert.equal(spatial.getCamera().panX, 0.3);
  spatial.camera.position.set(0, 3, 0);
  spatial.camera.up.set(0, 0, -1);
  spatial.camera.lookAt(0, 0, 0);
  spatial.camera.updateMatrixWorld();
  spatial.scene.updateMatrixWorld();
  assert.match(spatial.hitTest(50, 50, 100, 100, spatialConfig), /Color · Other:/);
  spatial.dispose();
  const linear = estimateTrendline([[1, 3], [2, 5], [3, 7]], { type: "linear" });
  assert.equal(linear.equation, "y = 2 x + 1");
  assert.ok(Math.abs(linear.predict(7) - 15) < 1e-10);
  assert.equal(linear.rSquared, 1);
  const polynomial = estimateTrendline([[0, 3], [1, 6], [2, 13], [3, 24]], { type: "poly", order: 2 });
  assert.equal(polynomial.equation, "y = 2 x² + 1 x + 3");
  assert.ok(Math.abs(polynomial.predict(4) - 39) < 1e-10);
  const power = estimateTrendline([[1, 3], [2, 12], [3, 27]], { type: "power" });
  assert.ok(Math.abs(power.predict(4) - 48) < 1e-10);
  assert.throws(() => estimateTrendline([[0, 2], [1, 3]], { type: "log" }), /positive X/);
  const xy = validateChart({ sourceSheet: sheet.name, source, type: "curve", title: "Smooth XY",
    trendline: { type: "linear", series: 0 } }, engine);
  assert.match(chartLayout(points, xy, 600, 400, new Set()).trend.equation, /^y = /);
  const xyXml = xlsxChartXml(engine, [sheet], xy);
  assert.match(xyXml, /<c:scatterStyle val="smoothMarker"/);
  assert.match(xyXml, /<c:trendlineType val="linear".*<c:dispEq val="1"/);
  const sample = (text) => {
    const parsed = calendarInput(text, null, engine);
    return { raw: parsed.text, style: parsed.style, value: { kind: ValueKind.number, number: Number(parsed.text) } };
  };
  const leap = seriesPattern([sample("2024-02-28")], engine);
  assert.equal(calendarDisplay(Number(leap(1)), { format: "date" }), "2024-02-29");
  assert.equal(calendarDisplay(Number(leap(2)), { format: "date" }), "2024-03-01");
  const century = seriesPattern([sample("2100-02-28")], engine);
  assert.equal(calendarDisplay(Number(century(1)), { format: "date" }), "2100-03-01");
  const monthly = seriesPattern([sample("2024-01-31"), sample("2024-02-29")], engine);
  assert.equal(calendarDisplay(Number(monthly(2)), { format: "date-eu" }), "31/03/2024");
  assert.equal(readCalendarDate("2100-02-29"), null);
  assert.equal(calendarDisplay(60, { format: "date" }), "1900-02-29");
  const text = new File(['Name;Amount;Note\\r\\nCafé;12;"First line\\nsecond; line"\\r\\nShop;8;"=2+2"'], "sales.txt");
  const importFormat = await inspectDelimitedFile(text, engine);
  assert.equal(importFormat.separator, ";");
  assert.equal(importFormat.columns, 3);
  const imported = newSheetModel(engine.addSheet("Imported text"), "Imported text");
  assert.equal(await importDelimited(engine, imported, text, importFormat), 3);
  assert.equal(engine.value(imported.id, 1, 0).text, "Café");
  assert.equal(engine.value(imported.id, 1, 2).text, "First line\\nsecond; line");
  assert.equal(engine.value(imported.id, 2, 2).text, "=2+2");
  for (const separator of [",", "\\t", "|"]) {
    const tableText = ["Name", "Price"].join(separator) + "\\n" + ["Test", "20"].join(separator);
    const tableFile = new File([tableText], "table.txt");
    assert.equal((await inspectDelimitedFile(tableFile, engine)).separator, separator);
  }
  const utf16 = new Uint8Array([255, 254, ...Array.from("X\\tY\\r\\n2\\t4").flatMap((char) => [char.charCodeAt(0), 0])]);
  const wideText = new File([utf16], "unicode.txt");
  const wideFormat = await inspectDelimitedFile(wideText, engine);
  assert.equal(wideFormat.encoding, "utf-16le");
  assert.equal(await importDelimited(engine, imported, wideText, wideFormat), 2);
  assert.equal(engine.value(imported.id, 1, 1).number, 4);
  await assert.rejects(inspectDelimitedFile(new File(["Hello, friend.\\nHere is a paragraph."], "notes.txt"), engine), /No clear table/);
  const oneColumn = new File(["Item\\nA\\nB"], "single.csv");
  assert.equal(await importDelimited(engine, imported, oneColumn, await inspectDelimitedFile(oneColumn, engine)), 3);
  const longRow = "X".repeat(1024) + "|1\\n";
  const lateMismatch = new File([longRow.repeat(70), "unrelated line"], "late.txt");
  const lateFormat = await inspectDelimitedFile(lateMismatch, engine);
  await assert.rejects(importDelimited(engine, imported, lateMismatch, lateFormat), /Row 71/);

  const alignedRows = [
    "Name".padEnd(14) + "Qty    City",
    "Alice".padEnd(14) + "  1    Paris",
    "Jean Dupont".padEnd(14) + " 20    Lyon",
    "Claire".padEnd(21) + "Nantes"
  ];
  const alignedSource = alignedRows.join("\\r\\n");
  const alignedFile = new File([alignedSource], "aligned.txt");
  const alignedFormat = await inspectDelimitedFile(alignedFile, engine);
  assert.equal(alignedFormat.aligned, true);
  const alignedSheet = newSheetModel(engine.addSheet("Aligned text"), "Aligned text");
  await importDelimited(engine, alignedSheet, alignedFile, alignedFormat);
  assert.equal(engine.raw(alignedSheet.id, 2, 0), "Jean Dupont");
  assert.equal(engine.raw(alignedSheet.id, 3, 1), "");
  assert.equal(engine.raw(alignedSheet.id, 3, 2), "Nantes");
  await exportOriginalText(engine, alignedSheet);
  assert.equal(await globalThis.downloadBlob().text(), alignedSource);
  engine.set(alignedSheet.id, 1, 0, "Alexandra Dupont");
  await saveWorkbook(engine, "Aligned", [alignedSheet]);
  const savedText = await openWorkbook(new File([globalThis.downloadBlob()], "Aligned.gridsntabs"));
  await exportOriginalText(savedText.engine, savedText.sheets[0]);
  const edited = await globalThis.downloadBlob().text();
  const editedRows = edited.split("\\r\\n");
  assert.ok(editedRows[1].startsWith("Alexandra Dupont"));
  assert.equal(editedRows[0].indexOf("City"), editedRows[1].indexOf("Paris"));
  assert.equal(editedRows[0].indexOf("City"), editedRows[3].indexOf("Nantes"));
  assert.equal(editedRows[1].indexOf("1"), editedRows[2].indexOf("0"));
  assert.ok(!edited.endsWith("\\n"));
  const reread = await inspectDelimitedFile(new File([edited], "edited.txt"), engine);
  assert.equal(reread.layout.length, 3);
  const padded = alignedRows.map((line) => line.padEnd(30)).join("\\n") + "\\n";
  const paddedFile = new File([padded], "padded.prn");
  const paddedSheet = newSheetModel(engine.addSheet("Padded"), "Padded");
  await importDelimited(engine, paddedSheet, paddedFile, await inspectDelimitedFile(paddedFile, engine));
  await exportOriginalText(engine, paddedSheet);
  assert.equal(await globalThis.downloadBlob().text(), padded);
  const variable = await inspectDelimitedFile(new File(["short  first  a\\nlonger value   second        b"], "variable.txt"), engine);
  assert.equal(variable.layout.length, 3);
  assert.equal(variable.aligned, false);
  const decimal = await inspectDelimitedFile(new File(["1,25    3,50\\n2,55    5,75"], "decimals.txt"), engine);
  assert.equal(decimal.layout.length, 2);
  const regionalCsv = new File(["Code;Amount\\r\\nA;1,50\\r\\n"], "regional.csv");
  assert.equal((await inspectDelimitedFile(regionalCsv, engine)).separator, ";");
  const grid = {
    sheet, engine, active: () => ({ row: 1, column: 1 }),
    raw: ({ row, column }) => engine.raw(sheet.id, row, column),
    style: () => undefined
  };
  const table = detectedTable(grid, grid.active());
  assert.equal(rangeAddress(table), "A1:D5");
  assert.equal(table.axis, "column");
  const pivot = validatePivot({ sourceSheet: sheet.name, source, rowFields: [0], columnField: 2,
    filterField: -1, filterValue: "", values: [{ column: 1, summary: 0 }] }, engine);
  const report = await pivotReport(engine, sheet, pivot);
  assert.equal(report.at(-1).at(-1), "12");

  const euroStyle = { format: "currency-eur", decimals: 3 };
  assert.equal(cellDisplay({ kind: ValueKind.number, number: 1234.5 }, euroStyle), "€1,234.500");
  const euroXlsx = new XlsxStyles();
  euroXlsx.numberFormat(euroStyle);
  const [euroCode, euroId] = [...euroXlsx.formats][0];
  assert.equal(euroCode, '"€"#,##0.000');
  assert.equal(numberStyle(euroId, euroCode, false).format, "currency-eur");
  assert.equal(numberStyle(euroId, "#,##0.00 [$€-407]", false).decimals, 2);
  sheet.styles.set(cellKey(1, 3, engine.columns), euroStyle);
  sheet.embeddedCharts = [validateEmbeddedChart({ row: 1, column: 5, width: 640, height: 390,
    placement: "floating", chart }, engine)];
  sheet.embeddedCharts.push(...[
    { ...spatialConfig, colorBy: 1, title: "Native surface" },
    { ...spatialConfig, type: "columns3d", title: "Native columns" },
    { ...spatialConfig, type: "scatter3d", title: "Editable scatter",
      camera: { yaw: 1.2, pitch: 0.4, zoom: 1.6, panX: 0.3, panY: -0.1 } }
  ].map((chart, index) => validateEmbeddedChart({ row: 10 + index * 18, column: 5, width: 640, height: 390,
    placement: "floating", chart }, engine)));
  sheet.images = [validateImage({ row: 0, column: 6, width: 32, height: 24, placement: "cell", name: "Dot",
    data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==" }, engine)];
  await saveWorkbook(engine, "Test", [sheet]);
  globalThis.roundtrip = await openWorkbook(new File([globalThis.downloadBlob()], "Test.gridsntabs"));
  assert.equal(roundtrip.sheets[0].images[0].placement, "cell");
  assert.equal(roundtrip.sheets[0].embeddedCharts[0].chart.title, "Quarterly graph");
  assert.equal(roundtrip.sheets[0].embeddedCharts[3].chart.camera.zoom, 1.6);
  assert.equal(roundtrip.sheets[0].styles.get(cellKey(1, 3, engine.columns)).format, "currency-eur");
  const reportSheet = newSheetModel(engine.addSheet("Report"), "Report");
  reportSheet.pivot = validatePivot({ ...pivot, filterField: 3, filterValue: "20",
    values: [{ column: 1, summary: 0 }, { column: 3, summary: 5 }] }, engine);
  assert.equal(await saveXlsx(engine, "Test", [sheet, reportSheet], ({ title }) =>
    ({ data: sheet.images[0].data, name: title })), false);
  globalThis.nativeXlsx = globalThis.downloadBlob();

  const extended = newSheetModel(engine.addSheet("Extended"), "Extended");
  engine.set(extended.id, 1_048_575, 0, "10");
  engine.set(extended.id, 1_048_576, 0, "=A1048576+1");
  engine.set(extended.id, engine.rows - 1, engine.columns - 1, "Far corner & é");
  extended.heights.set(engine.rows - 1, 52);
  assert.equal(await saveXlsx(engine, "Extended", [extended]), true);
  const zip = await ZipArchive.open(globalThis.downloadBlob());
  const path = "xl/worksheets/sheet1.xml";
  const worksheet = await zip.text(path);
  assert.match(worksheet, /r="A1048577"/);
  assert.match(worksheet, /r="OJ8000000"/);
  const destination = newSheetModel(engine.addSheet("Streamed"), "Streamed");
  const streamingZip = {
    entries: new Map([[path, { length: xlsxStreamingThreshold }]]),
    stream: () => zip.stream(path)
  };
  await readXlsxSheet(streamingZip, path, engine, destination, [], [], new Map());
  assert.equal(engine.raw(destination.id, 1_048_576, 0), "=A1048576+1");
  assert.equal(engine.value(destination.id, 1_048_576, 0).number, 11);
  assert.equal(engine.raw(destination.id, engine.rows - 1, engine.columns - 1), "Far corner & é");
  assert.equal(destination.heights.get(engine.rows - 1), 52);
})()`, Object.assign(context, { downloadBlob: () => download }));

download = context.nativeXlsx;
assert.equal(download.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
const zip = new Uint8Array(await download.arrayBuffer());
assert.equal(zip[0], 0x50);
assert.equal(zip[1], 0x4b);
if (process.argv[2]) await writeFile(process.argv[2], zip);
console.log("Calendar fill, detected tables, pivots, chart geometry, and workbook serialization passed.");
