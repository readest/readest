---
name: extension-file-url-fetch-capability
description: "What can and cannot read a file:// resource from a Chrome MV3 extension, measured not assumed"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2f4c8c79-c32d-421c-843c-bf83acfc1acb
  modified: 2026-08-05T13:37:41.681Z
---

Measured in a real Chromium (Playwright, extension loaded, "Allow access to file URLs" granted) while building local-page clipping for [[send-to-readest-local-file-clips]]. Reading a sibling image of a `file://` page, four routes:

| Route | Result |
|---|---|
| `fetch()` from the **extension service worker** | **works** - 200, real bytes, correct `content-type` |
| `fetch()` from an **extension page** (offscreen / popup origin) | **works** - byte-identical to the file on disk |
| `fetch()` / `XMLHttpRequest` from a **content script in the file:// page** | blocked - "Failed to fetch" / errored |
| `canvas.drawImage(renderedImg)` + `toDataURL()` in a content script | blocked - `SecurityError: Tainted canvases may not be exported`, even though `img.complete === true` |

**Why it matters:** the intuition "nothing may fetch a `file://` URL from an extension" is **wrong**, and I shipped that claim in a PR body and README before measuring it. The extension's own contexts inherit `<all_urls>` plus the file-access toggle and can read local files; only the *page's* context is sandboxed. So a saved web page's `<name>_files/` assets are recoverable, and the bundler is the only place that can do it.

**How to apply:** if a feature needs local file bytes in an extension, do it from the service worker or an extension page (offscreen document), never from a content script. And treat that capability as sensitive whenever the result leaves the machine - Readest uploads the built EPUB, so `assetBundler.isFetchableAssetUrl(url, pageUrl)` requires the clipped page to itself be `file://` (a remote page pointing an `<img>` at the disk must read nothing) and the asset to sit under that page's own directory (`new URL` pre-normalizes `..`, so a prefix test suffices; a page at `/` gets nothing since its directory would be the whole disk). Both fences have unit tests plus a real-browser check that a remote page referencing `file://` uploads with no image entry and no leaked bytes.

Probe recipe lives in [[send-to-readest-local-file-clips]] (Playwright + `--load-extension`, `sw.evaluate`, `chrome.scripting.executeScript({func})` for the in-page half).
