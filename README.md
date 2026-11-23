# Norm PDF Exporter

Portable Windows Chrome conversation exporter and local PDF renderer.

**Extension:** v0.4.12 · **Portable renderer:** v0.4 (with updated native-host registration)

The extension captures ChatGPT conversation text, images, citations, reasoning summaries and structured content; the local **NormPDF.exe** host uses bundled WeasyPrint to render selectable, bookmarked PDF documents. Browser Print, HTML, Markdown, JSON and ZIP exports remain available without the native host.

## Layout

```text
extension/                Chrome extension source (load unpacked)
NormPDF/
  NormPDF.exe             portable Windows host (release ZIP only)
  src/NormPDF.cs          host source
  runtime/weasyprint/     adapted, tested WeasyPrint bundle (release ZIP only)
  templates/             editable conversation / compact / report styles
  register-chrome.cmd
  register-chrome.ps1
  unregister-chrome.ps1
  render.cmd
register-chrome.cmd       convenience launcher
scripts/build-release.ps1
third_party/              third-party notices
```

## Portable install

1. Download **Norm-PDF-Exporter-v0.4.12-portable-windows.zip** from Releases and extract it to a permanent folder **of your choice**, for example `D:\Apps\Norm-PDF-Exporter`.
2. In Chrome, visit `chrome://extensions`, enable Developer Mode, choose **Load unpacked**, and select the ZIP's `extension` directory. If you already loaded Norm from another folder, you can keep that installation instead.
3. Run `register-chrome.cmd` from the extracted root. It detects the installed extension ID(s) and registers `NormPDF\NormPDF.exe` with Chrome Native Messaging. If detection fails, paste the ID shown by Chrome or run `register-chrome.cmd <extension-id>`.
4. Refresh your ChatGPT tab and choose **Enhanced PDF (NormPDF)** in Norm.

**No application files are installed into AppData.** The native-host manifest is written next to `NormPDF.exe`; Chrome stores only the per-user registry pointer at `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.norm.localpdf`. Moving the extracted directory requires rerunning `register-chrome.cmd`.

To remove just the registration, run `NormPDF\unregister-chrome.ps1`; it will only unregister this exact installation. No service, Docker stack, or administrator access is needed.

## Standalone PDF generation

```powershell
.\NormPDF\NormPDF.exe --render .\conversation.html .\conversation.pdf conversation
```

Or drag an HTML export onto `NormPDF\render.cmd`. Templates: `conversation`, `compact`, `report`. All templates are editable CSS files and do not require recompilation.

## Build and tests

The repository tracks the extension, renderer source, templates, and installer scripts. The portable release also bundles the adapted WeasyPrint runtime; its ~65 MB of binaries is intentionally excluded from the Git source history, not from the distributed ZIP.

On Windows, run `powershell -File scripts\build-release.ps1` with the bundled runtime already in `NormPDF\runtime\weasyprint`, or pass `-RuntimeSource` pointing to a working WeasyPrint runtime directory. The script builds the C# host with .NET Framework's compiler and packages both components.

Run extension regression tests using Node.js: `node extension\tests\test_export_gate.js` and the other `test_*.js` files.

Third-party runtime redistribution information is in `THIRD_PARTY_NOTICES.md` and `third_party`.

## Data handling

Conversation capture and local PDF production run on your machine. The extension can retrieve images from permitted first-party/explicit public image CDN hosts. Unresolved sources and missing images are identified rather than fabricated. The exporter never requires a remote PDF conversion service.

## Publish to GitHub
After authenticating GitHub CLI (\`gh auth login\`), run \`powershell -File scripts\publish-github.ps1\` from this folder. It creates the repository if missing (private by default), pushes \`main\` and \`v0.4.12\`, and uploads the complete portable ZIP plus SHA256SUMS as GitHub release assets. Use \`-Visibility public\` to create a public repository.
