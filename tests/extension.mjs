import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const uri = (fsPath) => ({ scheme: "file", authority: "", fsPath });
let provider;
let chooseDestination;
let configureFileAssociations;
let changeConfiguration;
let reopened;
const preferences = {
  "gridsntabs": {},
  workbench: {
    editorAssociations: {
      "*.csv": "another.csvEditor",
      "*.txt": "gridsntabs.workbook",
      "*.md": "another.markdownEditor"
    }
  }
};
const state = new Map();
const configurationErrors = [];
const vscode = {
  ConfigurationTarget: { Global: 1 },
  workspace: {
    getConfiguration(section) {
      return {
        inspect: (name) => ({ globalValue: preferences[section][name] }),
        async update(name, value, target) {
          assert.equal(target, 1);
          if (value === undefined) delete preferences[section][name];
          else preferences[section][name] = structuredClone(value);
        }
      };
    },
    onDidChangeConfiguration(listener) {
      changeConfiguration = listener;
      return {};
    }
  },
  commands: {
    registerCommand(name, action) {
      assert.equal(name, "gridsntabs.configureFileAssociations");
      configureFileAssociations = action;
      return {};
    },
    executeCommand(name, query, editor, column) {
      if (name === "vscode.openWith") {
        reopened = { uri: query, editor, column };
        return;
      }
      assert.equal(name, "workbench.action.openSettings");
      assert.equal(query, "@ext:jcdulas.gridsntabs");
      return true;
    }
  },
  window: {
    registerCustomEditorProvider(name, registered) {
      assert.equal(name, "gridsntabs.workbook");
      provider = registered;
      return {};
    },
    showSaveDialog: (options) => chooseDestination(options),
    showErrorMessage: (message) => configurationErrors.push(message)
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
extension.activate({
  extensionPath: process.cwd(),
  subscriptions: [],
  globalState: {
    get: (key) => state.get(key),
    async update(key, value) { state.set(key, structuredClone(value)); }
  }
});
assert.equal(await configureFileAssociations(), true);

async function changeFormat(name, value) {
  if (value === undefined) delete preferences["gridsntabs"][name];
  else preferences["gridsntabs"][name] = value;
  await changeConfiguration({ affectsConfiguration: (key) => key === "gridsntabs." + name });
}

await changeFormat("openCsv", true);
assert.equal(preferences["gridsntabs"].openTxt, true);
assert.equal(preferences.workbench.editorAssociations["*.csv"], "gridsntabs.workbook");
await changeFormat("openTxt", undefined);
assert.equal(preferences.workbench.editorAssociations["*.txt"], undefined);
await changeFormat("openCsv", undefined);
assert.equal(preferences.workbench.editorAssociations["*.csv"], "another.csvEditor");
await changeFormat("openTsv", true);
preferences.workbench.editorAssociations["*.tsv"] = "another.tsvEditor";
await changeFormat("openTsv", false);
assert.equal(preferences.workbench.editorAssociations["*.tsv"], "another.tsvEditor");
await changeFormat("openXlsx", false);
assert.equal(preferences.workbench.editorAssociations["*.xlsx"], "default");
await changeFormat("openXlsx", undefined);
assert.equal(preferences.workbench.editorAssociations["*.xlsx"], undefined);
preferences.workbench.editorAssociations["*.xlsx"] = "default";
await changeFormat("openXlsx", undefined);
assert.equal(preferences["gridsntabs"].openXlsx, false);
await changeFormat("openXlsx", undefined);
assert.equal(preferences.workbench.editorAssociations["*.xlsx"], "gridsntabs.workbook");
await changeFormat("openXlsx", false);
assert.equal(preferences.workbench.editorAssociations["*.xlsx"], "default");
assert.equal(preferences.workbench.editorAssociations["*.md"], "another.markdownEditor");
assert.deepEqual(configurationErrors, []);
const manifest = JSON.parse(await readFile(new URL("../vscode/package.json", import.meta.url), "utf8"));
assert.equal(`${manifest.publisher}.${manifest.name}`, "jcdulas.gridsntabs");
assert.equal(manifest.displayName, "Grids&Tabs");
assert.equal(manifest.contributes.configuration.properties["gridsntabs.openXlsx"].default, true);
assert.equal(manifest.contributes.configurationDefaults["workbench.editorAssociations"]["*.xlsx"], "gridsntabs.workbook");
assert.equal(manifest.contributes.configurationDefaults["workbench.editorAssociations"]["*.gridsntabs"], "gridsntabs.workbook");
assert.ok(manifest.contributes.customEditors[0].selector.some(({ filenamePattern }) => filenamePattern === "*.gridsntabs"));

const chunkSize = 2 * 1024 * 1024;
const build = path.resolve(".build");
await mkdir(build, { recursive: true });
const directory = await mkdtemp(path.join(build, "extension-test-"));
const original = path.join(directory, "Source # %25.CSV");
const copy = path.join(directory, "copy.csv");
const bytes = (text) => new TextEncoder().encode(text).buffer;
let receive, onDispose, deliver;
const hostScript = await readFile(new URL("../web/host.js", import.meta.url), "utf8");
const webview = {
  onDidReceiveMessage(listener) {
    receive = listener;
    return { dispose() {} };
  },
  postMessage(reply) {
    deliver({ source: {}, data: { ...reply, channel: "another-session", error: "Wrong session" } });
    deliver({ source: {}, data: reply });
  }
};

function connect() {
  const [, channel] = webview.html.match(/data-gridsntabs-channel="([a-f0-9]{32})"/);
  return runInNewContext(hostScript + "\naskGridsNTabsHost", {
    acquireVsCodeApi: () => ({ postMessage: receive }),
    document: { documentElement: { dataset: { gridsntabsChannel: channel } } },
    // VS Code removes parent from the webview before it runs our script.
    window: { addEventListener(type, listener) { assert.equal(type, "message"); deliver = listener; } },
    setTimeout,
    clearTimeout
  });
}

try {
  const data = Buffer.alloc(chunkSize + 4, 97);
  data.write("tail", chunkSize);
  await writeFile(original, data);
  assert.throws(() => provider.openCustomDocument({ ...uri(original), authority: "remote" }), /local/);
  assert.throws(() => provider.openCustomDocument(uri(original + ".exe")), /supported/);
  const nativeUri = uri(path.join(directory, "Workbook.gridsntabs"));
  assert.equal(provider.openCustomDocument(nativeUri).uri, nativeUri);
  const document = provider.openCustomDocument(uri(original));
  await provider.resolveCustomEditor(document, {
    webview,
    onDidDispose(callback) { onDispose = callback; }
  });
  const request = connect();
  assert.deepEqual(webview.options.localResourceRoots, []);
  await assert.rejects(request("openAsText"), /Only text files/);
  assert.match(webview.html, /class="gridsntabs-hosted"/);
  assert.match(webview.html, /<title>Grids&amp;Tabs — Spreadsheet<\/title>/);
  assert.match(webview.html, /default-src 'none'/);
  assert.doesNotMatch(webview.html, /Quarterly sales tracker/i);
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

  const external = "Updated outside Grids&Tabs";
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
  await connect()("openAsText");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reopened, { uri: textFile, editor: "default", column: 2 });
  assert.equal(closed, true);
  console.log("Grids&Tabs extension passed local reads, source overwrite, export, and text fallback.");
} finally {
  onDispose?.();
  await rm(original, { force: true });
  await rm(copy, { force: true });
  await rmdir(directory);
}
