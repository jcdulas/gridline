// Standalone Gridline uses browser files and downloads. In VS Code, the
// extension relays only the opened file and the destination selected in Save As.
const gridlineHost = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
const hostChunkSize = 2 * 1024 * 1024;
const hostRequests = new Map();
let nextHostRequest = 0;

if (gridlineHost) {
  window.addEventListener("message", ({ source, data }) => {
    if (source !== window.parent) return;
    const request = hostRequests.get(data?.id);
    if (!request) return;
    hostRequests.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  });
}

function askGridlineHost(type, fields) {
  return new Promise((resolve, reject) => {
    const id = ++nextHostRequest;
    hostRequests.set(id, { resolve, reject });
    gridlineHost.postMessage({ id, type, ...fields });
  });
}

class HostedFile {
  constructor({ name, size }) {
    this.name = name;
    this.size = size;
    this.type = "";
  }

  readChunk(index) {
    if (this.chunk?.index === index) return this.chunk.bytes;
    const bytes = askGridlineHost("read", { index }).then((buffer) => new Uint8Array(buffer));
    this.chunk = { index, bytes };
    return bytes;
  }

  slice(start = 0, end = this.size) {
    const source = this;
    start = clamp(start, 0, this.size);
    end = clamp(end, start, this.size);
    return {
      stream() {
        let position = start, cancelled = false;
        return new ReadableStream({
          async pull(controller) {
            if (position === end) { controller.close(); return; }
            const index = Math.floor(position / hostChunkSize);
            const offset = position % hostChunkSize;
            const bytes = await source.readChunk(index);
            if (cancelled) return;
            const part = bytes.subarray(offset, offset + end - position);
            if (!part.length) throw new Error("The source file changed during import.");
            position += part.length;
            controller.enqueue(part);
          },
          cancel() { cancelled = true; }
        });
      },
      async arrayBuffer() {
        const bytes = new Uint8Array(end - start);
        let offset = 0;
        for await (const part of this.stream()) {
          bytes.set(part, offset);
          offset += part.length;
        }
        return bytes.buffer;
      }
    };
  }

  stream() { return this.slice().stream(); }
}

async function openHostedFile(app) {
  if (!gridlineHost) return;
  await app.work("Opening local file", async () => {
    const file = new HostedFile(await askGridlineHost("source"));
    let reopenAsText = false;
    try {
      if (/\.(xlsx|gridline)$/i.test(file.name)) {
        await app.loadLocalWorkbook(file);
      } else {
        const engine = await WorkbookEngine.load();
        const title = delimitedSheetName(file.name);
        const { sheet, rows } = await createDelimitedSheet(engine, file, title);
        app.replaceWorkbook({ engine, sheets: [sheet], title });
        app.status("Imported " + rows.toLocaleString("en-US") + " rows");
      }
      app.hostedSource = { name: file.name, sheet: app.sheet };
      app.refresh();
    } catch (error) {
      if (!/\.txt$/i.test(file.name) || !(error instanceof DelimitedInputError)) throw error;
      reopenAsText = true;
    } finally {
      await askGridlineHost("closeSource");
    }
    if (reopenAsText) await askGridlineHost("openAsText");
  });
}

async function saveOutputBlob(blob, name, overwrite = false) {
  if (gridlineHost) {
    const request = overwrite ? "startSave" : "startExport";
    if (!await askGridlineHost(request, { name, size: blob.size })) return false;
    try {
      for (let offset = 0; offset < blob.size; offset += hostChunkSize) {
        const bytes = await blob.slice(offset, offset + hostChunkSize).arrayBuffer();
        await askGridlineHost("write", { bytes });
      }
      await askGridlineHost("finishExport");
    } catch (error) {
      await askGridlineHost("cancelExport");
      throw error;
    }
    return true;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
