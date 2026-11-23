# NormPDF Portable

A local, standalone HTML-to-PDF renderer using the working WeasyPrint 70.0 runtime from `C:\norm`. Does not need Python, Docker, a network server, or an installer. The 65 MB runtime stays in `runtime/weasyprint/` and is not copied into the Chrome extension.

## Layout

- `NormPDF.exe` — small Windows launcher, CLI and Chrome Native Messaging
- `src/NormPDF.cs` — editable launcher source
- `templates/conversation.css`, `compact.css`, `report.css` — editable PDF designs
- `runtime/weasyprint/` — bundled native rendering runtime
- `render.cmd` — drag-and-drop HTML export to PDF
- `register-chrome.cmd` — register the folder for a known Chrome extension ID
- `NormPDF\native-host.json` — small Chrome registration record, per Windows user/machine

## Standalone use

```powershell
.\NormPDF.exe --render "conversation.html" "conversation.pdf" conversation
```

Or drag an HTML export onto `render.cmd`. Changing a CSS file affects the next PDF automatically. Copy the entire folder to another Windows machine if needed.

## Chrome extension integration

1. Put this folder on the same computer as Chrome.
2. Load/reload the Norm extension in `chrome://extensions`; copy its 32-character ID.
3. Run `register-chrome.cmd`; the installer detects your existing Norm extension ID, or prompts if necessary.
4. In the extension choose **Enhanced PDF (NormPDF)** after capturing a conversation.
5. The PDF is saved in the current Windows user's Downloads directory. If the helper is unavailable, browser PDF preview/Print remains an independent fallback.

The native host receives HTML in numbered 120KB chunks, writes a temporary HTML file, invokes WeasyPrint with the selected CSS, returns the saved PDF path, and deletes the temporary HTML. It is started only when Chrome requests it and exits after rendering. No service or network listener remains running.

Chrome enforces the registered extension allowlist. This is a functional proof of integration; do not treat it as a full security audit.

The HTML renderer owns user-prompt turn boundaries, images, citations, and generated headings. WeasyPrint handles page flow and produces selectable text, clickable links, and PDF bookmarks from turn headings. This project does not reimplement Norm's separate PyMuPDF PDF reflow pipeline, which expects a PDF as input rather than HTML.


## Portable v0.2 layout templates
The three CSS templates cap portrait screenshots at 135mm, keep single-image prompt blocks together, and handle reasoning quote groups. The selected template controls PDF page size (A4 in Conversation/Compact, Letter in Report). The browser-only Print route remains independent.

## Portable 0.3 image cap
Portrait screenshots and other images are limited to approximately 40% of printable page height (Conversation 103mm, Compact 109mm, Report 94mm) without distortion.

## Portable 0.4
Supports compact resolved assistant image galleries and source links emitted by Norm exporter v0.4.9. Ordinary uploaded pictures keep the 40-percent page-height limits. Missing images are identified in the document, not fabricated.


The native host manifest is stored directly beside NormPDF.exe, not in AppData.
