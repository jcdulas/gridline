// A stable data URL lets windows on the same origin connect to the same worker
// without shipping a separate script alongside the HTML file.
function clipboardWorker() {
  let latest = null;
  self.onconnect = ({ ports: [port] }) => {
    port.onmessage = ({ data }) => {
      if (data?.type === "get") port.postMessage({ type: "value", entry: latest, request: data.request });
      if (data?.type === "put" && typeof data.entry?.text === "string" &&
          Number.isFinite(data.entry.time) && (!latest || data.entry.time > latest.time)) {
        latest = data.entry;
      }
    };
    port.postMessage({ type: "ready", entry: latest });
  };
}

class GridsNTabsClipboard {
  constructor() {
    this.name = "gridsntabs-clipboard-v1:" + location.pathname;
    this.latest = null;
    this.request = 0;
    if (gridsNTabsHost) return;
    try {
      const url = "data:text/javascript;charset=utf-8," + encodeURIComponent(`(${clipboardWorker.toString()})();`);
      const worker = new SharedWorker(url, this.name);
      this.port = worker.port;
      const startup = setTimeout(() => this.useBroadcastChannel(), 900);
      this.port.onmessage = ({ data }) => {
        clearTimeout(startup);
        this.receive(data);
      };
      worker.addEventListener("error", (event) => {
        event.preventDefault();
        clearTimeout(startup);
        this.useBroadcastChannel();
      });
    } catch {
      this.useBroadcastChannel();
    }
  }

  useBroadcastChannel() {
    this.port?.close();
    this.port = null;
    if (this.channel) return;
    try {
      this.channel = new BroadcastChannel(this.name);
      this.channel.onmessage = ({ data }) => {
        if (data?.type === "get") {
          if (this.latest) this.channel.postMessage({ type: "value", entry: this.latest });
        } else this.receive(data);
      };
      if (this.latest) this.channel.postMessage({ type: "put", entry: this.latest });
      this.channel.postMessage({ type: "get" });
    } catch {
      this.channel = null;
    }
  }

  receive(message) {
    if (message?.type !== "value" && message?.type !== "put" && message?.type !== "ready") return;
    const entry = message.entry;
    if (typeof entry?.text === "string" && Number.isFinite(entry.time) &&
        (!this.latest || entry.time > this.latest.time)) this.latest = entry;
    // A broadcast request can receive several replies. Allow time for the
    // newest entry to arrive. The worker has a single authoritative value.
    if (this.port && message.type === "value" && message.request === this.request) this.finishRead?.();
  }

  write({ text, html = "" }) {
    const now = performance.timeOrigin + performance.now();
    const time = this.latest ? Math.max(now, this.latest.time + 0.001) : now;
    this.latest = { text, html, time };
    this.send({ type: "put", entry: this.latest });
  }

  send(message) {
    try {
      (this.port || this.channel)?.postMessage(message);
    } catch {
      if (this.port) this.useBroadcastChannel();
      else this.channel = null;
    }
  }

  async read() {
    const transport = this.port || this.channel;
    if (transport) {
      this.pendingRead ??= new Promise((resolve) => {
        const finish = () => {
          clearTimeout(timeout);
          this.finishRead = null;
          resolve();
        };
        const timeout = setTimeout(finish, 200);
        this.finishRead = finish;
        this.send({ type: "get", request: ++this.request });
      }).finally(() => { this.pendingRead = null; });
      await this.pendingRead;
    }
    return this.latest;
  }
}

function clipboardCellHtml(text, style) {
  const css = [];
  if (style?.bold) css.push("font-weight:bold");
  if (style?.italic) css.push("font-style:italic");
  if (style?.underline) css.push("text-decoration:underline");
  if (style?.fill) css.push("background-color:" + style.fill);
  if (style?.color) css.push("color:" + style.color);
  if (style?.border) css.push("border:1px solid " + style.border);
  if (style?.font) css.push("font-family:" + style.font);
  if (style?.size) css.push("font-size:" + style.size + "px");
  if (style?.align) css.push("text-align:" + style.align);
  // The inline CSS is portable. The original input and style preserve Grids&Tabs
  // formulas, number formats, and values that HTML would otherwise normalize.
  const cell = xmlEscape(JSON.stringify([text, style ?? null]));
  return `<td data-gridsntabs-cell="${cell}"${css.length ? ` style="${xmlEscape(css.join(";"))}"` : ""}>${xmlEscape(text)}</td>`;
}

function clipboardCssColor(value) {
  if (["black", "windowtext"].includes(value.toLowerCase())) return "#000000";
  if (["white", "window"].includes(value.toLowerCase())) return "#ffffff";
  if (/^#[\da-f]{6}$/i.test(value)) return value;
  if (/^#[\da-f]{3}$/i.test(value)) return "#" + [...value.slice(1)].map((digit) => digit.repeat(2)).join("");
  const rgb = /^rgb\(\s*(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\s*\)$/i.exec(value);
  if (rgb) return "#" + rgb.slice(1).map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0")).join("");
  return undefined;
}

function readClipboardCell(cell, classes) {
  const original = cell.getAttribute("data-gridsntabs-cell");
  if (original) {
    try {
      const [text, style] = JSON.parse(original);
      if (typeof text === "string") return { text, style: style === null ? undefined : cleanStyle(style), exact: true };
    } catch {
      // Invalid or partial metadata still leaves a standard HTML table cell.
    }
  }
  const rules = [...cell.classList].map((name) => classes.get(name)).filter(Boolean);
  const property = (name) => cell.style[name] || rules.findLast((rule) => rule[name])?.[name] || "";
  const font = property("fontFamily").split(",")[0].trim().replace(/^["']|["']$/g, "");
  const size = /^([\d.]+)(px|pt)$/.exec(property("fontSize"));
  const edge = ["Top", "Right", "Bottom", "Left"].find((side) =>
    !["", "none", "hidden"].includes(property("border" + side + "Style")));
  const color = clipboardCssColor(property("color"));
  const style = cleanStyle({
    bold: property("fontWeight") === "bold" || Number(property("fontWeight")) >= 600,
    italic: property("fontStyle") === "italic",
    underline: property("textDecorationLine").split(/\s+/).includes("underline"),
    fill: clipboardCssColor(property("backgroundColor")),
    color,
    border: edge ? clipboardCssColor(property("border" + edge + "Color")) ?? color ?? "#000000" : undefined,
    font: fonts.find((name) => name.toLowerCase() === font.toLowerCase()),
    size: size ? Math.round(Number(size[1]) * (size[2] === "pt" ? 4 / 3 : 1)) : undefined,
    align: property("textAlign")
  });
  for (const lineBreak of cell.querySelectorAll("br")) lineBreak.replaceWith("\n");
  return { text: cell.textContent, style: Object.keys(style).length ? style : undefined };
}

function readClipboardTable(html, columns) {
  if (!html) return null;
  // Parse inside an inert template. Clipboard markup is never attached to the page.
  const template = document.createElement("template");
  template.innerHTML = html;
  const table = template.content.querySelector("table");
  if (!table?.rows.length) return null;
  const classes = new Map();
  const styles = template.content.querySelectorAll("style");
  if (styles.length && typeof CSSStyleSheet === "function") {
    // Desktop spreadsheets can put cell styles in class rules in the fragment.
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(Array.from(styles, (style) => style.textContent).join("\n"));
    for (const rule of stylesheet.cssRules) {
      const name = /^\.([\w-]+)$/.exec(rule.selectorText);
      if (name) classes.set(name[1], rule.style);
    }
  }
  const matrix = [];
  let count = 0;
  for (const row of table.rows) {
    if (!row.cells.length) continue;
    if (row.cells.length > columns) throw new Error("The paste would extend beyond the worksheet.");
    count += row.cells.length;
    if (count > 100_000) throw new Error("Paste up to 100,000 cells at a time, or use CSV import.");
    matrix.push(Array.from(row.cells, (cell) => readClipboardCell(cell, classes)));
  }
  return matrix.length ? matrix : null;
}

async function writeSystemClipboard(clipboard, { text, html }) {
  if (clipboard.write && typeof ClipboardItem === "function") {
    await clipboard.write([new ClipboardItem({
      "text/plain": new Blob([text], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" })
    })]);
  } else await clipboard.writeText(text);
}

async function readSystemClipboard(clipboard) {
  if (!clipboard.read) return { text: await clipboard.readText() };
  // Preserve spreadsheet class rules and Grids&Tabs metadata for inert parsing.
  const items = await clipboard.read({ unsanitized: ["text/html"] });
  const item = items.find(({ types }) => types.includes("text/html") || types.includes("text/plain"));
  if (!item) return null;
  const getText = async (type) => item.types.includes(type) ? (await item.getType(type)).text() : "";
  const [text, html] = await Promise.all([getText("text/plain"), getText("text/html")]);
  return { text, html };
}
