import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const uri = (fsPath) => ({ scheme: "file", authority: "", fsPath });
let provider;
let chooseDestination;
let configureFileAssociations;
let reopened;
const vscode = {
  commands: {
    registerCommand(name, action) {
      assert.equal(name, "gridline.configureFileAssociations");
      configureFileAssociations = action;
      return {};
    },
    executeCommand(name, query, editor, column) {
      if (name === "vscode.openWith") {
        reopened = { uri: query, editor, column };
        return;
      }
      assert.equal(name, "workbench.action.openSettings");
      assert.equal(query, "@id:workbench.editorAssociations");
      return true;
    }
  },
  window: {
    registerCustomEditorProvider(name, registered) {
      assert.equal(name, "gridline.workbook");
      provider = registered;
      return {};
    },
    showSaveDialog: (options) => chooseDestination(options)
  },
  Uri: { file: uri }
};
const load = Module._load;
let extension;
try {
  Module._load = function (name, ...args) {
    return name === "vscode" ? vscode : load.call(this, name, ...args);
  };
  extension = require("../vscode/extension.js");
} finally {
  Module._load = load;
}
extension.activate({ extensionPath: process.cwd(), subscriptions: [] });
assert.equal(await configureFileAssociations(), true);

const chunkSize = 2 * 1024 * 1024;
const build = path.resolve(".build");
await mkdir(build, { recursive: true });
const directory = await mkdtemp(path.join(build, "extension-test-"));
const original = path.join(directory, "Source # %25.CSV");
const copy = path.join(directory, "copy.csv");
const bytes = (text) => new TextEncoder().encode(text).buffer;
let receive, onDispose, answer;
let nextId = 0;
const webview = {
  onDidReceiveMessage(listener) {
    receive = listener;
    return { dispose() {} };
  },
  postMessage(reply) {
    assert.equal(reply.id, nextId);
    if (reply.error) answer.reject(new Error(reply.error));
    else answer.resolve(reply.result);
  }
};
const request = (type, fields = {}) => new Promise((resolve, reject) => {
  answer = { resolve, reject };
  receive({ id: ++nextId, type, ...fields });
});

try {
  const data = Buffer.alloc(chunkSize + 4, 97);
  data.write("tail", chunkSize);
  await writeFile(original, data);
  assert.throws(() => provider.openCustomDocument({ ...uri(original), authority: "remote" }), /local/);
  assert.throws(() => provider.openCustomDocument(uri(original + ".exe")), /supported/);
  const document = provider.openCustomDocument(uri(original));
  await provider.resolveCustomEditor(document, {
    webview,
    onDidDispose(callback) { onDispose = callback; }
  });
  assert.deepEqual(webview.options.localResourceRoots, []);
  await assert.rejects(request("openAsText"), /Only text files/);
  assert.match(webview.html, /class="gridline-hosted"/);
  assert.match(webview.html, /default-src 'none'/);
  assert.deepEqual(await request("source"), { name: path.basename(original), size: data.length });
  assert.equal((await request("read", { index: 0 })).byteLength, chunkSize);
  assert.equal(new TextDecoder().decode(await request("read", { index: 1 })), "tail");
  await assert.rejects(request("read", { index: 2 }), /Invalid read/);
  await request("closeSource");

  for (const content of ["A;B\n1;2\n", "A;B\n1;3\n"]) {
    const data = bytes(content);
    assert.equal(await request("startSave", { size: data.byteLength }), true);
    await request("write", { bytes: data });
    await request("finishExport");
    assert.equal(await readFile(original, "utf8"), content);
  }

  const external = "Updated outside Gridline";
  assert.equal(await request("startSave", { size: 3 }), true);
  await request("write", { bytes: bytes("bad") });
  await writeFile(original, external);
  await assert.rejects(request("finishExport"), /changed since opening/);
  await request("cancelExport");
  await assert.rejects(request("startSave", { size: 0 }), /changed since opening/);
  assert.equal(await readFile(original, "utf8"), external);

  chooseDestination = () => undefined;
  assert.equal(await request("startExport", { name: "copy.csv", size: 3 }), false);
  chooseDestination = ({ defaultUri }) => {
    assert.equal(defaultUri.fsPath, copy);
    return uri(copy);
  };
  assert.equal(await request("startExport", { name: "copy.csv", size: 3 }), true);
  await request("write", { bytes: bytes("new") });
  await request("finishExport");
  assert.equal(await readFile(copy, "utf8"), "new");
  assert.deepEqual((await readdir(directory)).sort(), [path.basename(original), path.basename(copy)].sort());
  onDispose();
  let closed = false;
  const textFile = uri(path.join(directory, "Readme.TXT"));
  await provider.resolveCustomEditor(provider.openCustomDocument(textFile), {
    webview, viewColumn: 2,
    onDidDispose(callback) { onDispose = callback; },
    dispose() { closed = true; onDispose(); }
  });
  await request("openAsText");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reopened, { uri: textFile, editor: "default", column: 2 });
  assert.equal(closed, true);
  console.log("Gridline extension passed local reads, source overwrite, export, and text fallback.");
} finally {
  onDispose?.();
  await rm(original, { force: true });
  await rm(copy, { force: true });
  await rmdir(directory);
}
