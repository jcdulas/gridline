const iconPaths = {
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M10 3v18"/>',
  save: '<path d="M20 20H4V4h12l4 4zM8 4v6h8V4M8 20v-6h8v6"/>',
  undo: '<path d="M9 7 4 12l5 5M4 12h10a5 5 0 0 1 5 5"/>',
  redo: '<path d="m15 7 5 5-5 5m5-5H10a5 5 0 0 0-5 5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9a2.7 2.7 0 0 1 5.3.4c0 2-2.7 2.1-2.7 4M12 17h.01"/>',
  file: '<path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8m-8 4h6"/>',
  folder: '<path d="M3 7h7l2 2h9l-2 11H3zM3 7V5h6l2 2h8v2"/>',
  paste: '<path d="M9 5H5v16h14V5h-4M9 3h6v5H9zM8 13h8m-8 4h6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8 8 12 12M8 16 20 4"/>',
  bold: '<path d="M7 4h6a4 4 0 0 1 0 8H7m6 0a4 4 0 0 1 0 8H7V4" stroke-width="2.4"/>',
  italic: '<path d="M10 4h8M6 20h8m0-16L10 20"/>',
  underline: '<path d="M6 4v7a6 6 0 0 0 12 0V4M4 21h16"/>',
  fill: '<path d="m5 11 7-7 7 7-7 7-7-7Zm3-8 8 8M5 11h14m1 2c4 5-3 5 0 0Z"/>',
  text: '<path d="m5 18 7-15 7 15M8 12h8"/>',
  border: '<rect x="4" y="4" width="16" height="16"/><path d="M4 12h16M12 4v16" stroke-dasharray="1.2 2.3"/>',
  left: '<path d="M4 5h16M4 10h10M4 15h16M4 20h10"/>',
  center: '<path d="M4 5h16M7 10h10M4 15h16M7 20h10"/>',
  right: '<path d="M4 5h16m-10 5h10M4 15h16m-10 5h10"/>',
  percent: '<path d="M5 19 19 5"/><circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/>',
  currency: '<path d="M12 2v20m5-15c-2-4-10-3-10 1 0 5 10 3 10 8 0 4-8 5-11 1"/>',
  decimals: '<path d="M4 17h.01M7 13l3 4-3 4m3-4H5"/><ellipse cx="17" cy="10" rx="3" ry="6"/>',
  styles: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 9v11m6-11v11"/>',
  eraser: '<path d="m3 14 10-10a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-9 9H8zM8 9l8 8m-5 3h10"/>',
  sum: '<path d="M18 4H6l7 8-7 8h12"/>',
  find: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  sheet: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9h16m-8 2v7m-3-3.5h6"/>',
  date: '<rect x="4" y="6" width="16" height="15" rx="2"/><path d="M8 3v5m8-5v5M4 11h16m-12 4h2m3 0h3m-8 3h2"/>',
  down: '<path d="M12 4v14m-5-5 5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download: '<path d="M12 4v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  sort: '<path d="M7 4v16m-4-4 4 4 4-4m3-10h7m-7 6h5m-5 6h3"/>',
  chart: '<path d="M4 3v17h17M8 16l4-5 3 2 5-7"/><path d="M19 6h1v2"/>',
  formula: '<path d="M4 6h16M4 18h16M4 6v12m16-12v12M8 15c2-1 2-6 4-6m-4 3h4m2 3 3-4m-3 0 3 4"/>',
  refresh: '<path d="M20 4v6h-6M20 10a8 8 0 1 0-.9 8"/>',
  width: '<path d="M4 5v14m16-14v14M7 12h10m-7-3-3 3 3 3m4-6 3 3-3 3"/>',
  expand: '<path d="M9 4H4v5m11-5h5v5m-5 11h5v-5M9 20H4v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  "chevron-up": '<path d="m6 15 6-6 6 6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-left": '<path d="m15 6-6 6 6 6"/>',
  "chevron-right": '<path d="m9 6 6 6-6 6"/>'
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || ""}</svg>`;
}

function initializeIcons(scope) {
  for (const element of scope.querySelectorAll("[data-icon]")) element.innerHTML = icon(element.dataset.icon);
}

function ribbonButton(action, label, symbol, size = "icon-only", toggle = false) {
  return `<button type="button" class="${size}" data-action="${action}" title="${label}"
    aria-label="${label}" ${toggle ? 'aria-pressed="false"' : ""}>${icon(symbol)}${size.startsWith("icon-only") ? "" : label}</button>`;
}

function ribbonSelect(property, label, options, className = "") {
  return `<select data-style="${property}" title="${label}" aria-label="${label}" class="${className}">${options.map(([value, name]) =>
    `<option value="${value}">${name}</option>`).join("")}</select>`;
}

function colorRibbonButton(action, label, symbol) {
  return `<button type="button" class="icon-only color-picker" data-action="${action}" title="${label}"
    aria-label="${label}" aria-haspopup="dialog" aria-expanded="false" popovertarget="cell-color-palette">
    ${icon(symbol)}${icon("chevron-down")}</button>`;
}

function ribbonRow(...controls) { return `<div class="ribbon-row">${controls.join("")}</div>`; }
function ribbonStack(...rows) { return `<div class="ribbon-stack">${rows.join("")}</div>`; }
function ribbonGroup(label, ...controls) {
  return `<section class="ribbon-group" aria-label="${label}"><div class="ribbon-controls">${controls.join("")}</div></section>`;
}

const fonts = ["Segoe UI", "Arial", "Calibri", "Georgia", "Consolas"];
const sizes = [9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32];
const formats = [
  ["general", "General"], ["number", "Number"], ["currency", "Currency (USD)"], ["currency-eur", "Currency (EUR)"],
  ["percent", "Percentage"], ["integer", "Integer"], ["date", "Date (ISO)"], ["date-us", "Date (US)"],
  ["date-eu", "Date (EU)"], ["date-long", "Date (month name)"], ["datetime", "Date & time"], ["time", "Time"]
];

function renderRibbon(tab, target) {
  const big = (action, label, symbol, toggle) => ribbonButton(action, label, symbol, "large-action", toggle);
  const small = (action, label, symbol) => ribbonButton(action, label, symbol, "small-action");
  const button = ribbonButton;
  const panels = {
    Home: () => [
      ribbonGroup("Clipboard", big("paste", "Paste", "paste"),
        ribbonStack(small("cut", "Cut", "cut"), small("copy", "Copy", "copy"))),
      ribbonGroup("Font", ribbonStack(
        ribbonRow(ribbonSelect("font", "Font family", fonts.map((name) => [name, name]), "font-family"),
          ribbonSelect("size", "Font size", sizes.map((size) => [size, size]))),
        ribbonRow(button("bold", "Bold", "bold", "icon-only", true),
          button("italic", "Italic", "italic", "icon-only", true),
          button("underline", "Underline", "underline", "icon-only", true),
          button("border", "Toggle cell borders", "border", "icon-only", true),
          colorRibbonButton("fill", "Fill color", "fill"),
          colorRibbonButton("color", "Font color", "text")))),
      ribbonGroup("Alignment", ribbonStack(
        ribbonRow(button("align-left", "Align left", "left", "icon-only", true),
          button("align-center", "Center", "center", "icon-only", true),
          button("align-right", "Align right", "right", "icon-only", true)),
        small("column-width", "Column Width", "width"))),
      ribbonGroup("Number", ribbonStack(
        ribbonRow(ribbonSelect("format", "Number format", formats, "number-format")),
        ribbonRow(button("currency", "Currency", "currency"), button("percent", "Percentage", "percent"),
          button("decimal-more", "Increase decimal places", "decimals"),
          button("decimal-less", "Decrease decimal places", "minus")))),
      ribbonGroup("Styles", big("styles", "Cell Styles", "styles"), big("table-format", "Format Table", "grid"),
        big("clear-format", "Clear Format", "eraser")),
      ribbonGroup("Editing", big("auto-sum", "AutoSum", "sum"), big("auto-average", "AutoAverage", "styles"), big("find", "Find", "find"))
    ],
    Insert: () => [
      ribbonGroup("Worksheet", big("add-sheet", "New Sheet", "sheet"), big("rename-sheet", "Rename Sheet", "text")),
      ribbonGroup("Reports", big("pivot-create", "Pivot Table", "styles"), big("chart-create", "Chart", "chart"),
        big("chart-edit", "Edit Chart", "width"), big("insert-image", "Image", "upload")),
      ribbonGroup("Cells", big("insert-date", "Calendar", "date"), big("fill-down", "Fill Down", "down"),
        big("fill-right", "Fill Right", "chevron-right")),
      ribbonGroup("Calculations", big("functions", "Insert Function", "formula"), big("auto-sum", "AutoSum", "sum"),
        big("auto-average", "AutoAverage", "styles"))
    ],
    Formulas: () => [
      ribbonGroup("Function Library", big("functions", "Insert Function", "formula"), big("auto-sum", "AutoSum", "sum"),
        big("auto-average", "AutoAverage", "styles"), big("function-if", "Logical", "check")),
      ribbonGroup("Calculation", big("toggle-formulas", "Show Formulas", "grid", true),
        big("calculate", "Calculate Now", "refresh"))
    ],
    Data: () => [
      ribbonGroup("Import & Export", big("import", "Import Data", "upload"), big("export", "Export CSV", "download")),
      ribbonGroup("Pivot Table", big("pivot-edit", "Edit Fields", "styles"), big("pivot-refresh", "Refresh", "refresh")),
      ribbonGroup("Sort", big("sort-ascending", "Sort Ascending", "sort"), big("sort-descending", "Sort Descending", "sort")),
      ribbonGroup("Navigate", big("find", "Find", "find"), big("go-to", "Go To", "expand"))
    ],
    View: () => [
      ribbonGroup("Show", big("toggle-gridlines", "Gridlines", "grid", true),
        big("toggle-formulas", "Show Formulas", "formula", true)),
      ribbonGroup("Zoom", big("zoom-out", "Zoom Out", "minus"), big("zoom-reset", "100%", "expand"),
        big("zoom-in", "Zoom In", "plus"))
    ]
  };
  target.innerHTML = panels[tab]().join("");
  target.setAttribute("aria-label", `${tab} ribbon`);
}
