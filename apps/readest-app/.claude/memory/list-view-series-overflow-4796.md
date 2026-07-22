---
name: list-view-series-overflow-4796
description: "Library list view series + description text overlapped/clipped under fixed h-28, worsened by Android system font scaling"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8645710b-673d-422a-ad8a-e3f385057f49
---

PR #4799 (branch `fix/list-series-overflow-4796`). Reported on Pixel 10 Pro / Android 16: in library **list view**, a book that belongs to a series shows its series line and description preview overlapping and cut off.

**Root cause:** `BookItem.tsx` list-mode container used a fixed `h-28` (112px) with `overflow-hidden`. The right column stacks title + authors + (optional) series + description + a progress/actions row (`useResponsiveSize(15)` → ~19px on phones). Without a series it fits 112px; the optional series line (added in #4593/#4612) pushes the total over 112px, so the lines collide and clip. **Android applies the system accessibility font-size scale to WebView CSS text**, inflating line heights — that's what made it bad enough to report (matched the issue screenshot at ~130% scale).

**Fix:** `h-28` → `min-h-28` (one class). Row grows to fit; non-series rows keep 112px. List is `Virtuoso` with measured (not fixed) heights, so variable row heights are fine.

**Verification:** jsdom can't measure layout, so reproduced the exact flex markup in a real browser at normal + 130% font scale (before = overlap, after = clean). Lint + full `pnpm test` (6324 pass) + `format:check` pass.

Lesson: fixed-height list/card rows are fragile against optional metadata lines AND user font scaling. Prefer `min-h-*` when the row can virtualize. Related: [[cover-stale-inplace-mutation-memo]].
