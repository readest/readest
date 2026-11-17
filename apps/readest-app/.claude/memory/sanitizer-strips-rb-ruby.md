---
name: sanitizer-strips-rb-ruby
description: "The book sanitizer (DOMPurify) unwraps <rb>, so rb-shaped ruby bugs only reproduce in the app with Allow JavaScript on"
metadata:
  node_type: memory
  type: project
  originSessionId: a87c8e97-35ba-4099-9bb7-b252eed33e1e
  modified: 2026-11-10T16:45:01.539Z
---

`sanitizerTransformer` (src/services/transformers/sanitizer.ts) runs DOMPurify on every section unless the book's `allowScript` (Settings → Behavior → Allow JavaScript) is on. DOMPurify's default allowlist has no `rb`, so `<ruby><rb>漢字</rb><rp>（</rp><rt>かんじ</rt>…` reaches the DOM as `<ruby>漢字<rp>…` (text kept, element gone) in both Chromium and WebKit.

**Why:** found verifying PR #7405 (2026-11-10). Its unit fixture with `rb` made four translation requests on main, but in the app that happened only with Allow JavaScript on. With default settings the bug that showed was a reading-only `<ruby><rt>`.

**How to apply:** when a ruby/`rb` bug reproduces in a jsdom unit test, repro it in the app with Allow JavaScript both off and on before saying what users actually see. To capture translation payloads on dev-web, use a fresh signed-out Playwright context (the user's Chrome library is synced), import via the filechooser, click the "Enable Translation" button, and log `translate.googleapis.com` `q=` params. Signed out, the app falls back from DeepL to Google.
