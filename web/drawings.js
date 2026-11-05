const drawingNamespace = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const drawingMain = "http://schemas.openxmlformats.org/drawingml/2006/main";
const chartNamespace = "http://schemas.openxmlformats.org/drawingml/2006/chart";

function xmlRelationships(items) {
  return xmlHeader + `<Relationships xmlns="${packageRels}">${items.map(({ id, type, target }) =>
    `<Relationship Id="rId${id}" Type="${officeRels}/${type}" Target="${xmlEscape(target)}"/>`).join("")}</Relationships>`;
}

function xlsxDrawingImage(image, id) {
  const description = image.description ? ` descr="${xmlEscape(image.description)}"` : "";
  return `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${xmlEscape(image.name)}"${description}/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip r:embed="rId${id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`;
}

function xlsxDrawingChart(id, description = "") {
  return `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="Chart ${id}"${description ? ` descr="${xmlEscape(description)}"` : ""}/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${chartNamespace}"><c:chart r:id="rId${id}"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
}

function xlsxAnchor({ row, column, width, height, offsetX = 0, offsetY = 0, placement }, shape) {
  const marker = (tag, row, column, x = 0, y = 0) => `<xdr:${tag}><xdr:col>${column}</xdr:col><xdr:colOff>${x * 9525}</xdr:colOff>` +
    `<xdr:row>${row}</xdr:row><xdr:rowOff>${y * 9525}</xdr:rowOff></xdr:${tag}>`;
  if (placement === "cell") return '<xdr:twoCellAnchor editAs="twoCell">' + marker("from", row, column) +
    marker("to", row + 1, column + 1) + shape + "<xdr:clientData/></xdr:twoCellAnchor>";
  return "<xdr:oneCellAnchor>" + marker("from", row, column, offsetX, offsetY) +
    `<xdr:ext cx="${width * 9525}" cy="${height * 9525}"/>${shape}<xdr:clientData/></xdr:oneCellAnchor>`;
}

function chartReference(sheet, field, first, last, orientation) {
  const address = (point) => {
    const [row, column] = orientation === "rows" ? [field, point] : [point, field];
    return "$" + columnName(column) + "$" + (row + 1);
  };
  return "'" + sheet.name.replaceAll("'", "''") + "'!" + address(first) + (first === last ? "" : ":" + address(last));
}

function chartXmlTitle(title) {
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${xmlEscape(title)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>`;
}

function chartCache(tag, reference, values, numeric) {
  const type = numeric ? "num" : "str";
  const points = values.map((value, index) => value === null ? "" : `<c:pt idx="${index}"><c:v>${xmlEscape(value)}</c:v></c:pt>`).join("");
  return `<c:${tag}><c:${type}Ref><c:f>${xmlEscape(reference)}</c:f><c:${type}Cache>${numeric ? "<c:formatCode>General</c:formatCode>" : ""}` +
    `<c:ptCount val="${values.length}"/>${points}</c:${type}Cache></c:${type}Ref></c:${tag}>`;
}

function xlsxChartXml(engine, sheets, config) {
  const sheet = sheets.find(({ name }) => name === config.sourceSheet);
  const { categories, series } = chartData(engine, sheet, config);
  const { left, top, bottom, right } = config.source;
  const [category, start, end] = config.orientation === "rows" ? [top, left, right] : [left, top, bottom];
  const ref = (field, first, last = first) => chartReference(sheet, field, first, last, config.orientation);
  const scatter = config.type === "scatter" || config.type === "curve";
  const pie = config.type === "pie";
  const all = config.series || Array.from({ length: Math.min(3, series.length) }, (_, index) => index);
  const visible = pie ? [0] : all;
  const line = config.type === "line" || config.type === "smoothline";
  const smooth = config.type === "curve" || config.type === "smoothline";
  const column = config.type === "column";
  const axes = '<c:axId val="100"/><c:axId val="200"/>';
  const tag = scatter ? "scatterChart" : pie ? "pieChart" : column ? "barChart" : line ? "lineChart" : "areaChart";
  const options = scatter ? `<c:scatterStyle val="${smooth ? "smoothMarker" : "marker"}"/>` : pie ? '<c:varyColors val="1"/>' :
    column ? '<c:barDir val="col"/><c:grouping val="clustered"/>' : '<c:grouping val="standard"/>';
  const seriesXml = visible.map((index, order) => {
    const item = series[index];
    const x = chartCache(scatter ? "xVal" : "cat", ref(category, start + 1, end),
      categories.map((category) => scatter ? category.x : category.text), scatter);
    const y = chartCache(scatter ? "yVal" : "val", ref(item.field, start + 1, end), item.values, true);
    const trend = config.trendline?.series === index ? config.trendline : null;
    const trendXml = trend ? `<c:trendline><c:trendlineType val="${trend.type}"/>` +
      (trend.type === "poly" ? `<c:order val="${trend.order}"/>` : "") +
      '<c:dispRSqr val="1"/><c:dispEq val="1"/></c:trendline>' : "";
    return `<c:ser><c:idx val="${index}"/><c:order val="${order}"/>` +
      chartCache("tx", ref(item.field, start), [item.name], false) +
      (scatter ? '<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>' : "") + trendXml +
      x + y + (smooth ? '<c:smooth val="1"/>' : "") + "</c:ser>";
  }).join("");
  const axis = (axisTag, id, cross, position, title) => `<c:${axisTag}><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${position}"/>${position === "l" ? "<c:majorGridlines/>" : ""}` +
    (title ? chartXmlTitle(title) : "") + `<c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/></c:${axisTag}>`;
  return xmlHeader + `<c:chartSpace xmlns:c="${chartNamespace}" xmlns:a="${drawingMain}" xmlns:r="${officeRels}"><c:chart>` +
    chartXmlTitle(config.title) + `<c:plotArea><c:layout/><c:${tag}>${options}${seriesXml}${pie ? "" : axes}</c:${tag}>` +
    (pie ? "" : axis(scatter ? "valAx" : "catAx", 100, 200, "b", config.xTitle) +
      axis("valAx", 200, 100, "l", config.yTitle)) +
    '</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/>' +
    '<c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>';
}

async function writeXlsxDrawing(zip, engine, sheets, entry, snapshot) {
  const { sheet, id } = entry;
  const drawingPath = `drawings/drawing${id}.xml`;
  const relations = [];
  const anchors = [];
  const images = [...entry.drawingImages];
  const charts = entry.charts;
  const position = (object) => ({ ...object, ...objectSize(sheet, object),
    offsetX: object.placement === "cell" ? 0 : object.offsetX,
    offsetY: object.placement === "cell" ? 0 : object.offsetY });
  for (const object of charts) {
    if (!object.spatial || object.spatial.native) continue;
    const bitmap = await snapshot(object.chart);
    images.push({ ...position(object), data: bitmap.data, name: bitmap.name,
      description: object.spatial.marker + " " + object.chart.title });
  }
  for (const image of images) {
    const [, type, data] = imageDataPattern.exec(image.data);
    const relId = relations.length + 1;
    const path = `media/image${id}-${relId}.${type}`;
    await zip.add("xl/" + path, [Uint8Array.from(atob(data), (character) => character.charCodeAt(0))]);
    relations.push({ id: relId, type: "image", target: "../" + path });
    anchors.push(xlsxAnchor(position(image), xlsxDrawingImage(image, relId)));
  }
  let chartIndex = 0;
  for (const object of charts) {
    if (object.spatial && !object.spatial.native) continue;
    const chartPath = `charts/chart${id}-${++chartIndex}.xml`;
    await zip.add("xl/" + chartPath, [object.spatial
      ? xlsxSpatialChartXml(object.chart, object.spatial.native) : xlsxChartXml(engine, sheets, object.chart)]);
    const relId = relations.length + 1;
    relations.push({ id: relId, type: "chart", target: "../" + chartPath });
    anchors.push(xlsxAnchor(position(object), xlsxDrawingChart(relId, object.spatial
      ? object.spatial.marker + " " + object.chart.title : "")));
  }
  await zip.add("xl/" + drawingPath, [xmlHeader + `<xdr:wsDr xmlns:xdr="${drawingNamespace}" xmlns:a="${drawingMain}" xmlns:c="${chartNamespace}" xmlns:r="${officeRels}">` +
    anchors.join("") + "</xdr:wsDr>"]);
  await zip.add(relationshipPath("xl/" + drawingPath), [xmlRelationships(relations)]);
  return { id: 1, type: "drawing", target: "../" + drawingPath };
}

function drawingId(node, attribute = "id") {
  return node?.getAttributeNS(officeRels, attribute) ||
    Array.from(node?.attributes || []).find((item) => item.localName === attribute)?.value;
}

async function xlsxImageData(zip, path) {
  const type = /\.(png|jpe?g)$/i.exec(path || "")?.[1].toLowerCase();
  const entry = zip.entries.get(path);
  if (!type || !entry || entry.length > 2_900_000) return null;
  const bytes = await zip.bytes(path);
  let data = "";
  for (let index = 0; index < bytes.length; index += 8192) data += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return `data:image/${type === "png" ? "png" : "jpeg"};base64,${btoa(data)}`;
}

async function readXlsxDrawing(zip, engine, sheet, drawing, worksheetPath, spatial, sourceNames) {
  if (!drawing) return false;
  const relations = readRelationships(readXml(await zip.text(relationshipPath(worksheetPath))), worksheetPath);
  const part = relations.get(drawingId(drawing));
  if (part?.type !== "drawing") return true;
  const read = async (path) => readXml(await zip.text(path));
  const content = await read(part.path);
  const objects = readRelationships(await read(relationshipPath(part.path)), part.path);
  let skipped = false;
  for (const anchor of content.children) {
    const picture = child(anchor, "pic");
    const graphic = child(anchor, "graphicFrame");
    const from = child(anchor, "from");
    const row = Number(child(from, "row")?.textContent);
    const column = Number(child(from, "col")?.textContent);
    const extent = child(anchor, "ext");
    const to = child(anchor, "to");
    const oneCell = anchor.localName === "twoCellAnchor" && [null, "twoCell"].includes(anchor.getAttribute("editAs")) &&
      Number(child(to, "col")?.textContent) === column + 1 && Number(child(to, "row")?.textContent) === row + 1 &&
      [from, to].every((marker) => ["colOff", "rowOff"].every((key) => Number(child(marker, key)?.textContent) === 0));
    const size = oneCell ? objectSize(sheet, { row, column, placement: "cell" }) : null;
    const width = size?.width ?? (Number(extent?.getAttribute("cx")) / 9525 || (Number(child(to, "col")?.textContent) - column) * 105 || 220);
    const height = size?.height ?? (Number(extent?.getAttribute("cy")) / 9525 || (Number(child(to, "row")?.textContent) - row) * 24 || 130);
    const position = { row, column, width: clamp(Math.round(width), 12, 1600), height: clamp(Math.round(height), 12, 1600),
      placement: oneCell ? "cell" : "floating",
      offsetX: clamp(Math.round(Number(child(from, "colOff")?.textContent) / 9525 || 0), 0, 1600),
      offsetY: clamp(Math.round(Number(child(from, "rowOff")?.textContent) / 9525 || 0), 0, 1600) };
    const properties = child(child(picture || graphic, picture ? "nvPicPr" : "nvGraphicFramePr"), "cNvPr");
    const marker = properties?.getAttribute("descr")?.split(" ", 1)[0];
    const metadata = spatial.get(marker);
    const chartLink = child(child(child(graphic, "graphic"), "graphicData"), "chart");
    const chartPath = objects.get(drawingId(chartLink))?.path;
    if (metadata && chart3dTypes.has(metadata.chart?.type) && sourceNames.has(metadata.chart.sourceSheet)) {
      try {
        let config = metadata.chart;
        if (chartPath && metadata.native) {
          try { config = xlsxNativeSpatialEdits(metadata, await read(chartPath)); }
          catch { /* The original Grids&Tabs settings remain usable. */ }
        }
        const chart = validateChart(config, engine);
        const empty = metadata.chartSheet && !Array.from({ length: engine.columns }, (_, index) => index)
          .some((index) => engine.lastRow(sheet.id, index) >= 0);
        if (empty && !sheet.chart && !sheet.embeddedCharts?.length) sheet.chart = chart;
        else (sheet.embeddedCharts ??= []).push(validateEmbeddedChart({ ...position, chart }, engine));
        continue;
      } catch { /* Read the native drawing if the Grids&Tabs settings are unusable. */ }
    }
    if (graphic) {
      const isEmpty = content.children.length === 1 && !Array.from({ length: engine.columns }, (_, index) => index)
        .some((column) => engine.lastRow(sheet.id, column) >= 0);
      const config = chartPath && readXlsxChart(await read(chartPath), engine);
      if (config) {
        if (isEmpty && config.sourceSheet !== sheet.name && !sheet.chart && !sheet.embeddedCharts?.length) {
          sheet.chart = config;
        } else {
          (sheet.embeddedCharts ??= []).push(validateEmbeddedChart({ ...position, chart: config }, engine));
        }
        continue;
      }
      skipped = true;
    }
    if (!picture) continue;
    const blip = child(child(picture, "blipFill"), "blip");
    const imagePart = objects.get(drawingId(blip, "embed"));
    if (imagePart?.type !== "image" || !Number.isInteger(row) || !Number.isInteger(column) || row < 0 || row >= engine.rows ||
        column < 0 || column >= engine.columns) {
      skipped = true;
      continue;
    }
    const data = await xlsxImageData(zip, imagePart.path);
    if (!data) { skipped = true; continue; }
    const image = { ...position,
      name: (child(child(picture, "nvPicPr"), "cNvPr")?.getAttribute("name") || "Picture").slice(0, 180),
      data };
    (sheet.images ??= []).push(validateImage(image, engine));
  }
  return skipped;
}

function readXlsxChart(xml, engine) {
  const chart = child(xml, "chart");
  const plot = child(chart, "plotArea");
  const chartTags = { scatterChart: "scatter", pieChart: "pie", lineChart: "line", barChart: "column", areaChart: "area" };
  const group = Array.from(plot?.children || []).find((item) => Object.hasOwn(chartTags, item.localName));
  if (!group) return null;
  const series = children(group, "ser");
  const baseType = chartTags[group.localName];
  const val = (node, tag) => child(node, tag)?.getAttribute("val");
  const scatter = baseType === "scatter";
  const smooth = /^(smooth|smoothMarker)$/.test(val(group, "scatterStyle")) ||
    [group, ...series].some((item) => ["1", "true", ""].includes(val(item, "smooth")));
  const type = smooth && scatter ? "curve" : smooth && baseType === "line" ? "smoothline" : baseType;
  const reference = (node) => {
    const formula = Array.from(node?.getElementsByTagNameNS("*", "f") || [])[0]?.textContent;
    const match = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(formula || "");
    if (!match) return null;
    const ends = match[3].split(":").map((text) => parseAddress(text, engine.rows, engine.columns));
    if (ends.length > 2 || ends.some((end) => !end)) return null;
    return { name: (match[1] || match[2]).replaceAll("''", "'"), from: ends[0], to: ends.at(-1) };
  };
  const x = reference(child(series[0], scatter ? "xVal" : "cat"));
  const y = series.map((node) => reference(child(node, scatter ? "yVal" : "val")));
  if (!x || !y.length || y.some((ref) => !ref || ref.name !== x.name)) return null;
  const columnSeries = x.from.row > 0 && x.from.column === x.to.column && y.every((ref) =>
    ref.from.row === x.from.row && ref.to.row === x.to.row &&
    ref.from.column > x.from.column && ref.from.column === ref.to.column);
  const rowSeries = x.from.column > 0 && x.from.row === x.to.row && y.every((ref) =>
    ref.from.column === x.from.column && ref.to.column === x.to.column &&
    ref.from.row > x.from.row && ref.from.row === ref.to.row);
  if (!columnSeries && !rowSeries) return null;
  const text = (node) => Array.from(child(node, "title")?.getElementsByTagNameNS("*", "t") || [])
    .map((item) => item.textContent).join("").slice(0, 120);
  const axes = Array.from(plot.children).filter((node) => node.localName.endsWith("Ax"));
  const source = columnSeries
    ? { top: x.from.row - 1, bottom: x.to.row, left: x.from.column, right: Math.max(...y.map((item) => item.from.column)) }
    : { top: x.from.row, bottom: Math.max(...y.map((item) => item.from.row)), left: x.from.column - 1, right: x.to.column };
  const visible = y.map((item) => columnSeries ? item.from.column - source.left - 1 : item.from.row - source.top - 1);
  const trendIndex = series.findIndex((node) => child(node, "trendline"));
  const trend = trendIndex >= 0 ? child(series[trendIndex], "trendline") : null;
  try {
    return validateChart({ sourceSheet: x.name, source, type, title: text(chart), orientation: columnSeries ? "columns" : "rows",
      xTitle: text(axes.find((node) => child(node, "axPos")?.getAttribute("val") === "b")),
      yTitle: text(axes.find((node) => child(node, "axPos")?.getAttribute("val") === "l")),
      series: visible, trendline: trend ? { type: val(trend, "trendlineType"), order: Number(val(trend, "order") ?? 2),
        series: visible[trendIndex] } : undefined }, engine);
  } catch { return null; }
}
