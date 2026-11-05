"""Build the C++ engine and embed all runtime assets in gridsntabs.html."""

import argparse
import base64
from pathlib import Path
import os
import shutil
import subprocess


ROOT = Path(__file__).resolve().parent
BUILD = ROOT / ".build"
WEB = ROOT / "web"
SCRIPTS = (
    "engine.js", "dates.js", "grid.js", "ribbon.js", "colors.js", "files.js", "text-tables.js", "commands.js", "images.js", "tables.js", "interactions.js",
    "zip.js", "xlsx.js", "xlsx-stream.js", "drawings.js", "xlsx-images.js", "pivot.js", "xlsx-pivot.js", "chart3d.js", "trendlines.js", "chart.js",
    "xlsx-spatial.js",
    "host.js", "clipboard.js", "formula-colors.js", "app.js",
)


def compiler_path(explicit):
    if explicit:
        return explicit
    if os.environ.get("EMXX"):
        return os.environ["EMXX"]
    compiler = shutil.which("em++")
    if compiler:
        return compiler
    raise SystemExit("Activate Emscripten (emsdk_env) or pass --compiler with the path to em++.")


def build(compiler):
    BUILD.mkdir(exist_ok=True)
    wasm = BUILD / "workbook.wasm"
    environment = os.environ.copy()
    for variable in ("TMP", "TEMP", "TMPDIR"):
        environment[variable] = str(BUILD)
    subprocess.run(
        [
            compiler, str(ROOT / "engine" / "workbook.cpp"), "-o", str(wasm),
            "-std=c++20", "-O2", "-Wall", "-Wextra", "--no-entry",
            "-sSTANDALONE_WASM=1", "-sFILESYSTEM=0", "-sALLOW_MEMORY_GROWTH=1",
            "-sINITIAL_MEMORY=16777216", "-sMAXIMUM_MEMORY=2147483648",
            "-sSTACK_SIZE=2097152", "-sABORTING_MALLOC=1",
        ],
        check=True,
        cwd=ROOT,
        env=environment,
    )
    return wasm


def package_html(wasm):
    template = (WEB / "shell.html").read_text(encoding="utf-8")
    css = (WEB / "style.css").read_text(encoding="utf-8")
    scripts = "\n\n".join((WEB / name).read_text(encoding="utf-8") for name in SCRIPTS)
    vendor = "\n".join((WEB / "vendor" / name).read_text(encoding="utf-8")
                       for name in ("three.bundle.js", "xlsx-xml.bundle.js"))
    vendor_licenses = "\n\n".join(
        (WEB / "vendor" / name).read_text(encoding="utf-8")
        for name in ("three.LICENSE", "delaunator.LICENSE", "robust-predicates.LICENSE",
                     "d3-scale-chromatic.LICENSE", "d3-interpolate.LICENSE", "d3-color.LICENSE",
                     "saxes.LICENSE", "xmlchars.LICENSE", "apache-2.0.LICENSE",
                     "emscripten.LICENSE", "musl.LICENSE", "llvm.LICENSE", "libcxxabi.LICENSE",
                     "compiler-rt.LICENSE")
    )
    license_text = (ROOT / "LICENSE").read_text(encoding="utf-8") + "\n\n" + vendor_licenses
    wasm_bytes = wasm.read_bytes()
    if not wasm_bytes.startswith(b"\0asm"):
        raise SystemExit("The supplied engine is not a WebAssembly module.")
    binary = base64.b64encode(wasm_bytes).decode("ascii")
    document = (
        template.replace("/* INLINE_STYLES */", "\n" + css)
        .replace("/* INLINE_SCRIPTS */", "\n" + scripts)
        .replace("/* INLINE_THREE */", "\n" + vendor)
        .replace("INLINE_LICENSES", license_text)
        .replace("INLINE_WASM", binary)
    )
    destination = ROOT / "gridsntabs.html"
    destination.write_text(document, encoding="utf-8", newline="\n")
    print(f"Built {destination.name} ({destination.stat().st_size:,} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--compiler", help="Path to the Emscripten C++ compiler")
    mode.add_argument("--wasm", type=Path, help="Package a previously compiled workbook engine")
    args = parser.parse_args()
    package_html(args.wasm if args.wasm else build(compiler_path(args.compiler)))
