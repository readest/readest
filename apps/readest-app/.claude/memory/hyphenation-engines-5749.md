---
name: hyphenation-engines-5749
description: "#5749 iOS hyphenation weak: WebKit uses sealed Apple CF lexicon, not TeX patterns; only fix is self-inserted soft hyphens (U+00AD)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 369259b7-adf0-424e-bd17-e6b217163dd6
  modified: 2026-08-17T05:38:50.977Z
---

Issue #5749 (continuation of #4529): iOS hyphenation far less aggressive than Chrome. Research posted 2026-08-17 in https://github.com/readest/readest/issues/5749#issuecomment-5312278202. Feature (soft-hyphen self-hyphenation) OPEN, not started.

**Engine dictionary differences:**
- WebKit iOS/macOS (WKWebView, ALL iOS browsers): `CFStringGetHyphenationLocationBeforeIndex` → Apple's sealed OS lexicon. Lookup-based: unknown words/proper nouns never break. NOT customizable, no API. Ignores `hyphenate-limit-chars`; only legacy `-webkit-hyphenate-limit-before/after/lines` (can only REDUCE aggressiveness). Explains Readest-iOS ≈ Apple Books.
- Blink (Chrome/Edge/Android WebView/WebView2): minikin + AOSP `.hyb` TeX patterns (Liang's algorithm) — generative, breaks ANY word. Mac CF backend REMOVED, so Chrome-mac beats Safari-mac. Desktop dicts via component updater (Electron has NONE — check WebView2 has them). Supports `hyphenate-limit-chars` (109+).
- Firefox: bundled TeX patterns via mapped_hyph; needs `lang`.
- WebKitGTK (Linux Tauri): libhyphen + `/usr/share/hyphen/` — the ONE customizable platform (no dict installed = no hyphenation at all).

**Path forward:** BookFusion-quality = run TeX-pattern hyphenator in JS (e.g. Hyphenopoly, ~70 langs, configurable leftmin/rightmin) and insert U+00AD; engines honor it via default `hyphens: manual`. COST: U+00AD shifts text offsets → CFI annotations, search, TTS marks, copy/translation all need normalization. Nothing in src/ or foliate-js handles ­ today (only [[bug-patterns]] #1553 Android hyphen selection workaround in sel.ts is hyphen-aware).

**Cheap win:** `style.ts` getParagraphLayoutStyles sets `-webkit-hyphenate-limit-before: 3`; WebKit default is 2, so our CSS makes iOS MORE conservative than stock Safari. Relax to 2 when hyphenation enabled.

**Why:** engine-dictionary internals are not discoverable from the repo; avoids re-research when implementing.
**How to apply:** when implementing #5749, start from soft-hyphen injection + offset normalization; do not look for a CSS-only fix (none exists on WebKit).
