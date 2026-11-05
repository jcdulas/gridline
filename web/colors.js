const cellColorRows = [
  ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
  ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
  ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
  ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
  ["#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"],
  ["#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79"],
  ["#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47"],
  ["#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130"]
];
const presetCellColors = cellColorRows.flat();

function normalizeColorHex(text) {
  const digits = text.trim().replace(/^#/, "").toLowerCase();
  if (/^[a-f0-9]{6}$/.test(digits)) return "#" + digits;
  if (/^[a-f0-9]{3}$/.test(digits)) return "#" + [...digits].map((digit) => digit.repeat(2)).join("");
  return null;
}

class CellColorPalette {
  constructor(app) {
    this.app = app;
    this.element = document.getElementById("cell-color-palette");
    this.customColors = [];
    this.element.addEventListener("toggle", () => {
      if (!this.element.matches(":popover-open")) this.trigger?.setAttribute("aria-expanded", "false");
    });
  }

  open(property, trigger) {
    const open = this.element.matches(":popover-open");
    if (open && this.trigger === trigger) {
      this.element.hidePopover();
      trigger.focus();
      return;
    }
    this.trigger?.setAttribute("aria-expanded", "false");
    this.trigger = trigger;
    const isFill = property === "fill";
    const title = isFill ? "Fill color" : "Font color";
    const current = this.app.style(this.app.active())?.[property]?.toLowerCase();
    this.element.setAttribute("aria-label", title);

    const apply = (color) => {
      if (this.app.busy) return;
      try { this.app.formatSelection({ [property]: color }); }
      catch (error) { this.app.status(error.message); }
      this.element.hidePopover();
      this.app.canvas.focus();
    };
    const action = (label, symbol, run) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-palette-action";
      button.innerHTML = icon(symbol);
      button.append(label);
      button.addEventListener("click", run);
      return button;
    };
    const swatch = (color) => {
      const button = document.createElement("button");
      const label = color.toUpperCase();
      const rgb = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
      button.type = "button";
      button.className = "cell-color-swatch";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(color === current));
      button.style.setProperty("--cell-swatch", color);
      button.style.color = (299 * rgb[0] + 587 * rgb[1] + 114 * rgb[2]) / 1000 > 145 ? "#192631" : "#fff";
      if (color === current) button.innerHTML = icon("check");
      button.addEventListener("click", () => apply(color));
      return button;
    };

    const reset = action(isFill ? "No fill" : "Automatic", isFill ? "eraser" : "text", () => apply(null));
    reset.setAttribute("aria-pressed", String(!current));
    const presets = document.createElement("div");
    presets.className = "cell-color-grid";
    presets.setAttribute("role", "group");
    presets.setAttribute("aria-label", "Preset colors");
    const colors = presetCellColors.map(swatch);
    const selected = Math.max(0, presetCellColors.indexOf(current));
    colors.forEach((button, index) => { button.tabIndex = index === selected ? 0 : -1; });
    presets.append(...colors);
    presets.addEventListener("keydown", (event) => {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -10, ArrowDown: 10 }[event.key];
      if (step === undefined) return;
      const index = colors.indexOf(event.target);
      if (index < 0) return;
      event.preventDefault();
      const next = colors[index + step];
      if (!next) return;
      event.target.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    });

    const custom = document.createElement("div");
    custom.className = "cell-color-custom";
    const add = action("Custom color…", "plus", () => {
      this.element.hidePopover();
      this.customColor(property, current || (isFill ? "#eaf5ee" : "#000000"));
    });
    const recent = this.customColors.map(swatch);
    custom.append(add, ...recent);
    this.element.replaceChildren(reset, presets, custom);
    if (!open) this.element.showPopover({ source: trigger });
    trigger.setAttribute("aria-expanded", "true");
    const rect = trigger.getBoundingClientRect();
    const width = this.element.offsetWidth, height = this.element.offsetHeight;
    this.element.style.left = `${clamp(rect.left, 6, innerWidth - width - 6)}px`;
    const top = rect.bottom + 5 + height <= innerHeight - 6 ? rect.bottom + 5 : rect.top - height - 5;
    this.element.style.top = `${clamp(top, 6, innerHeight - height - 6)}px`;
    (this.element.querySelector('[aria-pressed="true"]') || colors[selected]).focus();
  }

  customColor(property, initial) {
    this.app.ask(property === "fill" ? "Custom fill color" : "Custom font color", "Hex color", initial.toUpperCase(), (value) => {
      const color = normalizeColorHex(value);
      if (!color) throw new Error("Enter a hex color such as #1A73E8 or #ABC.");
      this.app.formatSelection({ [property]: color });
      this.customColors = [color, ...this.customColors.filter((previous) => previous !== color)].slice(0, 8);
    });
    const hex = this.app.dialogContent.querySelector("input");
    hex.spellcheck = false;
    hex.autocomplete = "off";
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = initial;
    picker.className = "custom-color-picker";
    picker.setAttribute("aria-label", "Open color picker");
    const fields = document.createElement("div");
    fields.className = "custom-color-fields";
    const label = hex.parentElement;
    label.before(fields);
    fields.append(label, picker);
    hex.addEventListener("input", () => {
      const color = normalizeColorHex(hex.value);
      if (color) picker.value = color;
    });
    picker.addEventListener("input", () => { hex.value = picker.value.toUpperCase(); });
    hex.focus();
    hex.select();
  }
}
