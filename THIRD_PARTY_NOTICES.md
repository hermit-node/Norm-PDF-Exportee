# Third-party notices — portable Windows bundle

The portable release includes the existing, tested WeasyPrint runtime and third-party Python/native dependencies. These are **not** original Norm PDF Exporter source.

- **WeasyPrint** — BSD-3-Clause; full upstream license in `third_party/WeasyPrint-LICENSE.txt`. Upstream: https://github.com/Kozea/WeasyPrint
- **Python runtime** — Python Software Foundation License; https://docs.python.org/3/license.html
- **PyInstaller** (frozen runtime/bootloader) — GNU GPL with the PyInstaller bootloader exception; https://pyinstaller.org/en/stable/license.html
- **Pillow** — HPND/MIT-CMU; https://github.com/python-pillow/Pillow/blob/main/LICENSE
- **fontTools** — MIT/BSD/Apache components; https://github.com/fonttools/fonttools
- **Pyphen** — GPL/LGPL/MPL depending on component and dictionaries; https://github.com/Kozea/Pyphen
- **Zopfli** — Apache-2.0; https://github.com/google/zopfli
- **Pango / GLib / Cairo / Fontconfig** and any native binary dependencies, if present in the bundled runtime — retain their respective upstream notices and license obligations.

The original package consists of bundled binaries, not an audited bill of materials. This notice identifies dependencies but should not be taken as a complete dependency-license audit. Source for the Norm-specific C# adapter is provided under `NormPDF/src`. Upstream dependency sources are available through their respective projects.

This distribution does not claim ownership of any WeasyPrint or other third-party code.
