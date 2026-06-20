---
name: pdfjs-vendor-wasm-decoders
description: Scanned PDFs blank in CI builds but fine locally — pdfjs wasm decoders (jbig2.wasm) not copied to public/vendor/pdfjs
metadata: 
  node_type: memory
  type: project
  originSessionId: 9066c0b0-71a6-4db0-92c1-c3ccacf1ff0d
---

CI-built DMG rendered scanned PDFs as blank pages (could still turn pages); text PDFs and EPUBs fine. Local build of the same commit worked. Regression between 0.11.1 (fine) and 0.11.2 (broken).

**Root cause:** `pdfjs-dist` was bumped 5.4.530 → 5.7.284 in #4143 (commit e8df651d5, between the 0.11.1 and 0.11.2 tags). pdfjs 5.7.x moved image decoders — notably **JBIG2** (the codec used by virtually every black-and-white *scanned* PDF) — from pure JS into WebAssembly modules the worker fetches at runtime from `wasmUrl` (`/vendor/pdfjs/`, set in `packages/foliate-js/pdf.js`: `wasmUrl: pdfjsPath('')`). The `copy-pdfjs-wasm` npm script only copied an allow-list `{openjpeg.wasm,qcms_bg.wasm}` and silently dropped `jbig2.wasm`. **`cpx` does not error when a glob matches nothing**, so the missing decoder was invisible: worker loads, pages turn, JBIG2 decode fails → blank.

**Why local masked it:** `pnpm build` / `tauri build` do NOT run `setup-vendors`. Local builds reuse whatever stale `public/vendor/pdfjs/` is already on disk (gitignored — `/public/vendor`). The dev's local copy was the old 5.4.530 worker (pure-JS JBIG2) → worked. CI runs `setup-vendors` fresh (release.yml:192) → ships the new 5.7.284 worker that needs jbig2.wasm → broke.

**Fix:** changed `copy-pdfjs-wasm` to copy the whole `wasm/*` dir instead of an allow-list (mirrors the `{cmaps,standard_fonts}/*` fonts pattern). Robust against future codecs moving to wasm; also ships the `*_nowasm_fallback.js` files for graceful degradation. Regression test: `src/__tests__/document/pdfjs-wasm-assets.test.ts` asserts every `.wasm` the bundled pdf.js references is covered by `copy-pdfjs-wasm`.

**Gotchas for future:**
- Vendor assets in `public/vendor/` are gitignored and only refreshed by `setup-vendors`. Local stale vendor can mask CI breakage — `git status` won't show it.
- `cpx` allow-lists are fragile: any upstream-added required file is dropped silently. Prefer copying whole dirs.
- Related: [[platform-compat-fixes]], [[bug-patterns]].
