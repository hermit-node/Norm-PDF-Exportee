# v0.4.12 — first portable source release

- Chrome conversation exporter with HTML, Markdown, JSON, ZIP and NormPDF rendering.
- Browser and native-host paths for embedded images; includes public Amazon image CDNs.
- Structured assistant images, grouped source citations and clickable PDF links.
- Incomplete image coverage is a visible warning, not an export lock. Retry only failed images.
- Standalone C# native host with the registration manifest beside NormPDF.exe.
- Automated Chrome extension-ID detection without an AppData program install.
- Portable ZIP contains the complete, adapted WeasyPrint runtime and editable PDF templates.
- Windows source tests: 12 JavaScript regression tests pass. Portable runtime smoke test passes.

The runtime binaries are distributed in the release archive, not in the Git source tree.