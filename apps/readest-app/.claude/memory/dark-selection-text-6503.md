---
name: dark-selection-text-6503
description: "#6503 selected word unreadable in dark mode: Chromium default selection forces near-black text; fix = dark-mode background-only ::selection; branch fix/dark-selection-6503, not device-verified"
metadata:
  type: project
---

Issue #6503 (Android, 0.12.10): the word held by a dictionary lookup shows dark text on blue/grey in dark mode.

**Root cause (reproduced on the Xiaomi 2026-09-30 over CDP).** Readest set `::selection` only for e-ink. A *programmatic* selection (what `suppressNativeSelectionHandles` / `restoreSelectionRange` re-add) falls back to Chromium's default colors: near-black text on blue when the iframe is focused, and on grey when it is not (the lookup popup has focus). A user-initiated native selection on MIUI used the system accent and kept the text color, so it looked fine.

**Fix.** `getDarkSelectionStyles(primary)` in `src/utils/style.ts` getColorStyles: `::selection { background: color-mix(in srgb, primary 40%, transparent) }`, dark mode and non-e-ink only. Checked in desktop Chromium (Playwright): **color-only `::selection` drops the background entirely**; background-only keeps each element's own text color (links, pdf.js's transparent text layer) and makes the focused and unfocused states look the same. The fixed-layout path (`applyFixedlayoutStyles`) was left alone.

Status: branch `fix/dark-selection-6503` in worktree `/Users/chrox/dev/readest-fix-dark-selection-6503`, MERGED #6512 (78d9b5fd3) 2026-10-01, UNRELEASED; fix Chrome-VERIFIED 2026-10-01 in a real dictionary lookup (web dev server, dark theme); NOT checked on Android (another session was using the phone). macOS Chrome keeps the text color by default (unfocused selection = near-black box), so the dark-text symptom is Android-only.

Related: [[instant-lookup-restore-selection-6213]], [[lookup-surface-flash-suppress-handles-6013]]
