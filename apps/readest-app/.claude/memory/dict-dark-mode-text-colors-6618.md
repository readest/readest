---
name: dict-dark-mode-text-colors-6618
description: "#6618 dictionary text unreadable in dark mode; computed-color lift (liftDarkTextColors) MERGED #6622 (d519216ca) UNRELEASED; not device-verified"
metadata:
  node_type: memory
  type: project
  originSessionId: 4b09ce25-a263-41a9-a791-794b09b3a74f
  modified: 2026-10-04T15:53:17.950Z
---

#6618: dictionary entries are authored for a light page, so dark text vanishes on the dark popup. Contributor PR #6622 rewrote `color:` in bundled CSS only; reworked by chrox+Claude and MERGED 2026-10-04 as d519216ca, UNRELEASED, not device-verified.

- Fix = `liftDarkTextColors(root)` in `src/utils/style.ts`, called in dark mode by MDict (on the shadow body) and the StarDict/BGL/slob HTML renderers. It reads COMPUTED colors (covers `<font color>`, inline style, embedded `<style>`, any syntax) and mirrors perceived brightness with an equal shift on every channel (keeps hue + shade order). Skips text on light boxes, and seeds the root from the first opaque ancestor background, crossing the shadow host.
- Why stylesheet rewriting fails: Longman Phrasal Verbs has NO CSS, only `<font color=darkgreen|darkblue|firebrick|gray>`. A fixed lift toward white flips hierarchy (black body ends up darker than #757575 secondary text).
- CodeRabbit "lift only near-grayscale colors" was declined: dark saturated colors (navy, darkgreen, #032952) ARE the bug.
- Test: `src/__tests__/utils/dict-dark-colors.browser.test.ts` must be a browser test; jsdom can't compute `<font color>` or shadow-root styles.
- Visual-check recipe: real dictionaries are in `~/Documents/books/Dictionaries`. In ESM tsx, js-mdict needs `new MDX(new FileScanner(path), path)` and an `fflate` symlink in `packages/js-mdict/node_modules`. The element must be attached to the document before calling getComputedStyle. `page.screenshot` paths must be inside the project (Vite fs.strict).
- PR screenshots are hosted on orphan branch `pr-6622-screenshots` on chrox/readest-app. Deleting it breaks the merged PR's images.
- `worktree:new` fails with "not our ref" on a foliate-js pin when the main checkout's `packages/foliate-js` is stale. Fix: `git -C packages/foliate-js fetch origin`, then remove and recreate the worktree.
