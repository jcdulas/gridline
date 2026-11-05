const imageDropPattern = /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i;
const imageDataPattern = /^data:image\/(png|jpeg);base64,([a-z\d+/]+={0,2})$/i;

function validateImage(image, engine) {
  if (!image || !Number.isInteger(image.row) || image.row < 0 || image.row >= engine.rows ||
      !Number.isInteger(image.column) || image.column < 0 || image.column >= engine.columns ||
      !Number.isInteger(image.width) || image.width < 12 || image.width > 1600 ||
      !Number.isInteger(image.height) || image.height < 12 || image.height > 1600 ||
      typeof image.data !== "string" || image.data.length > 3_900_000 || !imageDataPattern.test(image.data) ||
      typeof image.name !== "string" || image.name.length > 180 || !validObjectPlacement(image)) {
    throw new Error("The embedded image is invalid.");
  }
  return image;
}

function validObjectPlacement(object) {
  return (object.placement === undefined || ["cell", "floating"].includes(object.placement)) &&
    ["offsetX", "offsetY"].every((key) => object[key] === undefined ||
      (Number.isInteger(object[key]) && object[key] >= 0 && object[key] <= 1600));
}

function objectSize(sheet, object) {
  if (object.placement !== "cell") return { width: object.width, height: object.height };
  return { width: sheet.widths.get(object.column) ?? gridAxes.column.defaultSize,
    height: sheet.heights.get(object.row) ?? gridAxes.row.defaultSize };
}

async function embedImage(file, cell) {
  if (file.size > 40 * 1024 * 1024) throw new Error("Choose an image smaller than 40 MB.");
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("This image format could not be decoded."); }
  const canvas = document.createElement("canvas");
  const type = /jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name) ? "image/jpeg" : "image/png";
  const ctx = canvas.getContext("2d");
  let scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  let data;
  try {
    do {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      data = canvas.toDataURL(type, 0.9);
      scale *= 0.72;
    } while (data.length > 3_850_000 && scale > 0.01);
  } finally { bitmap.close(); }
  const displayScale = Math.min(1, 480 / canvas.width, 330 / canvas.height);
  return { ...cell, data, name: file.name.slice(0, 180), placement: "floating",
    width: Math.max(12, Math.round(canvas.width * displayScale)),
    height: Math.max(12, Math.round(canvas.height * displayScale)) };
}

function imageOffset(index, first, start, size, limit, skip) {
  if (index < first) {
    for (let current = skip(first - 1, -1); current >= index && start > -limit; current = skip(current - 1, -1)) {
      start -= size(current);
    }
  } else {
    for (let current = first; current < index && start < limit; current = skip(current + 1, 1)) start += size(current);
  }
  return start;
}

function drawWorksheetObjects(view) {
  const { model, ctx } = view;
  const sheet = model.sheet;
  view.objectRects = [];
  if (!sheet.images?.length && !sheet.embeddedCharts?.length) return;
  view.imageCache ??= new WeakMap();
  view.chartCache ??= new WeakMap();
  ctx.save();
  ctx.beginPath();
  ctx.rect(view.headerWidth, view.headerHeight, view.width - view.headerWidth, view.height - view.headerHeight);
  ctx.clip();
  for (const item of [...(sheet.images || []), ...(sheet.embeddedCharts || [])]) {
    if (view.skipFiltered("column", item.column, 1) !== item.column || view.skipFiltered("row", item.row, 1) !== item.row) continue;
    const size = objectSize(sheet, item);
    const width = size.width * view.scale;
    const height = size.height * view.scale;
    const floating = item.placement !== "cell";
    const offsetX = (floating ? item.offsetX || 0 : 0) * view.scale;
    const offsetY = (floating ? item.offsetY || 0 : 0) * view.scale;
    const x = imageOffset(item.column, sheet.left, view.headerWidth, (index) => view.columnWidth(index),
      Math.max(view.width, width + offsetX + view.headerWidth), (index, direction) => view.skipFiltered("column", index, direction)) + offsetX;
    const y = imageOffset(item.row, sheet.top, view.headerHeight, (index) => view.rowHeight(index),
      Math.max(view.height, height + offsetY + view.headerHeight), (index, direction) => view.skipFiltered("row", index, direction)) + offsetY;
    if (x >= view.width || y >= view.height || x + width <= view.headerWidth || y + height <= view.headerHeight) continue;
    let graphic;
    if (item.chart) {
      let cache = view.chartCache.get(item);
      const camera = item.chart.camera;
      if (!cache || cache.revision !== model.contentRevision || cache.camera !== camera) {
        const miniature = !floating;
        cache = { revision: model.contentRevision, camera, image: model.chartView.capture(item.chart, miniature, item) };
        view.chartCache.set(item, cache);
      }
      graphic = cache.image;
    } else {
      graphic = view.imageCache.get(item);
      if (!graphic) {
        graphic = new Image();
        graphic.addEventListener("load", () => view.requestDraw(), { once: true });
        graphic.src = item.data;
        view.imageCache.set(item, graphic);
      }
      if (!graphic.complete || !graphic.naturalWidth) graphic = null;
    }
    const radius = 6 * view.scale;
    if (graphic) {
      const ratio = Math.min((width - 4) / graphic.width, (height - 4) / graphic.height);
      const drawWidth = floating ? width : graphic.width * ratio;
      const drawHeight = floating ? height : graphic.height * ratio;
      if (drawWidth > 0 && drawHeight > 0) {
        const left = x + (width - drawWidth) / 2, top = y + (height - drawHeight) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(left, top, drawWidth, drawHeight, radius);
        ctx.clip();
        ctx.drawImage(graphic, left, top, drawWidth, drawHeight);
        ctx.restore();
      }
    }
    view.objectRects.push({ item, x, y, width, height });
    if (model.activeObject === item) {
      ctx.strokeStyle = "#14774c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, width - 2, height - 2, radius);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function bindFileDrops(app) {
  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
  document.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = app.busy ? "none" : "copy";
  });
  document.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (app.busy || app.dialog.open || !app.commitEdit()) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length !== 1) {
      app.status("Drop one workbook, delimited file, or image at a time.");
      return;
    }
    const [file] = files;
    const image = imageDropPattern.test(file.name) || /^image\/(png|jpeg|gif|webp|bmp|avif|x-icon)$/i.test(file.type);
    if (/\.(xlsx|gridline)$/i.test(file.name)) {
      app.confirmDiscard(() => { void app.openLocalFile(file); });
    } else if (declaredDelimiter(file) || (!image && isTextImportCandidate(file))) {
      void app.importLocalFile(file);
    } else if (image) {
      const { row, column } = app.view.hit(event.clientX, event.clientY);
      void app.insertImage(file, row !== undefined && column !== undefined ? { row, column } : app.active());
    } else app.status("Drop an XLSX workbook, CSV, TSV, text file, or raster image.");
  });
}
