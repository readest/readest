---
name: annotation-export-macos-save-button-6201
description: "#6201 macOS annotation export only opened the share sheet; fix = Share + Save buttons on macOS in ExportMarkdownDialog, Export elsewhere"
metadata:
  type: project
---

Issue #6201 (reopened from #6187): on macOS the annotation export dialog's single Export
button called `saveFile({ share: true })`, which on macOS routes to NSSharingServicePicker,
so the file could only be sent to another app, never saved to disk.

Fix (branch `fix/6201-macos-export-save`, worktree `readest-fix-6201-macos-export-save`,
2026-09-18): `ExportMarkdownDialog` shows Share (ghost) + Save (primary) when
`appService.isMacOSApp`, a single Export elsewhere; `onExport` now takes
`{ share, sharePosition }` and `Annotator.handleConfirmExport` forwards `share` to
`saveFile`. The macOS early-return that suppressed the toast is now `share && isMacOSApp`
so a Save-panel save still confirms. Status: implemented + unit-tested + macOS dev-build
VERIFIED 2026-09-18 (Save -> NSSavePanel wrote The Hobbit.md + toast; Share -> picker popover
above the button); MERGED #6260 (4dcfbd1a3) 2026-09-18; worktree removed.

**Why:** macOS is the only platform with both a system share sheet and a native Save
panel. iOS/Android share sheets include Save to Files; Windows/Linux never share
(#4343); web downloads. chrox's direction was a separate Save button alongside Share.

**Verifying a macOS Tauri dev build with desktop control:** `pnpm tauri dev` runs a bare
`target/debug/Readest` with NO bundle identifier, so the computer-use allowlist (keyed on
`com.bilingify.readest`) hides its window and blocks clicks. Recipe: `pnpm tauri dev --config
'{"build":{"devUrl":"http://localhost:3001","beforeDevCommand":"pnpm dev -p 3001"}}'` (3000 is
usually taken by another worktree), let cargo finish, kill it, copy `target/debug/Readest` into
`<scratch>/ReadestDev.app/Contents/MacOS/` with a minimal Info.plist carrying the identifier,
run `pnpm dev -p 3001` separately and `open` the bundle (devUrl is compiled in). It shares the
real library/settings. Terminal `screencapture` is black (no Screen Recording grant); if the
tool's screenshot returns nil after a long pause, a screen-consent card is pending for chrox.
Next 16 forwards browser console lines to the dev log as `[browser]`.

**How to apply:** `ImageViewer.handleSaveImage` has the same macOS share-only shape
(`share: true` unconditionally) and is a candidate for the same treatment. Any new
`saveFile({ share: true })` caller on macOS should offer a save path too. See
[[layout-ui-fixes]] for other export/share UI notes.
