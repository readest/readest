---
name: hardcover-showcase-7970-web-cover-coep
description: "#7970 Readest submitted to Hardcover's showcase (hardcover-docs PR #286, pending); web Link Hardcover Book covers blocked by COEP require-corp (UNFIXED); dev-web screenshot recipe"
metadata:
  node_type: memory
  type: project
  originSessionId: 25bffa29-89f8-431d-951f-546972869e69
  modified: 2026-11-26T11:21:05.058Z
---

**Showcase (2026-11-26):** #7970 asked to list Readest on docs.hardcover.app/showcase. Submitted as hardcoverapp/hardcover-docs#286 from the fork chrox/hardcover-docs, branch `showcase/readest`: `src/content/showcase/readest.yaml` plus 3 WebP shots (1600×1000) in `public/showcase/readest/`. Author is `Readest` / github `readest`. #7970 was answered and closed. The PR's only workflow ("Deploy to GitHub Pages") was `action_required` (first-time contributor). Nobody was pinged: the docs ask for `@revelry` on Hardcover Discord or a PR comment tagging `KylieBenfield`. The docs site 403s automated fetches, so read it with `gh api repos/hardcoverapp/hardcover-docs/contents/...`.

**Bug, UNFIXED, no issue yet:** on web, the cover thumbnails in Link Hardcover Book show as broken images. `src/middleware.ts` sends `Cross-Origin-Embedder-Policy: require-corp` on every route except `/s`, and `assets.hardcover.app` sends no CORP header. Tauri sets no COEP (reasoned, not checked on a device). The fix is probably `credentialless` (as `/s` does) or proxying the images. Seen on dev-web and production headers.

**Seen once, not investigated:** after jumping to Chapter 1 from the TOC, opening Link Book (once) or closing it with Escape (once) put the Gatsby demo book back on page 1.

**Screenshot recipe (dev-web + Playwright, read-only on Hardcover):**
- Use the desktop app's Hardcover token from `~/Library/Application Support/com.bilingify.readest/settings.json`. Write it into IndexedDB `AppFileSystem` → `files` → `Settings/settings.json` (`hardcover.enabled/accessToken`, `autoSync: false`), then reload.
- Route `/api/hardcover/graphql` and answer any `mutation` with 403, so nothing is written to the real account.
- To show the covers, add `cross-origin-resource-policy: cross-origin` to the `assets.hardcover.app/**` responses. Do NOT `route.fetch` the document: fulfilled documents fail Chromium's local-network checks and the page stays blank.
- The shell has `http_proxy=127.0.0.1:8118`, so curl to localhost returns `000`. Use `--noproxy '*'`.
- Viewport 1280×800 at DSF 1.25 gives 1600×1000. Clear `demoBooksFetched` in an init script to get the 6 English demo books.

Related: [[hardcover-link-book-5846]], [[hardcover-sync-row-6527]]
