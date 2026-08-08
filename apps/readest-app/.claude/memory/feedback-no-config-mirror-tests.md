---
name: feedback-no-config-mirror-tests
description: "Do not write a 'unit test' that just asserts a literal is present in a config file it reads — chrox calls those useless; test behavior or validate with the real toolchain instead"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e4588a1f-b5f1-488d-808e-c68a581a17b5
  modified: 2026-08-08T08:16:46.194Z
---

When fixing the missing `core:window:allow-set-title` ACL grant (2026-08-08) I
opened with a test that read `src-tauri/capabilities/default.json` and asserted
`expect(grantedIdentifiers).toContain('core:window:allow-set-title')`. chrox cut
it immediately: **"No unit tests in ..., it's useless."** Deleted it; the
one-line capability fix shipped on its own.

**Why:** the assertion is the config restated in TypeScript. It reads the very
file the fix edits, so it can only fail if someone deletes the line it mirrors —
it exercises no code, cannot catch the class of bug it claims to guard, and adds
a file to keep in sync forever. Test-first is about a test that *reproduces the
defect*; a config-mirror test reproduces nothing.

**How to apply:**
- Config/manifest correctness → verify with the real toolchain, not vitest.
  For Tauri capabilities that's `cargo check -p Readest`: `build.rs` hard-errors
  on an unknown permission identifier. See [[window-title-book-name-a11y-5547]].
- Write a unit test when there is *behavior* to pin. Contrast the same session's
  highlight-swatch fix: rendering `HighlightOptions` and asserting the marker
  swatch's `backgroundColor` tracks the selected color is a real test — it
  failed red on the hardcoded yellow and drove the fix.
- The pre-existing `capability-external-cache-scope.test.ts` looks like a
  counter-example but is not: it asserts an *absence* over a whole permission
  family (no `$CACHE`-carrying identifier may appear), which no single line
  mirrors.
- Not every fix needs a new test file. A one-line config change verified by the
  build is complete.

Related: [[feedback-no-mock-only-platform-tests]] (same root instinct — a test
that cannot observe the real failure mode is not worth its file).
