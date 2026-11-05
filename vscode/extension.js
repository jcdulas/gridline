"use strict";

const { randomBytes, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

const viewType = "gridline.workbook";
const chunkSize = 2 * 1024 * 1024;
const supportedFile = /\.(?:xlsx|gridline|csv|tsv|txt|text|prn|dat|log)$/i;
const fileVersionFields = ["ino", "size", "mtimeNs", "ctimeNs"];

function webviewHtml(html) {
  const nonce = randomBytes(18).toString("base64");
  const policy = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "img-src data: blob:",
    "style-src 'unsafe-inline'",
    "script-src 'nonce-" + nonce + "' 'wasm-unsafe-eval'"
  ].join("; ");
  return html.replace('<html lang="en">', '<html lang="en" class="gridline-hosted">')
    .replace("<head>", '<head><meta http-equiv="Content-Security-Policy" content="' + policy + '">')
    .replaceAll("<script>", '<script nonce="' + nonce + '">');
}

class WorkbookSession {
  constructor(uri) {
    this.uri = uri;
  }

  async openSource() {
    await this.closeSource();
    const stat = await fs.lstat(this.uri.fsPath, { bigint: true });
    if (!stat.isFile()) throw new Error("Choose a regular local file.");
    this.source = await fs.open(this.uri.fsPath, "r");
    const opened = await this.source.stat({ bigint: true });
    if (fileVersionFields.some((key) => opened[key] !== stat[key])) {
      await this.closeSource();
      throw new Error("The source file changed during opening.");
    }
    // On Windows, path and handle stats can report different device identifiers.
    this.sourceVersion = stat;
    this.sourceSize = Number(stat.size);
    return { name: path.basename(this.uri.fsPath), size: this.sourceSize };
  }

  async read(index) {
    const start = index * chunkSize;
    if (!this.source || !Number.isSafeInteger(index) || index < 0 || start >= this.sourceSize) {
      throw new Error("Invalid read from the source file.");
    }
    const bytes = new Uint8Array(Math.min(chunkSize, this.sourceSize - start));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await this.source.read(bytes, offset, bytes.length - offset, start + offset);
      if (!bytesRead) throw new Error("The source file changed during import.");
      offset += bytesRead;
    }
    return bytes.buffer;
  }

  async closeSource() {
    const source = this.source;
    this.source = null;
    await source?.close();
  }

  async startExport({ name, size }) {
    if (typeof name !== "string" || !name || /[\\/:*?"<>|\x00-\x1f]/.test(name) ||
        name === "." || name === "..") {
      throw new Error("Invalid export request.");
    }
    const directory = path.dirname(this.uri.fsPath);
    const parsed = path.parse(name);
    const suggestion = name.toLowerCase() === path.basename(this.uri.fsPath).toLowerCase()
      ? parsed.name + " copy" + parsed.ext : name;
    const destination = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(directory, suggestion)),
      availableFileSystems: ["file"],
      saveLabel: "Save Gridline Export"
    });
    if (!destination) return false;
    if (destination.scheme !== "file" || destination.authority) throw new Error("Choose a local destination.");
    const samePath = process.platform === "win32"
      ? destination.fsPath.toLowerCase() === this.uri.fsPath.toLowerCase()
      : destination.fsPath === this.uri.fsPath;
    return samePath ? this.startSave(size) : this.prepareOutput(destination.fsPath, size, false);
  }

  async checkSourceVersion() {
    const previous = this.sourceVersion;
    const current = await fs.lstat(this.uri.fsPath, { bigint: true }).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!previous || !current?.isFile() || current.dev !== previous.dev ||
        fileVersionFields.some((key) => current[key] !== previous[key])) {
      throw new Error("The original file changed since opening. Reopen it or save a separate copy.");
    }
  }

  async startSave(size) {
    await this.checkSourceVersion();
    if ((this.sourceVersion.mode & 0o222n) === 0n) throw new Error("The original file is read-only.");
    return this.prepareOutput(this.uri.fsPath, size, true);
  }

  async prepareOutput(destination, size, overwrite) {
    if (this.output || !Number.isSafeInteger(size) || size < 0) throw new Error("Invalid save request.");
    const temporary = path.join(path.dirname(destination), ".gridline-" + randomUUID() + ".tmp");
    const handle = await fs.open(temporary, "wx", 0o600);
    this.output = { temporary, destination, handle, size, written: 0, overwrite };
    return true;
  }

  async write(bytes) {
    const output = this.output;
    if (!output || !(bytes instanceof ArrayBuffer) || !bytes.byteLength ||
        bytes.byteLength > chunkSize || output.written + bytes.byteLength > output.size) {
      throw new Error("Invalid export data.");
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesWritten } = await output.handle.write(buffer, offset, buffer.length - offset, output.written);
      if (!bytesWritten) throw new Error("The export could not be written.");
      offset += bytesWritten;
      output.written += bytesWritten;
    }
  }

  async finishExport() {
    const output = this.output;
    if (!output || output.written !== output.size) throw new Error("The export is incomplete.");
    if (output.overwrite) await output.handle.chmod(Number(this.sourceVersion.mode & 0o777n));
    await output.handle.close();
    output.handle = null;
    if (output.overwrite) await this.checkSourceVersion();
    await fs.rename(output.temporary, output.destination);
    this.output = null;
    if (output.overwrite) this.sourceVersion = await fs.lstat(output.destination, { bigint: true });
  }

  async cancelExport() {
    const output = this.output;
    this.output = null;
    if (!output) return;
    try {
      await output.handle?.close();
    } finally {
      await fs.rm(output.temporary, { force: true });
    }
  }

  handle(message) {
    switch (message.type) {
      case "source": return this.openSource();
      case "read": return this.read(message.index);
      case "closeSource": return this.closeSource();
      case "startSave": return this.startSave(message.size);
      case "startExport": return this.startExport(message);
      case "write": return this.write(message.bytes);
      case "finishExport": return this.finishExport();
      case "cancelExport": return this.cancelExport();
      default: throw new Error("Unknown Gridline request.");
    }
  }
}

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand("gridline.configureFileAssociations", () =>
    vscode.commands.executeCommand("workbench.action.openSettings", "@id:workbench.editorAssociations")));

  context.subscriptions.push(vscode.window.registerCustomEditorProvider(viewType, {
    openCustomDocument(uri) {
      if (uri.scheme !== "file" || uri.authority || !supportedFile.test(uri.fsPath)) {
        throw new Error("Choose a supported local workbook or text file.");
      }
      return { uri, dispose() {} };
    },

    async resolveCustomEditor(document, panel) {
      const html = await fs.readFile(path.join(context.extensionPath, "gridline.html"), "utf8");
      const session = new WorkbookSession(document.uri);
      let queue = Promise.resolve();
      let disposed = false;
      panel.webview.options = { enableScripts: true, localResourceRoots: [] };
      const listener = panel.webview.onDidReceiveMessage((message) => {
        if (!Number.isSafeInteger(message?.id) || message.id < 1) return;
        queue = queue.then(async () => {
          if (disposed) return;
          let reply;
          try {
            if (message.type === "openAsText") {
              if (!/\.txt$/i.test(document.uri.fsPath)) throw new Error("Only text files can be reopened as plain text.");
              await vscode.commands.executeCommand("vscode.openWith", document.uri, "default", panel.viewColumn);
              reply = { id: message.id };
            } else {
              reply = { id: message.id, result: await session.handle(message) };
            }
          } catch (error) {
            reply = { id: message.id, error: error.message };
          }
          if (!disposed) await panel.webview.postMessage(reply);
          if (!disposed && !reply.error && message.type === "openAsText") panel.dispose();
        }).catch(() => {});
      });
      panel.onDidDispose(() => {
        disposed = true;
        listener.dispose();
        void queue.then(() => Promise.allSettled([session.closeSource(), session.cancelExport()]));
      });
      panel.webview.html = webviewHtml(html);
    }
  }, { webviewOptions: { retainContextWhenHidden: true } }));
}

module.exports = { activate };
