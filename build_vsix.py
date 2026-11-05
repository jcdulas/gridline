"""Package the local Gridline extension as a VSIX archive."""

import json
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parent
EXTENSION = ROOT / "vscode"


def package():
    manifest = json.loads((EXTENSION / "package.json").read_text(encoding="utf-8"))
    identity = " ".join(
        key + "=" + quoteattr(manifest[field])
        for key, field in (("Id", "name"), ("Version", "version"), ("Publisher", "publisher"))
    )
    vsix_manifest = f"""<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity {identity} Language="en-US" />
    <DisplayName>{escape(manifest["displayName"])}</DisplayName>
    <Description>{escape(manifest["description"])}</Description>
    <License>extension/LICENSE.txt</License>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value={quoteattr(manifest["engines"]["vscode"])} />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
  </Assets>
</PackageManifest>
"""
    content_types = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
"""
    files = {
        "package.json": EXTENSION / "package.json",
        "extension.js": EXTENSION / "extension.js",
        "gridline.html": ROOT / "gridline.html",
        "README.md": ROOT / "README.md",
        "LICENSE.txt": ROOT / "LICENSE",
    }
    for source in files.values():
        if not source.is_file():
            raise SystemExit(f"Missing {source.name}. Build Gridline before packaging the extension.")
    output = ROOT / ".build" / f'gridline-{manifest["version"]}.vsix'
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("extension.vsixmanifest", vsix_manifest)
        for name, source in files.items():
            archive.write(source, "extension/" + name)
    print(output)


if __name__ == "__main__":
    package()
