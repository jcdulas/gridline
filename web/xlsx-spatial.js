const xlsxSpatialNamespace = "urn:gridsntabs:spatial-charts:1";
const xlsxSpatialPart = "customXml/gridsTabsCharts.xml";
const xlsxSpatialProperties = "customXml/gridsTabsChartProps.xml";

function xlsxSpatialAngles(chart) {
  const degrees = (radians) => Math.round(radians * 180 / Math.PI);
  return { x: degrees(chart.camera?.pitch ?? 0.51), y: (degrees(chart.camera?.yaw ?? 0.72) % 360 + 360) % 360 };
}

function xlsxSpatialGrid(engine, source, chart) {
  if (!source || chart.type === "scatter3d") return null;
  const data = chartData(engine, source, chart);
  const axes = chart.axes || [0, 1, 2];
  const fields = [data.categories.map(({ x }) => x), ...data.series.map(({ values }) => values)];
  const selectedColor = chart.colorBy ?? (chart.type === "surface3d" ? axes[1] : -1);
  if (chart.type === "surface3d" && selectedColor >= 0 && selectedColor !== axes[1]) return null;
  const xValues = new Set(), zValues = new Set(), points = new Map();
  for (let index = 0; index < data.categories.length; index++) {
    const [x, y, z] = axes.map((field) => fields[field][index]);
    if (![x, y, z].every(Number.isFinite)) continue;
    const key = `${x}:${z}`;
    if (points.has(key)) return null;
    xValues.add(x);
    zValues.add(z);
    const { top, left } = chart.source;
    const row = chart.orientation === "rows" ? top + axes[1] : top + index + 1;
    const column = chart.orientation === "rows" ? left + index + 1 : left + axes[1];
    points.set(key, { y, row, column, quantity: fields[selectedColor]?.[index] });
  }
  const x = [...xValues].sort((a, b) => a - b), z = [...zValues].sort((a, b) => a - b);
  if (!points.size || z.length > 255 || x.length * z.length > 10_000) return null;
  const uniform = (values) => values.length < 3 || values.slice(2).every((value, i) =>
    Math.abs((value - values[i + 1]) / (values[1] - values[0]) - 1) < 1e-7);
  if (chart.type === "surface3d" && (x.length < 2 || z.length < 2 || points.size !== x.length * z.length ||
      !uniform(x) || !uniform(z))) return null;
  return { x, z, points, selectedColor, titles: chart3dAxisTitles(data, chart), source: source.name };
}

function planXlsxSpatialCharts(engine, sheets, entries) {
  const chartMetadata = [], helpers = [];
  const names = new Set(sheets.map(({ name }) => name.toUpperCase()));
  for (const entry of entries) {
    const { sheet } = entry;
    entry.charts = [...(sheet.embeddedCharts || [])];
    if (sheet.chart) entry.charts.push({ chart: sheet.chart, row: 1, column: 1, width: 780, height: 450, chartSheet: true });
    entry.charts = entry.charts.map((object, index) => {
      if (!chart3dTypes.has(object.chart.type)) return object;
      const { chart } = object;
      const marker = `GridsNTabs3D-${entry.id}-${index + 1}`;
      const source = sheets.find(({ name }) => name === chart.sourceSheet);
      let native;
      try { native = xlsxSpatialGrid(engine, source, chart); }
      catch { /* The image export can still show the chart or its error message. */ }
      if (native) {
        let suffix = helpers.length + 1;
        while (names.has(`GRIDSNTABS 3D DATA ${suffix}`)) suffix++;
        native.helper = `GridsNTabs 3D Data ${suffix}`;
        names.add(native.helper.toUpperCase());
        const id = entries.length + helpers.length + 1;
        helpers.push({ id, path: `worksheets/sheet${id}.xml`, sheet: { name: native.helper }, helper: native });
      }
      chartMetadata.push({ marker, chart, chartSheet: Boolean(object.chartSheet),
        native: native ? { titles: native.titles, angles: xlsxSpatialAngles(chart) } : undefined });
      return { ...object, spatial: { marker, native } };
    });
  }
  entries.push(...helpers);
  return { charts: chartMetadata, helpers: helpers.map(({ sheet }) => sheet.name) };
}

async function writeXlsxSpatialMetadata(zip, metadata) {
  const xml = xmlHeader + `<spatialCharts xmlns="${xlsxSpatialNamespace}">` +
    metadata.helpers.map((name) => `<helper name="${xmlEscape(name)}"/>`).join("") +
    metadata.charts.map(({ marker, chart, chartSheet, native }) =>
      `<chart marker="${marker}" chartSheet="${Number(chartSheet)}">${xmlEscape(JSON.stringify({ chart, native }))}</chart>`).join("") +
    "</spatialCharts>";
  const properties = xmlHeader + '<ds:datastoreItem ds:itemID="{E70AC131-E7CF-40A5-B697-FCF1B6D69BD2}" ' +
    'xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs>' +
    `<ds:schemaRef ds:uri="${xlsxSpatialNamespace}"/></ds:schemaRefs></ds:datastoreItem>`;
  await zip.add(xlsxSpatialPart, [xml]);
  await zip.add(xlsxSpatialProperties, [properties]);
  await zip.add(relationshipPath(xlsxSpatialPart), [xmlRelationships([
    { id: 1, type: "customXmlProps", target: xlsxSpatialProperties.split("/").at(-1) }
  ])]);
}

async function readXlsxSpatialMetadata(zip, relations) {
  const charts = new Map(), helpers = new Set();
  for (const part of relations.values()) {
    if (part.type !== "customXml") continue;
    const entry = zip.entries.get(part.path);
    if (!entry || entry.length > 8_000_000) continue;
    try {
      const xml = readXml(await zip.text(part.path));
      if (xml.namespaceURI !== xlsxSpatialNamespace || xml.localName !== "spatialCharts") continue;
      for (const helper of children(xml, "helper")) {
        if (validSheetName(helper.getAttribute("name"))) helpers.add(helper.getAttribute("name"));
      }
      for (const item of children(xml, "chart")) {
        const marker = item.getAttribute("marker");
        if (!/^GridsNTabs3D-\d+-\d+$/.test(marker)) continue;
        try {
          const { chart, native } = JSON.parse(item.textContent);
          charts.set(marker, { chart, native, chartSheet: item.getAttribute("chartSheet") === "1" });
        }
        catch { /* Keep the drawing if this particular chart has invalid metadata. */ }
      }
    } catch { /* Other custom XML parts are outside Grids&Tabs's chart format. */ }
  }
  return { charts, helpers };
}

function xlsxNativeSpatialEdits(metadata, xml) {
  const { chart, native } = metadata;
  if (!native) return chart;
  const graphic = child(xml, "chart");
  const plot = child(graphic, "plotArea");
  if (!child(plot, "surface3DChart") && !child(plot, "bar3DChart")) return chart;
  const result = { ...chart };
  const title = (node) => {
    const content = child(node, "title");
    const runs = Array.from(content?.getElementsByTagNameNS(drawingMain, "t") || []);
    const cached = content?.getElementsByTagNameNS(chartNamespace, "v")[0]?.textContent;
    return runs.length ? runs.map((run) => run.textContent).join("").slice(0, 120) : cached?.slice(0, 120);
  };
  const chartTitle = title(graphic);
  if (chartTitle !== undefined) result.title = chartTitle;
  for (const [index, axis] of ["catAx", "valAx", "serAx"].entries()) {
    const text = title(child(plot, axis));
    if (text !== undefined && text !== native.titles[index]) result[["xTitle", "yTitle", "zTitle"][index]] = text;
  }
  const view = child(graphic, "view3D");
  const x = Number(child(view, "rotX")?.getAttribute("val") ?? NaN);
  const y = Number(child(view, "rotY")?.getAttribute("val") ?? NaN);
  if ((Number.isFinite(x) && x !== native.angles.x) || (Number.isFinite(y) && y !== native.angles.y)) {
    const camera = { yaw: 0.72, pitch: 0.51, zoom: 1, panX: 0, panY: 0, ...chart.camera };
    if (Number.isFinite(x) && x !== native.angles.x) camera.pitch = x * Math.PI / 180;
    if (Number.isFinite(y) && y !== native.angles.y) camera.yaw = y * Math.PI / 180;
    result.camera = camera;
  }
  return result;
}

function xlsxSpatialHelperSheet({ source, x, z, points }) {
  const sourceName = "'" + source.replaceAll("'", "''") + "'!";
  const output = new TextChunks();
  output.append(xmlHeader + `<worksheet xmlns="${sheetNamespace}"><sheetData><row r="1">`);
  for (const [i, value] of z.entries()) output.append(`<c r="${cellName(0, i + 1)}"><v>${value}</v></c>`);
  output.append("</row>");
  for (const [i, value] of x.entries()) {
    const row = i + 1;
    output.append(`<row r="${row + 1}"><c r="A${row + 1}"><v>${value}</v></c>`);
    for (const [j, depth] of z.entries()) {
      const point = points.get(`${value}:${depth}`);
      if (!point) continue;
      const reference = "$" + columnName(point.column) + "$" + (point.row + 1);
      output.append(`<c r="${cellName(row, j + 1)}"><f>${xmlEscape(sourceName + reference)}</f><v>${point.y}</v></c>`);
    }
    output.append("</row>");
  }
  output.append("</sheetData></worksheet>");
  return [...output.chunks, output.buffer];
}

function xlsxSpatialChartXml(chart, grid) {
  const { x, z, points, helper, titles, selectedColor } = grid;
  const surface = chart.type === "surface3d";
  const title = chartXmlTitle(chart.title);
  const chartTag = surface ? "surface3DChart" : "bar3DChart";
  const heights = [...points.values()].map(({ y }) => y);
  const colorValues = [...points.values()].map(({ quantity }) => quantity).filter(Number.isFinite);
  const palette = chart.colorPalette || "Viridis";
  const scale = colorValues.length ? chartColorScale(colorValues, palette, "") : null;
  const color = new GridlineThree.Color();
  const fill = (value) => `<c:spPr><a:solidFill><a:srgbClr val="${color.set(value).getHexString()}"/></a:solidFill></c:spPr>`;
  const series = z.map((depth, index) => {
    const address = columnName(index + 1);
    const ref = `'${helper}'!`;
    const items = x.map((value) => points.get(`${value}:${depth}`));
    const dataPoints = surface ? "" : items.map((point, i) => point
      ? `<c:dPt><c:idx val="${i}"/>${fill(scale ? scale.color(point.quantity) : point.y >= 0 ? "#287aab" : "#c35d40")}</c:dPt>`
      : "").join("");
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>` +
      chartCache("tx", ref + `$${address}$1`, [String(depth)], false) + dataPoints +
      chartCache("cat", ref + `$A$2:$A$${x.length + 1}`, x, true) +
      chartCache("val", ref + `$${address}$2:$${address}$${x.length + 1}`, items.map((item) => item?.y ?? null), true) + "</c:ser>";
  }).join("");
  const axis = (tag, id, cross, position, label, settings = "") => `<c:${tag}><c:axId val="${id}"/>` +
    '<c:scaling><c:orientation val="minMax"/>' + settings + "</c:scaling>" +
    `<c:delete val="0"/><c:axPos val="${position}"/>${tag === "valAx" ? "<c:majorGridlines/>" : ""}${chartXmlTitle(label)}` +
    `<c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/></c:${tag}>`;
  const ticks = chartTicks(Math.min(...heights), Math.max(...heights));
  const bandCount = Math.max(1, ticks.values.length - 1);
  const ramp = GridlineThree.ChartPalettes["interpolate" + palette];
  const bands = surface ? "<c:bandFmts>" + Array.from({ length: bandCount }, (_, index) =>
    `<c:bandFmt><c:idx val="${index}"/>${fill(selectedColor === -1 ? "#287aab" : ramp((index + 0.5) / bandCount))}</c:bandFmt>`).join("") + "</c:bandFmts>" : "";
  const { x: xAngle, y: yAngle } = xlsxSpatialAngles(chart);
  const view = `<c:view3D><c:rotX val="${xAngle}"/><c:rotY val="${yAngle}"/><c:rAngAx val="1"/></c:view3D>`;
  const options = surface ? '<c:wireframe val="0"/>' : '<c:barDir val="col"/><c:grouping val="clustered"/>';
  const geometry = surface ? bands : '<c:gapWidth val="60"/><c:gapDepth val="50"/><c:shape val="box"/>';
  const axes = '<c:axId val="100"/><c:axId val="200"/><c:axId val="300"/>';
  const scaleLimits = surface ? `<c:max val="${ticks.high}"/><c:min val="${ticks.low}"/>` : "";
  return xmlHeader + `<c:chartSpace xmlns:c="${chartNamespace}" xmlns:a="${drawingMain}" xmlns:r="${officeRels}"><c:chart>` +
    title + view + `<c:plotArea><c:layout/><c:${chartTag}>${options}${series}${geometry}${axes}</c:${chartTag}>` +
    axis("catAx", 100, 200, "b", titles[0]) + axis("valAx", 200, 100, "l", titles[1], scaleLimits) +
    axis("serAx", 300, 200, "b", titles[2]) + "</c:plotArea>" +
    '<c:plotVisOnly val="0"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>';
}
