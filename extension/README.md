# Norm Hybrid Local Conversation Exporter v0.4.8

Chrome / Edge extension. Captures the selected ChatGPT conversation branch using the
first-party ChatGPT API; resolves attached images using first-party ChatGPT metadata
and temporary OpenAI-hosted image URLs; **composes all exports locally in the browser**.

**No conversation or image content is uploaded to ChatGPT Exporter, PDFCrowd, or any
third-party PDF conversion service.** There are no vendor accounts, analytics,
remote scripts, stylesheets, or conversion backends in this extension.

## Installation

1. Extract `Norm-Hybrid-Local-Exporter-0.4.1.zip` somewhere stable, or use this updated source folder.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Disable the two older exporters, and disable any previous Norm Hybrid 0.3.0
   copy, so there is just one export button. Neither original is uninstalled.
4. Turn **Developer mode** on, click **Load unpacked**, and select the
   folder containing `manifest.json` (the existing 0.4.0 source directory remains loadable).
5. Refresh the ChatGPT conversation page and click **Norm · Export**.
6. Click **Capture conversation**. Wait for both history retrieval and image
   embedding, then review **Images embedded locally: N / N**.
7. Choose **PDF preview / Print**, then **Print / Save as PDF** (Destination:
   Save as PDF), or save self-contained HTML, Markdown, JSON, or ZIP.

## How image embedding works

1. The authenticated ChatGPT API supplies the selected conversation's text,
   message IDs, attachment IDs and image pointers. These are deduplicated (for
   example, `sediment://file_...` and `file_...` count as the same image).
2. Each unique image ID is looked up using ChatGPT's own file information API.
   A temporary asset URL is returned. **This only resolves the image; no file is
   separately saved to your computer.**
3. The browser fetches image bytes from ChatGPT or OpenAI asset hosts (such as
   `files.oaiusercontent.com`), converts each image to an in-memory data URI,
   then inserts it into the correct conversation message in the local output.
4. Chrome's own PDF print engine converts the resulting isolated document to
   PDF. Its print-frame Content Security Policy blocks all networking.
5. The ZIP includes `conversation.html`, `conversation.md`, `conversation.json`,
   `verification.json`, and **`images/file_....jpg`** etc. HTML, Markdown and
   JSON are also self-contained via embedded data URIs.

Image transfer runs at a maximum of three in parallel. Images are limited to
15 MiB each / 120 MiB total to prevent unexpectedly large captures.
Supported image types: JPEG, PNG, WebP, GIF. MIME is detected from image bytes.
Unsupported/failed images are reported by ID and do not silently count as embedded.

## Completeness and privacy guarantees

- History confirmation covers the selected API conversation branch reaching
  the root (or the oldest pagination page), not every alternate edit/branch.
- The manifest reports **history confirmation separately from image coverage**:
  `apiConfirmedComplete`, `imageReferences`, `imagesEmbedded`, `imagesFailed`,
  `imageFailures`, `visuallyComplete`. When image capture fails, exports are
  initially disabled until the user explicitly accepts missing images.
- DOM fallback can reconstruct virtualized, numbered turns, but **cannot prove
  complete server-side history**; it also requires explicit acceptance.
- The extension contacts ChatGPT's first-party conversation and image-metadata
  endpoints, and only HTTPS OpenAI image hosts. Cross-origin OpenAI image
  transfers go through the extension's local service worker. No API bearer token
  is sent to that worker or included in an export; any temporary asset URL stays
  in runtime memory.
- Non-image attachments are still listed as references, not embedded. Images
  without recognized attachment/file IDs may require another capture method.
- This release has **passed mocked browser end-to-end tests**, but not yet a
  **live authenticated export of your 531-message conversation**. ChatGPT's
  undocumented endpoints can change, and asset hosts outside the allowlist will
  be reported as failures rather than silently fetched.

## Regression tests

From a Python environment containing Playwright, Chromium, Pillow, and PyMuPDF:

```bash
python tests/test_images_e2e.py
python tests/test_e2e.py
python tests/test_dom_fallback.py
node tests/test_background.js
```

The offline tests verify 531 messages / 38 distinct JPEGs in a local Chromium
PDF and ZIP, and a deliberate one-image failure (37/38, warning and opt-in),
plus the original 350-message/pagination/DOM checks. Test fixture content is
synthetic and contains no personal chat data.

This is an independent implementation that draws on the behaviors observed in
the two older exporters. No existing extension is overwritten.

## v0.4.1 rendering update

- Render basic Markdown tables as proper HTML tables in local PDF and HTML exports.
- Preserve HTTPS citation and source links, including from DOM fallback snapshots.
- Render Markdown checklists and horizontal rules.
- Protect inline code spans from emphasis-formatting substitutions.
- Added `node tests/test_render.js` regression test; existing background worker test also passes.
- No changes to history API, image transfer, host permissions, or local-only export architecture.
- Live authenticated browser/PDF end-to-end export has not been revalidated in this release.


## v0.4.2 turn layout and timestamps

- One user-prompt-based turn with all intervening assistant records grouped beneath it; no individual thinking bookmarks.
- Preserve timestamps from captured message metadata; missing timestamps are explicitly labeled.
- Distinct print-friendly user and ChatGPT blocks, one top-level turn heading, and nested content headings demoted.
- Raw JSON remains unchanged for capture auditing; empty internal records are omitted only from the human-readable exports.
- Added node tests/test_turns.js regression coverage.
- This release does not repair missing capture content or certify Chrome PDF bookmark behavior.


## v0.4.3 structured-content recovery and audit
- Fix ChatGPT thoughts[] content parsing: preserve titled reasoning summaries and content from structured thinking records.
- Support empty text records with model_dil_v2.fallbackMarkdown and reasoning recap duration fallback.
- Preserve recipient/channel/visibility metadata, and distinguish tool-directed assistant commands from user-facing reply sections.
- Include content-type counts, recovered thinking records, and unresolved structured records in the manifest JSON.
- Raw normalized JSON still includes tool-directed records for audit. Nothing is sent to any exporter service.
- Synthetic capture + full capture-to-render tests added; live authenticated API parity is not yet verified.


## v0.4.4 Markdown boundary protection
- Automatically terminate unmatched code fences at each captured message boundary, preventing later turns from becoming a single code block.
- Retain the original malformed message in raw JSON for fidelity. The same unmatched fence was also present in the reference exporter.
- Audit message records with unmatched fences or embedded role headings, and log turns longer than 1,000 non-image characters without splitting them.
- This is a Markdown rendering and diagnostic fix, not a change to conversation retrieval.

## v0.4.5 portable NormPDF integration

- Optional **Enhanced PDF (NormPDF)** button sends the rendered HTML to Chrome Native Messaging in 120K-character ordered chunks.
- Native host com.norm.localpdf points to a portable Windows directory, runs only on demand, and saves the final PDF to Downloads.
- The portable folder contains templates/conversation.css, compact.css and report.css plus a standalone WeasyPrint runtime.
- Register the host by running `NormPDF\register-chrome.cmd` with the Chrome extension ID on the computer where Chrome runs. Repeat after moving the portable folder.
- If the host is absent, the original PDF preview/Print button still works without change.
- No localhost HTTP server, daemon, or third-party export service. Local Native Messaging tests pass; an authenticated Chrome UI test is still required.


## v0.4.6 PDF layout corrections
- Image-only prompts have readable titles rather than sediment:// identifiers.
- Single-image prompt blocks remain together in WeasyPrint and portrait images have a print-safe 135mm maximum height.
- Multiline thinking quotes are parsed as blockquotes, with no stranded > separator lines.
- PDF page size now belongs to the selected portable template; browser Print uses browser page settings.
- Unresolved citation tokens render as compact source-reference counts with exact IDs retained in the HTML title attributes and raw JSON; external source links are not reconstructed without URL metadata.
- Added tests/test_pdf_layout.js and a 197-turn/46-image synthetic PDF audit for all three portable templates.

## v0.4.7 image sizing
- Image height caps are roughly 40% of printable page height: Conversation 103mm, Compact 109mm, Report 94mm, browser Print 100mm; all preserve image aspect ratios.


## v0.4.8 citation hyperlinks
- Preserve metadata.content_references (matched_text and alt link alternatives) in normalized JSON. Match on exact citation tokens, not offsets.
- Export clickable source links in Markdown, HTML, and WeasyPrint PDFs. Add one deduplicated Sources list per turn.
- Metadata without a recoverable HTTP(S) URL remains visibly unresolved; no URL guessing or remote source requests.
- Citation audit records linked/unresolved markers and unique source URLs. New capture is necessary for the link metadata.

## v0.4.9 resolved assistant content
- Prefer fallback Markdown for visible assistant text; decode known static component props and match their resolution records. No component code is executed.
- Embed resolved assistant image assets in their original positions using local downloads from allowed OpenAI origins, or already-loaded canvas-readable DOM images. Public third-party image requests are not made; blocked or unresolved assets are counted. Grouped source URLs are retained.
- Separate uploaded and assistant-displayed image coverage plus grouped failure details; preserve original text, omit transient image download URLs from exported JSON.

## v0.4.10 DOM image recovery
- Associate loaded substantive images with assistant message IDs, using exact URLs first and exact-count message-local ordering second. No global positional matching. Preserve first-party-only downloads and local blob/canvas recovery; report unmatched or inaccessible images.

## v0.4.11 public product images
- Permit credential-free image GETs from four exact Amazon image CDN hosts, under /images/ without queries, for assistant rich image metadata and observed DOM sources. No redirects or arbitrary third-party requests; uploaded attachments remain first-party-only.
- Preserve the underlying download failure and blocked hostname in diagnostics. Accept narrow but substantive connector images.

## v0.4.12 incomplete-image export and isolated retry
- An API-confirmed complete message history is exportable even if individual images fail to embed. Image counts and failed-image references remain visible and present in the verification manifest; incomplete DOM captures still require explicit acceptance.
- Retry only failed image references without re-fetching successfully captured images, preserving their exact bytes. Failure details and warnings refresh after each retry.
- PDF and HTML exports work immediately after capture, and a dedicated Retry missing images button appears when applicable.
