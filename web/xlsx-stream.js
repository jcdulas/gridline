const xlsxStreamingThreshold = 8 * 1024 * 1024;

// The small node interface lets the normal worksheet reader consume one row
// at a time without retaining a DOM for a multi-million-row sheet.
class XlsxXmlNode {
  constructor(tag) {
    this.localName = tag.local;
    this.xmlAttributes = tag.attributes;
    this.children = [];
    this.text = "";
  }

  getAttribute(name) { return this.xmlAttributes[name]?.value ?? null; }

  getAttributeNS(namespace, name) {
    return Object.values(this.xmlAttributes).find((attr) => attr.uri === namespace && attr.local === name)?.value ?? null;
  }

  get attributes() {
    return Object.values(this.xmlAttributes).map((attr) => ({ localName: attr.local, value: attr.value }));
  }

  get textContent() {
    return this.children.length ? this.text + this.children.map((node) => node.textContent).join("") : this.text;
  }
}

async function* xlsxWorksheetNodes(zip, path) {
  if (zip.entries.get(path)?.length < xlsxStreamingThreshold) {
    const xml = readXml(await zip.text(path));
    yield* children(child(xml, "cols"), "col");
    yield* children(child(xml, "sheetData"), "row");
    const drawing = child(xml, "drawing");
    if (drawing) yield drawing;
    return;
  }
  const parser = new GridlineXlsxXml.SaxesParser({ xmlns: true });
  const ancestry = [], nodes = [], ready = [];
  parser.on("doctype", () => { throw new Error("Unsupported XML declaration in XLSX workbook."); });
  parser.on("error", () => { throw new Error("An XLSX worksheet XML part is invalid."); });
  parser.on("opentag", (tag) => {
    const parent = ancestry.at(-1);
    ancestry.push(tag.local);
    const wanted = (ancestry.length === 2 && tag.local === "drawing") ||
      (ancestry.length === 3 && ((parent === "cols" && tag.local === "col") ||
        (parent === "sheetData" && tag.local === "row")));
    if (!wanted && !nodes.length) return;
    const node = new XlsxXmlNode(tag);
    nodes.at(-1)?.children.push(node);
    nodes.push(node);
  });
  const appendText = (text) => { if (nodes.length) nodes.at(-1).text += text; };
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", () => {
    if (nodes.length) {
      const node = nodes.pop();
      if (!nodes.length) ready.push(node);
    }
    ancestry.pop();
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for await (const bytes of zip.stream(path, zipMax - 1)) {
    // Bound the number of transient row nodes even if the browser supplies
    // a large decompression chunk.
    for (let start = 0; start < bytes.length; start += 65_536) {
      parser.write(decoder.decode(bytes.subarray(start, start + 65_536), { stream: true }));
      yield* ready;
      ready.length = 0;
    }
  }
  parser.write(decoder.decode()).close();
  yield* ready;
}
