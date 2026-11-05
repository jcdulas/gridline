// Standalone Grids&Tabs uses browser files and downloads. In VS Code, the
// extension relays only the opened file and the destination selected in Save As.
const gridsNTabsHost = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
const hostChannel = gridsNTabsHost ? document.documentElement.dataset.gridsntabsChannel : null;
const hostChunkSize = 2 * 1024 * 1024;
const hostRequests = new Map();
let nextHostRequest = 0;

if (gridsNTabsHost) {
  window.addEventListener("message", ({ data }) => {
    // VS Code removes window.parent from the embedded page. Replies are
    // addressed to this webview session and a pending request.
    if (data?.channel !== hostChannel) return;
    const request = hostRequests.get(data?.id);
    if (!request) return;
    hostRequests.delete(data.id);
    clearTimeout(request.timeout);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  });
}

function askGridsNTabsHost(type, fields) {
  return new Promise((resolve, reject) => {
    if (!hostChannel) throw new Error("Grids&Tabs could not connect to VS Code. Reopen the file and try again.");
    const id = ++nextHostRequest;
    // The save dialog can stay open while the user chooses a destination.
    const timeout = type === "startExport" ? undefined : setTimeout(() => {
      hostRequests.delete(id);
      reject(new Error("VS Code stopped responding. Reopen the file and try again."));
    }, 30_000);
    hostRequests.set(id, { resolve, reject, timeout });
    try {
      gridsNTabsHost.postMessage({ ...fields, id, type, channel: hostChannel });
    } catch (error) {
      clearTimeout(timeout);
      hostRequests.delete(id);
      reject(error);
    }
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
    const bytes = askGridsNTabsHost("read", { index }).then((buffer) => new Uint8Array(buffer));
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
  if (!gridsNTabsHost) return;
  await app.work("Opening local file", async () => {
    const file = new HostedFile(await askGridsNTabsHost("source"));
    let reopenAsText = false;
    try {
      if (/\.(xlsx|gridsntabs)$/i.test(file.name)) {
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
      await askGridsNTabsHost("closeSource");
    }
    if (reopenAsText) await askGridsNTabsHost("openAsText");
  });
}

async function saveOutputBlob(blob, name, overwrite = false) {
  if (gridsNTabsHost) {
    const request = overwrite ? "startSave" : "startExport";
    if (!await askGridsNTabsHost(request, { name, size: blob.size })) return false;
    try {
      for (let offset = 0; offset < blob.size; offset += hostChunkSize) {
        const bytes = await blob.slice(offset, offset + hostChunkSize).arrayBuffer();
        await askGridsNTabsHost("write", { bytes });
      }
      await askGridsNTabsHost("finishExport");
    } catch (error) {
      await askGridsNTabsHost("cancelExport");
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
