const chartTypes = [["line", "Line"], ["smoothline", "Smooth line"], ["column", "Column"], ["scatter", "Scatter"],
  ["curve", "Smooth XY curve"], ["area", "Area"], ["pie", "Pie"],
  ["scatter3d", "3D scatter"], ["columns3d", "3D columns"], ["surface3d", "3D surface"]];
const chartColors = ["#2869b9", "#008577", "#d4642e", "#8757bd", "#bd486b", "#2b869d",
  "#697c2b", "#a36c28", "#3c58a7", "#765449", "#178b51", "#9c4290"];

function validateChart(config, engine) {
  const { sourceSheet, source, type, title, xTitle = "", yTitle = "", zTitle = "", axes, series,
    orientation = "columns", colorBy, colorPalette, trendline, contours, camera } = config || {};
  const { top, bottom, left, right } = source || {};
  if (!validSheetName(sourceSheet) || ![top, bottom, left, right].every(Number.isInteger) ||
      top < 0 || bottom <= top || bottom >= engine.rows || left < 0 || right <= left || right >= engine.columns ||
      !chartTypes.some(([id]) => id === type) || !["columns", "rows"].includes(orientation) ||
      ![title, xTitle, yTitle, zTitle].every((text) => typeof text === "string" && text.length <= 120)) {
    throw new Error("Select headers, labels or X values, and at least one data series.");
  }
  const [count, seriesCount] = orientation === "rows" ? [right - left, bottom - top] : [bottom - top, right - left];
  if (count > 5_000 || seriesCount > 12) {
    throw new Error("Select up to 5,000 data points per series and 12 series.");
  }
  if (chart3dTypes.has(type) && seriesCount < 2) throw new Error("Select at least three numeric fields for a 3D chart.");
  const fieldIndices = (selection, last) => Array.isArray(selection) && new Set(selection).size === selection.length &&
    selection.every((field) => Number.isInteger(field) && field >= 0 && field <= last);
  const trendType = trendline?.type;
  const validTrend = trendlineCharts.has(type) && trendType && trendlineTypes.some(([id]) => id === trendType) &&
    fieldIndices([trendline.series], seriesCount - 1) &&
    (trendType !== "poly" || (Number.isInteger(trendline.order) && trendline.order >= 2 && trendline.order <= 6));
  const contourLevels = type === "surface3d" && Array.isArray(contours) && contours.length <= 30 && contours.every(Number.isFinite)
    ? [...new Set(contours)].sort((a, b) => a - b) : undefined;
  const cameraState = chart3dTypes.has(type) && camera &&
    [camera.yaw, camera.pitch, camera.zoom, camera.panX, camera.panY].every(Number.isFinite)
    ? { yaw: camera.yaw % (2 * Math.PI), pitch: clamp(camera.pitch, -1.35, 1.35), zoom: clamp(camera.zoom, 0.6, 4),
      panX: clamp(camera.panX, -2, 2), panY: clamp(camera.panY, -2, 2) } : undefined;
  return { sourceSheet, source: { top, bottom, left, right }, type, title: title.trim() || "Chart", xTitle, yTitle, zTitle,
    orientation, axes: fieldIndices(axes, seriesCount) && axes.length === 3 ? axes : undefined,
    series: fieldIndices(series, seriesCount - 1) ? series : undefined,
    colorBy: Number.isInteger(colorBy) && colorBy >= -1 && colorBy <= seriesCount ? colorBy : undefined,
    colorPalette: chartPaletteNames.has(colorPalette) ? colorPalette : undefined,
    contours: type === "surface3d" && contours === "auto" ? "auto" : contourLevels,
    camera: cameraState,
    trendline: validTrend ? { type: trendType, series: trendline.series, order: trendType === "poly" ? trendline.order : undefined } : undefined };
}

function validateEmbeddedChart(object, engine) {
  const { row, column, width, height } = object || {};
  if (![row, column, width, height].every(Number.isInteger) ||
      row < 0 || row >= engine.rows || column < 0 || column >= engine.columns ||
      width < 12 || width > 1600 || height < 12 || height > 1600 || !validObjectPlacement(object)) {
    throw new Error("The chart position or size is invalid.");
  }
  return { ...object, chart: validateChart(object.chart, engine) };
}

function colorFieldOptions(names, type) {
  return [["", type === "surface3d" ? "Vertical axis (default)" : "Single color (default)"],
    ...(type === "surface3d" ? [[-1, "Single color"]] : []),
    ...names.map((name, index) => [index, name])];
}

function chartPaletteGradient(interpolate) {
  const stops = Array.from({ length: 17 }, (_, index) => interpolate(index / 16));
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function paletteOptions(input, selected = "Viridis") {
  input.classList.add("chart-palette");
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.append(document.createElement("selectedcontent"));
  input.append(trigger);
  for (const [label, names] of chartPaletteGroups) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const name of names) {
      const label = name === "CubehelixDefault" ? "Cubehelix" : name;
      const option = new Option("", name);
      option.title = label;
      const gradient = document.createElement("span");
      gradient.className = "chart-palette-gradient";
      gradient.style.background = chartPaletteGradient(GridlineThree.ChartPalettes["interpolate" + name]);
      gradient.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "chart-palette-name";
      text.textContent = label;
      option.append(gradient, text);
      group.append(option);
    }
    input.append(group);
  }
  input.value = selected;
  const updateTitle = () => { input.title = input.selectedOptions[0]?.title || "Color palette"; };
  input.addEventListener("change", updateTitle);
  updateTitle();
}

function chartSettings(settings, config, { sheet, bounds }, engine) {
  settings.replaceChildren();
  const type = formField(settings, "Chart type", "select");
  optionsFor(type, chartTypes);
  type.value = config.type || "line";
  const orientation = formField(settings, "Data series in", "select");
  optionsFor(orientation, [["columns", "Columns"], ["rows", "Rows"]]);
  orientation.value = config.orientation || "columns";
  const title = formField(settings, "Chart title");
  const xTitle = formField(settings, "Horizontal axis title");
  const yTitle = formField(settings, "Vertical axis title");
  const zTitle = formField(settings, "Depth axis title");
  const colorBy = formField(settings, "Color by", "select");
  const palette = formField(settings, "Color palette", "select");
  const contourMode = formField(settings, "Contour lines", "select");
  optionsFor(contourMode, [["", "Off"], ["auto", "Automatic"], ["custom", "Custom levels"]]);
  contourMode.value = Array.isArray(config.contours) ? "custom" : config.contours || "";
  const contourInput = formField(settings, "Contour levels (Y axis)");
  contourInput.placeholder = "10, 20, 30";
  contourInput.value = Array.isArray(config.contours) ? config.contours.join(", ") : "";
  const trendType = formField(settings, "Trendline", "select");
  optionsFor(trendType, trendlineTypes);
  trendType.value = config.trendline?.type || "";
  const trendSeries = formField(settings, "Trendline series", "select");
  const trendOrder = formField(settings, "Polynomial degree");
  trendOrder.type = "number";
  trendOrder.min = 2;
  trendOrder.max = 6;
  trendOrder.value = config.trendline?.order || 2;
  paletteOptions(palette, config.colorPalette);
  const placement = formField(settings, "Placement", "select");
  optionsFor(placement, config.fixedSheet ? [["sheet", "Chart worksheet"]] :
    [["floating", "Float over cells"], ["cell", "Place in cell"], ...(!config.fixedObject ? [["sheet", "New chart worksheet"]] : [])]);
  placement.value = config.placement || "floating";
  const anchor = formField(settings, "Anchor cell");
  anchor.value = config.anchor || "";
  const showAnchor = () => { anchor.parentElement.hidden = placement.value === "sheet"; };
  placement.addEventListener("change", showAnchor);
  showAnchor();
  for (const [input, value] of [[title, config.title || "Chart"],
    [xTitle, config.xTitle], [yTitle, config.yTitle], [zTitle, config.zTitle]]) {
    input.value = value || "";
    input.maxLength = 120;
  }
  const showOptions = () => {
    const spatial = chart3dTypes.has(type.value);
    for (const input of [zTitle, colorBy, palette]) input.parentElement.hidden = !spatial;
    contourMode.parentElement.hidden = type.value !== "surface3d";
    contourInput.parentElement.hidden = type.value !== "surface3d" || contourMode.value !== "custom";
    palette.disabled = !spatial || colorBy.value === "-1" || (colorBy.value === "" && type.value !== "surface3d");
    const trendAvailable = trendlineCharts.has(type.value);
    trendType.parentElement.hidden = !trendAvailable;
    trendSeries.parentElement.hidden = !trendAvailable || !trendType.value;
    trendOrder.parentElement.hidden = !trendAvailable || trendType.value !== "poly";
    trendOrder.disabled = trendOrder.parentElement.hidden;
  };
  const updateFields = (selectedColor, selectedSeries) => {
    const { top, bottom, left, right } = bounds;
    const transposed = orientation.value === "rows";
    const count = Math.min(13, transposed ? bottom - top + 1 : right - left + 1);
    const names = Array.from({ length: count }, (_, index) => {
      const row = top + (transposed ? index : 0), column = left + (transposed ? 0 : index);
      return engine.value(sheet.id, row, column).text.trim() || cellName(row, column);
    });
    optionsFor(colorBy, colorFieldOptions(names, type.value));
    colorBy.value = selectedColor ?? "";
    if (colorBy.selectedIndex < 0) colorBy.value = "";
    optionsFor(trendSeries, names.slice(1).map((name, index) => [index, name]));
    trendSeries.value = selectedSeries ?? "0";
    if (trendSeries.selectedIndex < 0) trendSeries.value = "0";
    showOptions();
  };
  type.addEventListener("change", () => updateFields(colorBy.value, trendSeries.value));
  orientation.addEventListener("change", () => updateFields("", "0"));
  colorBy.addEventListener("change", showOptions);
  contourMode.addEventListener("change", showOptions);
  trendType.addEventListener("change", showOptions);
  updateFields(config.colorBy, config.trendline?.series ?? config.series?.[0]);
  return () => ({ type: type.value, title: title.value, xTitle: xTitle.value, yTitle: yTitle.value,
    zTitle: zTitle.value, orientation: orientation.value,
    axes: orientation.value === (config.orientation || "columns") ? config.axes : undefined,
    series: orientation.value === (config.orientation || "columns") ? config.series : undefined,
    colorBy: colorBy.value === "" ? undefined : Number(colorBy.value), colorPalette: palette.value, placement: placement.value,
    contours: type.value === "surface3d" ? readContourLevels(contourMode.value, contourInput.value) : undefined,
    trendline: trendType.value && trendlineCharts.has(type.value)
      ? { type: trendType.value, series: Number(trendSeries.value), order: Number(trendOrder.value) } : undefined,
    anchor: anchor.value, fixedSheet: config.fixedSheet, fixedObject: config.fixedObject });
}

function readContourLevels(mode, text) {
  if (mode !== "custom") return mode === "auto" ? "auto" : undefined;
  const entries = text.split(",").map((entry) => entry.trim());
  if (entries.length > 30 || entries.some((entry) =>
    !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(entry) || !Number.isFinite(Number(entry)))) {
    throw new Error("Enter 1–30 numeric contour levels separated by commas.");
  }
  return entries.map(Number);
}

function showChartForm(app, target = null, table = null) {
  const sheets = app.sheets.filter((sheet) => !sheet.pivot && !sheet.chart);
  const source = app.sheet.pivot || app.sheet.chart ? sheets[0] : app.sheet;
  if (!source) throw new Error("Add a data worksheet first.");
  const embedded = Boolean(target && Object.hasOwn(target, "row"));
  const suggested = table ?? (source === app.sheet && !target?.chart
    ? reportSource(app) : { top: 0, bottom: 1, left: 0, right: 1 });
  const anchor = cellName(suggested.top, Math.min(app.engine.columns - 1, suggested.right + 1));
  const config = target?.chart ? { ...target.chart, fixedObject: embedded, fixedSheet: !embedded,
    placement: embedded ? target.placement || "floating" : "sheet",
    anchor: embedded ? cellName(target.row, target.column) : anchor } : {
    sourceSheet: source.name,
    source: suggested,
    orientation: table?.axis === "row" ? "rows" : "columns",
    placement: app.sheet.chart ? "sheet" : "floating",
    fixedSheet: Boolean(app.sheet.chart),
    anchor
  };
  let checked;
  const checkChart = (settings) => {
    const chart = validateChart(settings, app.engine);
    if (settings.trendline && !chart.trendline) throw new Error("Choose a polynomial degree from 2 to 6.");
    if (chart.trendline) {
      const { top, bottom, left, right } = chart.source;
      const count = chart.orientation === "rows" ? bottom - top : right - left;
      const visible = chart.series ?? Array.from({ length: Math.min(3, count) }, (_, index) => index);
      if (!visible.includes(chart.trendline.series)) chart.series = [...visible, chart.trendline.series];
    }
    const position = settings.placement === "sheet" ? null : parseAddress(settings.anchor, app.engine.rows, app.engine.columns);
    if (!position && settings.placement !== "sheet") throw new Error("Enter a valid anchor cell.");
    const sourceKey = JSON.stringify([chart.sourceSheet, chart.source, chart.orientation]);
    const geometryKey = JSON.stringify([chart.type, chart.axes, chart.colorBy, chart.colorPalette, chart.trendline, chart.contours]);
    if (checked?.sourceKey !== sourceKey || checked?.geometryKey !== geometryKey) {
      const data = checked?.sourceKey === sourceKey ? checked.data
        : chartData(app.engine, sheets.find(({ name }) => name === chart.sourceSheet), chart);
      if (chart3dTypes.has(chart.type)) chart3dGeometry(data, chart);
      else {
        const marks = chartLayout(data, chart, 720, 420, new Set());
        if (marks.trend?.error) throw new Error(marks.trend.error);
      }
      checked = { sourceKey, geometryKey, data };
    }
    return { chart, position, data: checked.data };
  };
  const editing = Boolean(target?.chart);
  const body = reportForm(app, editing ? "Edit chart" : "Create chart", sheets, config,
    (settings, _, config, source) => chartSettings(settings, config, source, app.engine), (settings) => {
    const { chart, position } = checkChart(settings);
    if (chart3dTypes.has(chart.type) && app.chartView.preview?.camera) chart.camera = app.chartView.preview.camera;
    if (settings.placement === "sheet") {
      const sheet = target || app.addSheet(app.unusedSheetName("Chart"));
      sheet.chart = chart;
      app.dirty = true;
    } else {
      const object = validateEmbeddedChart({ ...target, ...position, width: target?.width ?? 640,
        height: target?.height ?? 390, placement: settings.placement, chart }, app.engine);
      if (embedded) {
        const wasOpen = app.openedChart === target;
        app.selectObject(target);
        app.replaceObject(object);
        if (wasOpen) app.openedChart = object;
      } else app.addObject(object);
      if (!app.openedChart) app.view.reveal(position.row, position.column);
    }
    app.dialog.close();
    app.refresh();
    app.status("Chart updated");
    if (!editing) {
      if (app.sheet.chart) document.querySelector('#chart-view [data-action="chart-edit"]').focus();
      else app.canvas.focus();
    }
  }, () => [], editing ? (settings) => {
    const { chart, data } = checkChart(settings);
    app.chartView.preview = { chart, data, camera: app.chartView.preview?.camera };
    app.chartView.refresh();
  } : undefined);
  if (editing) {
    const view = app.chartView;
    const viewport = view.element.parentElement;
    app.dialog.classList.add("chart-editor");
    body.prepend(view.element);
    view.preview = { chart: target.chart, camera: target.chart.camera };
    view.refresh();
    app.dialog.addEventListener("close", () => {
      viewport.append(view.element);
      app.dialog.classList.remove("chart-editor");
      view.preview = null;
      view.refresh();
      if (app.sheet.chart || app.openedChart) view.element.querySelector('[data-action="chart-edit"]').focus();
      else app.canvas.focus();
    }, { once: true });
  }
}

function chartData(engine, sheet, config) {
  const { top, bottom, left, right } = config.source;
  const transposed = config.orientation === "rows";
  const [firstField, lastField, firstPoint, lastPoint] = transposed ? [top, bottom, left, right] : [left, right, top, bottom];
  const cell = (field, point) => transposed ? { row: field, column: point } : { row: point, column: field };
  const read = ({ row, column }) => engine.value(sheet.id, row, column);
  const names = new Set();
  const fieldName = (field) => {
    const position = cell(field, firstPoint);
    const name = read(position).text.trim();
    if (field === firstField && !name) return "Category";
    if (!name) throw new Error(`Enter a series header in ${cellName(position.row, position.column)}.`);
    const key = name.toUpperCase();
    if (names.has(key)) throw new Error(`The header "${name}" appears more than once.`);
    names.add(key);
    return name;
  };
  const xName = fieldName(firstField);
  const series = [];
  for (let field = firstField + 1; field <= lastField; field++) {
    series.push({ field, name: fieldName(field), values: [] });
  }
  const categories = [];
  for (let point = firstPoint + 1; point <= lastPoint; point++) {
    const { row, column } = cell(firstField, point);
    const label = read({ row, column });
    categories.push({
      text: cellDisplay(label, sheet.styles.get(cellKey(row, column, engine.columns))) || String(point - firstPoint),
      x: label.kind === ValueKind.number ? label.number : null
    });
    for (const item of series) {
      const value = read(cell(item.field, point));
      item.values.push(value.kind === ValueKind.number ? value.number : null);
    }
  }
  return { categories, series, xName };
}

function chartTicks(low, high) {
  if (low === high) {
    const pad = Math.abs(low) * 0.1 || 1;
    low -= pad;
    high += pad;
  }
  const rough = (high - low) / 5;
  if (!Number.isFinite(rough) || rough <= 0) return { low, high, values: low === high ? [low] : [low, high] };
  const unit = 10 ** Math.floor(Math.log10(rough));
  if (!unit) return { low, high, values: [low, high] };
  const step = ([1, 2, 2.5, 5, 10].find((value) => value >= rough / unit) || 10) * unit;
  const start = Math.floor(low / step);
  const end = Math.ceil(high / step);
  if (!Number.isFinite(start * step) || !Number.isFinite(end * step)) return { low, high, values: [low, high] };
  return { low: start * step, high: end * step,
    values: Array.from({ length: end - start + 1 }, (_, index) => (start + index) * step) };
}

function chartRatio(value, { low, high }) {
  if (low === high) return 0.5;
  return Number.isFinite(high - low) ? (value - low) / (high - low)
    : (value / 2 - low / 2) / (high / 2 - low / 2);
}

const chartFormatter = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 });
const chartScientific = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6, notation: "scientific" });
function chartNumber(value) {
  return (Math.abs(value) >= 100_000_000 || (value && Math.abs(value) < 0.001)
    ? chartScientific : chartFormatter).format(value);
}

function trendlineLabel({ name, equation, rSquared, error }) {
  return error ? `${name}: ${error}` : `${name} · ${equation} · R² = ${rSquared.toFixed(4)}`;
}

class ChartMarks {
  constructor() {
    this.layers = new Map();
    this.hits = [];
    this.labels = [];
    this.lines = [];
  }

  triangle(color, a, b, c) {
    if (!this.layers.has(color)) this.layers.set(color, []);
    this.layers.get(color).push(...a, ...b, ...c);
  }

  quad(color, a, b, c, d) {
    this.triangle(color, a, b, c);
    this.triangle(color, a, c, d);
  }

  segment(color, a, b, width = 2.5) {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const length = Math.hypot(dx, dy);
    if (!length) return;
    const [ox, oy] = [-width * dy / (2 * length), width * dx / (2 * length)];
    this.quad(color, [a[0] + ox, a[1] + oy], [b[0] + ox, b[1] + oy],
      [b[0] - ox, b[1] - oy], [a[0] - ox, a[1] - oy]);
  }

  wedge(color, x, y, radius, start, end, steps = Math.max(1, Math.ceil((end - start) * 20))) {
    const point = (angle) => [x + radius * Math.cos(angle), y + radius * Math.sin(angle)];
    let previous = point(start);
    for (let index = 1; index <= steps; index++) {
      const next = point(start + (end - start) * index / steps);
      this.triangle(color, [x, y], previous, next);
      previous = next;
    }
  }
}

function chartLayout({ categories, series }, config, width, height, hidden) {
  const marks = new ChartMarks();
  if (config.type === "pie") {
    const slices = series[0].values.map((value, index) => ({ value, index, name: categories[index].text }))
      .filter(({ value }) => value > 0);
    if (!slices.length || slices.length > 20) throw new Error("Pie charts need 1–20 positive values in the first series.");
    const shown = slices.filter(({ index }) => !hidden.has(index));
    const total = shown.reduce((sum, { value }) => sum + value, 0);
    const [x, y] = [width / 2, height / 2];
    const radius = Math.max(4, Math.min(width, height) / 2 - 18);
    let start = -Math.PI / 2;
    for (const { value, index, name } of shown) {
      const share = value / total;
      const end = start + 2 * Math.PI * share;
      const gap = shown.length === 1 ? 0 : Math.min(0.012, (end - start) * 0.15);
      marks.wedge(chartColors[index % chartColors.length], x, y, radius, start + gap, end - gap);
      if (share >= 0.09 && radius >= 60) {
        const angle = (start + end) / 2;
        marks.labels.push({ text: `${Math.round(100 * share)}%`, x: x + Math.cos(angle) * radius * 0.67,
          y: y + Math.sin(angle) * radius * 0.67 + 4, slice: true });
      }
      marks.hits.push({ x, y, radius, start, end, text: `${name}\n${chartNumber(value)} · ${(100 * share).toFixed(1)}%` });
      start = end;
    }
    marks.legend = slices;
    return marks;
  }

  const active = series.map((item, index) => ({ ...item, index })).filter(({ index }) => !hidden.has(index));
  const numericX = config.type === "scatter" || config.type === "curve";
  const smooth = config.type === "smoothline" || config.type === "curve";
  const data = active.flatMap(({ values }) => values.filter((value, index) => value !== null && (!numericX || categories[index].x !== null)));
  if (!data.length && !hidden.size) throw new Error(numericX
    ? "A scatter chart needs numeric X and Y values on the same rows." : "The value columns contain no numbers.");
  let trendPoints = [];
  if (config.trendline && !hidden.has(config.trendline.series)) {
    const { name, values } = series[config.trendline.series];
    const samples = values.map((y, index) => [numericX ? categories[index].x : index + 1, y])
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    try {
      const { equation, rSquared, predict } = estimateTrendline(samples, config.trendline);
      marks.trend = { name, equation, rSquared };
      const xValues = samples.map(([x]) => x);
      const first = Math.min(...xValues), last = Math.max(...xValues);
      trendPoints = Array.from({ length: 129 }, (_, i) => {
        const x = first * (1 - i / 128) + last * (i / 128);
        return [x, predict(x)];
      }).filter(([, y]) => Number.isFinite(y));
    } catch (error) { marks.trend = { name, error: error.message }; }
  }
  const axisAtZero = config.type === "column" || config.type === "area";
  const low = data.length ? Math.min(...data, ...trendPoints.map(([, y]) => y)) : 0;
  const high = data.length ? Math.max(...data, ...trendPoints.map(([, y]) => y)) : 1;
  const yTicks = chartTicks(axisAtZero ? Math.min(0, low) : low, axisAtZero ? Math.max(0, high) : high);
  const xNumbers = categories.map(({ x }) => x).filter((x) => x !== null);
  const xTicks = numericX ? chartTicks(xNumbers.length ? Math.min(...xNumbers) : 0, xNumbers.length ? Math.max(...xNumbers) : 1) : null;
  const labelWidth = Math.max(...yTicks.values.map((value) => chartNumber(value).length)) * 7;
  const left = Math.max(46, labelWidth + (config.yTitle ? 37 : 16));
  const right = Math.max(left + 1, width - 24);
  const top = 18;
  const bottom = Math.max(top + 1, height - (config.xTitle ? 58 : 34));
  const yPosition = (value) => bottom - chartRatio(value, yTicks) * (bottom - top);
  const slot = (right - left) / categories.length;
  const xPosition = (index) => numericX
    ? left + chartRatio(categories[index].x, xTicks) * (right - left)
    : left + (index + 0.5) * slot;
  marks.quad("#f4f7fb", [left, top], [right, top], [right, bottom], [left, bottom]);
  for (const value of yTicks.values) {
    const y = yPosition(value);
    marks.segment(value === 0 ? "#aab9ca" : "#dce5ef", [left, y], [right, y], 1);
    marks.labels.push({ text: chartNumber(value), x: left - 8, y: y + 4, align: "end" });
  }
  if (numericX) {
    const step = Math.max(1, Math.ceil(xTicks.values.length * 60 / (right - left)));
    for (const [index, value] of xTicks.values.entries()) {
      if (index % step) continue;
      const x = left + chartRatio(value, xTicks) * (right - left);
      marks.segment("#dce5ef", [x, top], [x, bottom], 1);
      marks.labels.push({ text: chartNumber(value), x, y: bottom + 17 });
    }
  } else {
    const gap = Math.max(1, Math.ceil(95 / slot));
    for (let index = 0; index < categories.length; index += gap) {
      const text = categories[index].text;
      marks.labels.push({ text: text.length > 14 ? text.slice(0, 13) + "…" : text,
        x: xPosition(index), y: bottom + 17 });
    }
  }
  marks.segment("#aab9ca", [left, top], [left, bottom], 1);
  marks.segment("#aab9ca", [left, bottom], [right, bottom], 1);
  if (config.xTitle) marks.labels.push({ text: config.xTitle, x: (left + right) / 2, y: height - 9, title: true });
  if (config.yTitle) marks.labels.push({ text: config.yTitle, x: 13, y: (top + bottom) / 2, rotate: true, title: true });
  const baseline = yPosition(0);
  if (config.type === "area") {
    for (const { values, index } of active) {
      const fill = chartColors[index] + "32";
      for (let row = 1; row < values.length; row++) {
        if (values[row - 1] === null || values[row] === null) continue;
        const a = xPosition(row - 1), b = xPosition(row);
        const y0 = yPosition(values[row - 1]), y1 = yPosition(values[row]);
        if ((y0 - baseline) * (y1 - baseline) < 0) {
          const cut = a + (b - a) * (baseline - y0) / (y1 - y0);
          marks.triangle(fill, [a, baseline], [a, y0], [cut, baseline]);
          marks.triangle(fill, [cut, baseline], [b, y1], [b, baseline]);
        } else marks.quad(fill, [a, baseline], [a, y0], [b, y1], [b, baseline]);
      }
    }
  }
  const markerCenters = [];
  for (const [seriesIndex, { values, name, index }] of active.entries()) {
    const color = chartColors[index];
    const barSlot = Math.min(80, slot * 0.79 / active.length);
    const barWidth = barSlot * (active.length === 1 ? 1 : 0.91);
    let previous;
    let curve = [];
    const drawCurve = () => {
      if (numericX) curve.sort((a, b) => a[0] - b[0]);
      smoothChartLine(marks, color, curve);
      curve = [];
    };
    for (const [row, value] of values.entries()) {
      if (value === null || (numericX && categories[row].x === null)) {
        if (smooth) drawCurve();
        previous = null;
        continue;
      }
      const x = xPosition(row);
      const y = yPosition(value);
      if (config.type === "column") {
        const start = x + (seriesIndex - active.length / 2) * barSlot + (barSlot - barWidth) / 2;
        marks.quad(color, [start, baseline], [start, y], [start + barWidth, y], [start + barWidth, baseline]);
        marks.hits.push({ x: start + barWidth / 2, y, baseline, width: barWidth,
          text: `${categories[row].text}\n${name} · ${chartNumber(value)}` });
      } else {
        if (smooth) curve.push([x, y]);
        else if (!numericX && previous) marks.segment(color, previous, [x, y]);
        if (numericX) marks.wedge(color + "d9", x, y, values.length > 800 ? 2.4 : 3.6, 0, Math.PI * 2, 10);
        else if (values.length <= 36) {
          marks.wedge(color, x, y, 3.6, 0, Math.PI * 2, 12);
          markerCenters.push([x, y]);
        }
        marks.hits.push({ x, y, text: `${categories[row].text}\n${name} · ${chartNumber(value)}` });
      }
      previous = [x, y];
    }
    if (smooth) drawCurve();
  }
  for (const [x, y] of markerCenters) marks.wedge("#ffffff", x, y, 1.55, 0, Math.PI * 2, 10);
  let last;
  for (const [x, y] of trendPoints) {
    const next = [numericX ? left + chartRatio(x, xTicks) * (right - left) : left + (x - 0.5) * slot, yPosition(y)];
    if (last && Math.floor(next[0] / 7) % 2 === 0) marks.segment("#253951", last, next, 1.8);
    last = next;
  }
  marks.legend = series.map(({ name }, index) => ({ name, index }));
  return marks;
}

class ChartView {
  constructor(app) {
    this.app = app;
    this.element = document.getElementById("chart-view");
    this.workspace = this.element.closest(".workspace");
    this.canvas = document.getElementById("chart-marks");
    this.plot = document.getElementById("chart-plot");
    this.labels = document.getElementById("chart-labels");
    this.legend = document.getElementById("chart-legend");
    this.controls = document.getElementById("chart-controls");
    this.equation = document.getElementById("chart-equation");
    this.tooltip = document.getElementById("chart-tooltip");
    this.message = document.getElementById("chart-message");
    this.hidden = new Set();
    this.threeD = new Chart3D(this);
    this.plot.addEventListener("pointermove", (event) => {
      const start = this.pickStart;
      if (start && Math.hypot(start.x - event.clientX, start.y - event.clientY) > 4) start.dragged = true;
      this.showTooltip(event);
    });
    this.plot.addEventListener("pointerleave", () => { if (!this.pinnedTooltip) this.tooltip.hidden = true; });
    this.plot.addEventListener("pointerdown", (event) => {
      this.pickStart = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    });
    this.plot.addEventListener("click", (event) => {
      const start = this.pickStart;
      this.pickStart = null;
      if (start && (start.dragged || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 4)) return;
      this.showTooltip(event, true);
    });
    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.pinnedTooltip) return;
      event.preventDefault();
      this.clearTooltip();
    });
    this.element.addEventListener("contextmenu", (event) => {
      if (app.dialog.open) return;
      event.preventDefault();
      void app.runAction("chart-edit");
    });
    new ResizeObserver(() => this.schedule()).observe(this.plot);
  }

  refresh() {
    this.clearTooltip();
    const config = this.preview?.chart || this.app.openedChart?.chart || this.app.sheet.chart;
    document.getElementById("chart-back").hidden = !this.app.openedChart;
    this.element.hidden = !config;
    this.workspace.classList.toggle("chart-worksheet", Boolean(config));
    if (!config) {
      this.app.formula.disabled = Boolean(this.app.sheet.pivot);
      this.app.nameBox.disabled = false;
      return;
    }
    this.app.formula.disabled = true;
    this.app.nameBox.disabled = true;
    const changed = this.config !== config;
    const resetView = !this.preview?.data || this.preview.data !== this.data || this.config?.type !== config.type;
    this.config = config;
    const spatial = chart3dTypes.has(config.type);
    this.canvas.classList.toggle("chart-spatial", spatial);
    this.canvas.tabIndex = spatial ? 0 : -1;
    document.getElementById("chart-title").textContent = config.title;
    document.getElementById("chart-source").textContent = `${config.sourceSheet} · ${rangeAddress(config.source)}`;
    const source = this.app.sheets.find(({ name }) => name === config.sourceSheet);
    this.data = null;
    this.error = "";
    try {
      if (!source) throw new Error("The source worksheet is unavailable.");
      this.data = this.preview?.data ?? chartData(this.app.engine, source, config);
    } catch (error) { this.error = error.message; }
    if (changed) {
      this.hidden.clear();
      if (config.type !== "pie") {
        const selected = config.series || Array.from({ length: Math.min(3, this.data?.series.length || 0) }, (_, index) => index);
        this.data?.series.forEach((_, index) => { if (!selected.includes(index)) this.hidden.add(index); });
      }
      if (resetView) this.threeD.setCamera(this.preview?.camera ?? config.camera);
    }
    this.buildControls();
    this.schedule();
  }

  cameraChanged(camera) {
    if (this.preview) this.preview.camera = camera;
    else if (chart3dTypes.has(this.config?.type)) {
      this.config.camera = camera;
      if (!this.app.dirty) {
        this.app.dirty = true;
        document.getElementById("workbook-title").textContent = this.app.title + " •";
      }
    }
    this.clearTooltip();
  }

  buildControls() {
    this.controls.replaceChildren();
    if (!this.data) return;
    if (chart3dTypes.has(this.config.type)) {
      const names = [this.data.xName, ...this.data.series.map(({ name }) => name)];
      const selected = this.config.axes || [0, 1, 2];
      for (const [axis, name] of ["X axis", "Y axis", "Z axis"].entries()) {
        const select = formField(this.controls, name, "select");
        optionsFor(select, names.map((field, index) => [index, field]));
        select.value = selected[axis];
        select.addEventListener("change", () => {
          const axes = [...(this.config.axes || [0, 1, 2])];
          const value = Number(select.value);
          const formerAxis = axes.indexOf(value);
          if (formerAxis >= 0) axes[formerAxis] = axes[axis];
          axes[axis] = value;
          this.config.axes = axes;
          this.clearTooltip();
          this.markEdited();
          this.buildControls();
          this.controls.querySelectorAll("select")[axis]?.focus();
          this.schedule();
        });
      }
      if (!this.preview) {
        const color = formField(this.controls, "Color by", "select");
        optionsFor(color, colorFieldOptions(names, this.config.type));
        color.value = this.config.colorBy ?? "";
        const palette = formField(this.controls, "Color palette", "select");
        paletteOptions(palette, this.config.colorPalette);
        const update = () => {
          palette.disabled = color.value === "-1" || (color.value === "" && this.config.type !== "surface3d");
        };
        update();
        color.addEventListener("change", () => {
          this.config.colorBy = color.value === "" ? undefined : Number(color.value);
          this.clearTooltip();
          update();
          this.markEdited();
          this.schedule();
        });
        palette.addEventListener("change", () => {
          this.config.colorPalette = palette.value;
          this.clearTooltip();
          this.markEdited();
          this.schedule();
        });
      }
      for (const [label, action] of [["Zoom in", () => this.threeD.changeZoom(1.25)],
        ["Zoom out", () => this.threeD.changeZoom(0.8)], ["Reset view", () => this.threeD.reset()]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", action);
        this.controls.append(button);
      }
      const hint = document.createElement("span");
      hint.textContent = "Drag to rotate · Shift+drag to pan · Scroll to zoom";
      this.controls.append(hint);
    } else if (this.config.type !== "pie" && this.data.series.length > 1) {
      const dropdown = document.createElement("details");
      dropdown.className = "series-dropdown";
      const summary = document.createElement("summary");
      summary.textContent = "Series";
      const options = document.createElement("div");
      for (const [index, { name }] of this.data.series.entries()) {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.seriesIndex = index;
        checkbox.checked = !this.hidden.has(index);
        checkbox.addEventListener("change", () => this.toggleSeries(index));
        label.append(checkbox, name);
        options.append(label);
      }
      dropdown.append(summary, options);
      this.controls.append(dropdown);
    }
  }

  markEdited() {
    this.app.dirty = true;
    this.app.contentRevision++;
    document.getElementById("workbook-title").textContent = this.app.title + " •";
  }

  toggleSeries(index) {
    this.clearTooltip();
    if (!this.hidden.delete(index)) this.hidden.add(index);
    if (this.config.type !== "pie") {
      this.config.series = this.data.series.map((_, index) => index).filter((index) => !this.hidden.has(index));
      this.markEdited();
    }
    const checkbox = this.controls.querySelector(`[data-series-index="${index}"]`);
    if (checkbox) checkbox.checked = !this.hidden.has(index);
    this.schedule();
  }

  schedule() {
    if (this.element.hidden || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.element.hidden) this.render();
    });
  }

  render() {
    const width = this.plot.clientWidth, height = this.plot.clientHeight;
    if (width < 4 || height < 4) return;
    if (!this.pinnedTooltip) this.tooltip.hidden = true;
    try {
      if (!this.data) throw new Error(this.error);
      if (chart3dTypes.has(this.config.type)) {
        this.hits = [];
        this.equation.hidden = true;
        this.threeD.render(this.data, this.config, width, height);
        this.renderSpatialLegend();
      } else {
        const marks = chartLayout(this.data, this.config, width, height, this.hidden);
        this.renderMarks(marks, width, height);
        this.renderLabels(marks, width, height);
        this.renderLegend(marks.legend);
        this.equation.hidden = !marks.trend;
        this.equation.textContent = marks.trend ? trendlineLabel(marks.trend) : "";
        this.hits = marks.hits;
      }
      this.message.hidden = true;
      this.canvas.style.visibility = "";
    } catch (error) {
      this.hits = [];
      this.canvas.style.visibility = "hidden";
      this.labels.replaceChildren();
      this.legend.replaceChildren();
      delete this.legend.dataset.spatial;
      this.equation.hidden = true;
      this.clearTooltip();
      this.message.textContent = error.message;
      this.message.hidden = false;
    }
  }

  ensureRenderer() {
    if (this.renderer === undefined) {
      const context = this.canvas.getContext("webgl2", { alpha: true, antialias: true });
      this.renderer = context && new GridlineThree.WebGLRenderer({ canvas: this.canvas, context, alpha: true });
      this.canvas.dataset.renderer = this.renderer ? "three" : "canvas";
    }
    return this.renderer;
  }

  renderMarks(marks, width, height, ratio = Math.min(2, window.devicePixelRatio || 1)) {
    this.ensureRenderer();
    if (!this.renderer) {
      this.canvas.width = width * ratio;
      this.canvas.height = height * ratio;
      const ctx = this.canvas.getContext("2d");
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      for (const [color, triangles] of marks.layers) {
        ctx.beginPath();
        for (let index = 0; index < triangles.length; index += 6) {
          ctx.moveTo(triangles[index], triangles[index + 1]);
          ctx.lineTo(triangles[index + 2], triangles[index + 3]);
          ctx.lineTo(triangles[index + 4], triangles[index + 5]);
          ctx.closePath();
        }
        ctx.fillStyle = color;
        ctx.fill();
      }
      return;
    }
    const { Scene, OrthographicCamera, BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, DoubleSide } = GridlineThree;
    const scene = new Scene();
    const camera = new OrthographicCamera(0, width, 0, -height, 0.1, 10);
    camera.position.z = 4;
    for (const [color, triangles] of marks.layers) {
      const xyz = new Float32Array(triangles.length * 1.5);
      for (let index = 0; index < triangles.length; index += 2) {
        const vertex = index * 1.5;
        xyz[vertex] = triangles[index];
        xyz[vertex + 1] = -triangles[index + 1];
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(xyz, 3));
      const opacity = color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1;
      const material = new MeshBasicMaterial({ color: color.slice(0, 7), opacity, transparent: true,
        depthTest: false, depthWrite: false, side: DoubleSide });
      const mesh = new Mesh(geometry, material);
      mesh.renderOrder = scene.children.length;
      scene.add(mesh);
    }
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.renderer.render(scene, camera);
    for (const { geometry, material } of scene.children) {
      geometry.dispose();
      material.dispose();
    }
  }

  renderLabels(marks, width, height) {
    this.labels.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const svg = (tag, attributes) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
      return node;
    };
    const lines = marks.lines.map(([x1, y1, x2, y2]) => svg("line", { x1, y1, x2, y2 }));
    const labels = marks.labels.map(({ text, x, y, align = "middle", rotate, title, slice }) => {
      const node = svg("text", { x, y, "text-anchor": align });
      if (rotate) node.setAttribute("transform", `rotate(-90 ${x} ${y})`);
      if (title) node.setAttribute("class", "axis-title");
      if (slice) node.setAttribute("class", "slice-label");
      node.textContent = text;
      return node;
    });
    this.labels.replaceChildren(...lines, ...labels);
  }

  renderLegend(items) {
    delete this.legend.dataset.spatial;
    const focused = document.activeElement?.dataset.chartSeries;
    this.legend.replaceChildren(...items.map(({ name, index }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = Boolean(this.preview);
      button.dataset.chartSeries = index;
      button.setAttribute("aria-pressed", String(!this.hidden.has(index)));
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.setProperty("--series-color", chartColors[index % chartColors.length]);
      button.append(swatch, name);
      button.addEventListener("click", () => this.toggleSeries(index));
      return button;
    }));
    if (focused !== undefined) this.legend.querySelector(`[data-chart-series="${focused}"]`)?.focus({ preventScroll: true });
  }

  renderSpatialLegend() {
    const scale = this.threeD.colorScale;
    const levels = this.threeD.contourLevels || [];
    const key = JSON.stringify([scale?.name, scale?.low, scale?.high, scale?.midpoint, scale?.palette, levels]);
    if (this.legend.dataset.spatial === key) return;
    this.legend.dataset.spatial = key;
    this.legend.replaceChildren();
    if (scale) {
      const { name, low, high, midpoint, interpolate } = scale;
      const numbers = (low === high ? [low] : midpoint === undefined ? [low, high] : [low, midpoint, high]).map(chartNumber);
      const legend = document.createElement("span");
      legend.className = "chart-color-scale";
      const gradient = document.createElement("span");
      gradient.style.background = low === high ? interpolate(0.5) : chartPaletteGradient(interpolate);
      legend.append(gradient, `${name} · ${numbers.join("  –  ")}`);
      this.legend.append(legend);
    }
    if (levels.length) {
      const label = document.createElement("span");
      label.className = "chart-contour-legend";
      label.textContent = "Contours · " + levels.map(chartNumber).join(", ");
      this.legend.append(label);
    }
  }

  hit2d(x, y) {
    let best = null, distance = 18;
    for (const hit of this.hits || []) {
      if (hit.radius) {
        let angle = Math.atan2(y - hit.y, x - hit.x);
        if (angle < -Math.PI / 2) angle += 2 * Math.PI;
        if (angle >= hit.start && angle < hit.end && Math.hypot(x - hit.x, y - hit.y) <= hit.radius) best = hit;
      } else if (hit.width) {
        if (Math.abs(x - hit.x) <= hit.width / 2 && y >= Math.min(hit.y, hit.baseline) && y <= Math.max(hit.y, hit.baseline)) {
          best = hit;
          break;
        }
      } else {
        const nearby = Math.hypot(x - hit.x, y - hit.y);
        if (nearby < distance) { distance = nearby; best = hit; }
      }
    }
    return best?.text;
  }

  clearTooltip() {
    this.pinnedTooltip = false;
    this.tooltip.hidden = true;
  }

  showTooltip(event, pin = false) {
    const spatial = chart3dTypes.has(this.config?.type);
    if (!pin && (this.pinnedTooltip || spatial)) return;
    const rect = this.plot.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const text = spatial ? this.threeD.hitTest(x, y, rect.width, rect.height, this.config) : this.hit2d(x, y);
    if (!text || !this.message.hidden) {
      this.clearTooltip();
      return;
    }
    this.pinnedTooltip = pin;
    this.tooltip.classList.toggle("pinned", pin);
    this.tooltip.setAttribute("aria-live", pin ? "polite" : "off");
    this.tooltip.textContent = text;
    this.tooltip.hidden = false;
    this.tooltip.style.left = `${clamp(x + 12, 0, rect.width - this.tooltip.offsetWidth)}px`;
    this.tooltip.style.top = `${clamp(y + 12, 0, rect.height - this.tooltip.offsetHeight)}px`;
  }

  capture(config, miniature = false, size) {
    const width = miniature ? 320 : Math.max(240, size?.width ?? 780);
    const height = miniature ? 155 : Math.max(140, size?.height ?? 480);
    const header = miniature ? 0 : 50;
    const pixelRatio = Math.min(2, 2000 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    const ctx = canvas.getContext("2d");
    ctx.scale(canvas.width / width, canvas.height / height);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#15394d";
    ctx.font = 'bold 22px "Segoe UI", sans-serif';
    if (!miniature) ctx.fillText(config.title, 22, 31, width - 44);
    let snapshot;
    try {
      const source = this.app.sheets.find(({ name }) => name === config.sourceSheet);
      const data = chartData(this.app.engine, source, config);
      if (chart3dTypes.has(config.type)) {
        const legend = !miniature && (config.colorBy >= 0 || (config.type === "surface3d" && config.colorBy !== -1));
        const plotHeight = height - header - (legend ? 26 : 0);
        snapshot = new Chart3D({
          canvas: this.canvas,
          pixelRatio,
          ensureRenderer: () => this.ensureRenderer(),
          renderLabels: () => ctx.drawImage(this.canvas, 0, header, width, plotHeight)
        }, false, !miniature);
        snapshot.setCamera(config.camera);
        snapshot.render(data, config, width, plotHeight);
        if (legend && snapshot.colorScale) {
          const { name, low, high, midpoint, interpolate } = snapshot.colorScale;
          const stops = ctx.createLinearGradient(22, 0, 134, 0);
          for (let index = 0; index <= 16; index++) stops.addColorStop(index / 16, interpolate(low === high ? 0.5 : index / 16));
          ctx.fillStyle = stops;
          ctx.fillRect(22, height - 19, 112, 9);
          ctx.fillStyle = "#405769";
          ctx.font = '12px "Segoe UI", sans-serif';
          const values = (low === high ? [low] : midpoint === undefined ? [low, high] : [low, midpoint, high]).map(chartNumber);
          ctx.fillText(`${name} · ${values.join("  –  ")}`, 142, height - 10, width - 159);
        }
      } else {
        const selected = config.series || data.series.slice(0, 3).map((_, index) => index);
        const hidden = config.type === "pie" ? new Set() : new Set(data.series.map((_, index) => index)
          .filter((index) => !selected.includes(index)));
        const plotHeight = height - header - (!miniature && config.trendline ? 24 : 0);
        const marks = chartLayout(data, config, width, plotHeight, hidden);
        this.renderMarks(marks, width, plotHeight, pixelRatio);
        ctx.drawImage(this.canvas, 0, header, width, plotHeight);
        if (!miniature) {
          ctx.strokeStyle = "#e0e7ed";
          for (const [x1, y1, x2, y2] of marks.lines) {
            ctx.beginPath();
            ctx.moveTo(x1, y1 + header);
            ctx.lineTo(x2, y2 + header);
            ctx.stroke();
          }
          this.captureLabels(ctx, marks.labels, header);
          if (marks.trend) {
            ctx.font = '12px "Segoe UI", sans-serif';
            ctx.fillStyle = "#31465d";
            ctx.fillText(trendlineLabel(marks.trend), 22, height - 9, width - 44);
          }
        }
      }
    } catch (error) {
      ctx.font = '14px "Segoe UI", sans-serif';
      ctx.fillText(miniature ? "Chart" : error.message, 22, header + 33, width - 44);
    } finally {
      snapshot?.dispose();
      this.schedule();
    }
    return canvas;
  }

  captureLabels(ctx, labels, header) {
    ctx.fillStyle = "#51677c";
    for (const { text, x, y, align = "middle", rotate, title, slice } of labels) {
      ctx.save();
      ctx.translate(x, y + header);
      if (rotate) ctx.rotate(-Math.PI / 2);
      ctx.textAlign = align === "middle" ? "center" : align;
      ctx.font = `${title || slice ? "bold " : ""}11px "Segoe UI", sans-serif`;
      ctx.fillStyle = slice ? "#ffffff" : "#51677c";
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }

  snapshot(config) {
    const image = this.capture(config);
    return { row: 1, column: 1, width: 780, height: 480, name: config.title, data: image.toDataURL("image/png") };
  }
}
