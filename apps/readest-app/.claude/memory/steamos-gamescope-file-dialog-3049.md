---
name: steamos-gamescope-file-dialog-3049
description: "#3049 SteamOS Gaming Mode: import dialog never appears — gamescope session has no FileChooser portal backend; fixed with info toast (MERGED #5475); in-app browser rejected, chooser IS the scope-grant security model"
metadata: 
  node_type: memory
  type: project
  originSessionId: 99db45a5-e590-4336-b798-a10f50869721
  modified: 2026-08-03T17:05:38.968Z
---

Issue #3049 (open, reported 2026-01-24, researched 2026-08-04): Readest Flatpak added to Steam as non-Steam app; "Import Books" does nothing in SteamOS Gaming Mode, works in Desktop Mode.

**Root cause (not a Readest bug per se):**
- Dialog chain: `useFileSelector.ts` `selectFileTauri` → `nativeAppService.ts:757` `openDialog()` → tauri-plugin-dialog 2.7.1 → rfd 0.16 **gtk3 backend** (`GtkFileChooserNative`; no ashpd in Cargo.lock — the `xdg-portal` feature is NOT enabled).
- Flathub manifest (sibling checkout `/Users/chrox/dev/com.bilingify.readest/com.bilingify.readest.yml`) has **no `--filesystem=` entries** — all host file access flows through the FileChooser portal (GtkFileChooserNative auto-delegates to portal when sandboxed).
- Gaming Mode's gamescope session runs no portal backend → `org.freedesktop.portal.FileChooser` interface absent (same wall UnleashedRecomp PR #1437 hit). Dialog yields nothing; JS gets `null` = **indistinguishable from user cancel** (`page.tsx:1206` silently no-ops). So env detection, not error handling, is the trigger.

**Dead end:** falling back to `selectFileWeb` (`<input type=file>`) does NOT dodge it — WebKitGTK's file chooser is also GtkFileChooserNative → same portal → same failure.

**Decision (chrox, 2026-08-04): info toast only.** In-app file browser REJECTED — Readest's security model deliberately relies on the system chooser to add the picked paths to the fs access scope; a manifest `--filesystem` grant would defeat it. Upstream fix (Valve shipping a portal backend in the gamescope session): no sign of it.

**MERGED #5475** (2026-08-04, squash ba6e1fcb3; worktree and branch cleaned up): `useFileSelector.selectFileTauri` checks `isLinuxApp` + gamescope (existing `get_environment_variable` command — no Rust change needed; `GAMESCOPE_WAYLAND_DISPLAY` set OR `XDG_CURRENT_DESKTOP` contains "gamescope") and dispatches an info toast BEFORE opening the dialog (robust whether the portal call errors or hangs). Covers books/fonts/dictionaries/covers; `selectDirectory` (auto-import folder picker) NOT covered. i18n key translated across all 33 locales. Root-cause comment posted: issue #3049 comment 5169305873.

Flatseal `--filesystem=home` alone does NOT fix it — GTK still portals when sandboxed. Non-flatpak builds (AppImage/deb) likely work in Gaming Mode (unsandboxed → in-process GTK dialog).

Related: [[book-actions-platform-surfaces]], [[wayland-tap-context-menu-5360]] (Linux windowing quirks).
