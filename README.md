# Grids&Tabs

Grids&Tabs is an offline web spreadsheet. Open `gridsntabs.html` in a current desktop browser. The file contains the UI and the compiled WebAssembly engine. It makes no network requests and needs no web server.

## Using Grids&Tabs in VS Code

Install the approved `.vsix` using **Extensions → Install from VSIX…** in VS Code 1.96 or later. In the VS Code file explorer, right-click a local XLSX, `.gridsntabs`, CSV, TSV, or supported text file and select **Open With… → Grids&Tabs**. The editor starts at the ribbon.

Grids&Tabs opens XLSX files by default. Go to **Manage → Extension Settings** for Grids&Tabs to choose which formats open automatically, including files dropped into the editor area. The command **Grids&Tabs: Choose Which Files Open in Grids&Tabs** opens the same settings. Uncheck a format to restore its previous default editor.

Grids&Tabs inspects the contents of `.txt` files. If the text does not form a readable table, Grids&Tabs reopens it in the standard text editor. This keeps the file association in effect for other text files.

Use **Save** in the ribbon to replace the open file in its original format. If another application modifies the file, Grids&Tabs asks you to reopen it or save a copy. Use **File** to export to a destination you choose. Closing the editor discards unsaved edits.

The extension runs in the desktop editor in trusted workspaces. It contains no native launcher, install scripts, shell commands, server, telemetry, or network client. The webview receives only the file selected for opening and has no direct file access. The extension writes to the open file on **Save** or to the path selected in an export dialog. VS Code installation and extension policies are managed separately by your organization.

## Using the spreadsheet

- Use **File → Open workbook** to open an XLSX or native `.gridsntabs` file. **File → Save as XLSX (.xlsx)** exports the workbook and its worksheet tabs.
- Click the plus button to add a worksheet. Use **Insert → Rename Sheet** to rename the active worksheet and update its formula references.
- Enter formulas with a leading `=`, English function names, and comma-separated arguments. Examples include `=SUM(A:A)`, `=IF(A1>0,"Yes","No")`, and `='Sales overview'!$B$6`. **Formulas → Insert Function** lists the functions implemented by the engine.
- While editing a formula, click a cell or drag across a range to insert its address. Press Enter to commit or Esc to cancel.
- While editing a cell, Up and Down commit and move vertically. Left and Right move to the adjacent cell when the cursor reaches the corresponding end of the text.
- **Copy** and **Paste** preserve Grids&Tabs cell styles and borders. Clipboard data from other apps carries formatting when it includes a compatible HTML table. If the browser can request clipboard access, the first eligible paste prompts once per tab session. Grids&Tabs uses its temporary copy when system access is unavailable. Standalone browser windows using the same Grids&Tabs URL can share this copy through a SharedWorker or BroadcastChannel where the browser allows it. In the extension the fallback stays in the current editor. Use Ctrl+V or Command+V to paste from another app when clipboard access is restricted.
- Type `OJ8000000` in the name box and press Enter to jump to the last cell. Drop a CSV, TSV, or text file to import it into a new worksheet. Grids&Tabs detects commas, semicolons, tabs, pipes, and runs of spaces between columns. Use **File → Save delimited data…** to keep the source separator or space alignment, or to save a regular worksheet as CSV. Columns widen when needed to fit edited values.
- Drag a row or column separator to resize. Double-click it to fit its contents. Ctrl-click headers to select separate rows or columns, then resize them together. The header context menu offers exact sizes and resets.
- **Fill color** and **Font color** offer presets and a custom hex or visual color picker. Custom colors are available in both palettes until you close or reload Grids&Tabs.
- Select a cell inside a table to see a green corner marker and a header-orientation suggestion. Click the marker to select or format the table or create a linked chart. Right-click a table-shaped selection for **Create Linked Chart**, or a table header for sorting and filtering. Filters hide data in the current view, with one active filter per worksheet.
- Enter a date such as `2024-02-29`, or use **Insert → Calendar**. The number-format list includes ISO, US, European, and date/time formats. Drag the fill handle to extend date and month-end sequences, weekday or month names, or numeric patterns.
- Use **Insert → Pivot Table** on a range with headers. Choose up to two row fields, a column field, an exact-match filter, and up to three measures. Use **Data → Edit Fields** or **Refresh** on the report sheet.
- Use **Insert → Chart** for line, smooth line, smooth XY, column, scatter, area, pie, and 3D charts. Right-click a chart to edit it with a live preview. **Trendline** fits a linear, polynomial, exponential, logarithmic, or power model to a selected series and shows the equation and R².
- Three.js renders the 3D charts with WebGL 2. Drag to rotate, Shift-drag to pan, and scroll to zoom. The worksheet thumbnail follows the last camera view. **Color by** maps a numeric field to a D3 gradient, and **Contour lines** draws automatic or custom levels on a 3D surface. In the chart view, click a data mark or surface to inspect its values.
- Drop a workbook or delimited file into the grid to open or import it. Drop a raster image to anchor it to a cell. Use the image context menu or chart editor to choose **Place in cell** or **Float over cells**. Drag floating objects to move them. Double-click an embedded chart for the full chart view.
- Select an image or chart and drag a side or corner handle to resize it. A floating picture keeps its proportions when resized from a corner. Resizing an object placed in a cell changes the underlying column width or row height.

## Dimensions and compatibility

Each worksheet has 8,000,000 addressable rows and 400 columns. Only populated cells and explicit formatting occupy workbook storage. The canvas renders the visible viewport. The number of cells that can be populated depends on available browser memory, text lengths, formulas, and styles. The engine uses at most 2 GiB of WebAssembly linear memory. XLSX XML parsing and exports also use browser memory.

Grids&Tabs can save and reopen extended XLSX worksheets up to its 8,000,000-row limit. Some XLSX readers may truncate or reject sheets above 1,048,576 rows. Large XLSX worksheets are read incrementally. The amount of data a workbook can hold depends on browser memory and the ZIP32 size limit. Workbooks with values beyond column OJ exceed Grids&Tabs's width. CSV export is limited to 12 million fields in a single rectangular range.

XLSX import and export cover worksheet names and order, cell values, formula text, basic formatting, supported pictures, and compatible 2D charts. Shared formulas are expanded into per-cell expressions on import. **Formulas → Insert Function** lists the functions implemented by Grids&Tabs. Unsupported formula text is preserved for recalculation in compatible readers. Dynamic spill ranges, structured references, names, macros, and external data connections remain outside the engine's support.

XLSX preserves Grids&Tabs's pivot table definitions as native reports. Grids&Tabs can reopen compatible worksheet-based pivot tables on dedicated sheets. Reports with unsupported layouts keep their cached results. In-cell PNG and JPEG images use the workbook's embedded image format. When a cell also contains a value, the image uses an anchor that moves and resizes with that cell.

XLSX includes native chart data for supported 3D columns and regular height-colored surfaces. Other 3D charts use a preview image. Grids&Tabs's editable 3D settings, including the camera, axes, palette, and contours, travel with either representation in the workbook.

Chart sources support up to 5,000 data rows and 12 value columns. Pivot results support up to 400 columns and 100,000 output cells. Table detection uses neighboring data and header styles to suggest a range and orientation.

## Build from source

Install Python 3 and activate an Emscripten SDK with C++20 support. Run:

```sh
python build.py
```

You can also pass `--compiler` with the path to `em++`. The build embeds the WebAssembly and readable web sources into `gridsntabs.html`.
For UI-only changes, run `python build.py --wasm .build/workbook.wasm` to package the existing compiled engine.

Run `python build_vsix.py` after building the HTML to create the extension archive under `.build/`. Packaging uses the Python standard library and the local project files.

- `engine/workbook.cpp` owns cell data, formula parsing, calculation, and sparse range scans.
- `web/engine.js` is the UTF-8 bridge between the UI and WebAssembly.
- `web/grid.js` draws and scrolls the virtual worksheet. `web/app.js` handles selection, editing, and commands.
- `web/files.js`, `web/xlsx.js`, and `web/zip.js` handle workbook I/O.
- `web/vendor` contains the bundled Three.js r186, Delaunator, and D3 color palettes and their licenses. The app loads these libraries from the HTML.
- `vscode/extension.js` registers the custom editor and handles local file transfers for its webview.

Run `node tests/engine.mjs`, `node tests/workbook.mjs`, `node tests/interactions.mjs`, and `node tests/extension.mjs` against the built HTML. Add `--stress` to the engine test to populate a complete 8-million-row column and sum it.
