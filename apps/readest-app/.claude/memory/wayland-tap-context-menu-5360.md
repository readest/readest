---
name: wayland-tap-context-menu-5360
description: "#5360/#5181/#5041 Wayland two-finger-tap kills native GTK context menu; fix = in-app menu on Linux"
metadata: 
  node_type: memory
  type: project
  originSessionId: 35f7577d-29e3-492f-83f6-b154ca92acb9
  modified: 2026-08-03T14:41:01.999Z
---

**#5360 (dup #5181/#5041): library context menu flashes and vanishes on GNOME Wayland when opened by touchpad two-finger TAP.** Physical press/mouse work; X11 works. Fix MERGED #5467 (2026-08-03): render the menu in-app on Linux desktop instead of popping the native GTK menu.

**Why (two distinct defects, both evidence-backed):**
1. **Pre-#5182 (≤0.11.18):** positionless `menu.popup()` made muda anchor `gtk_menu_popup_at_rect` to `screen().root_window()` — no Wayland parent → GDK fell back to mapping the menu as an `xdg_toplevel`. Reporter's terminal video shows the smoking gun 3×: `Gdk-WARNING: Couldn't map as window 0x… as popup because it doesn't have a parent`.
2. **Post-#5182 (0.11.20):** frame extraction of the reporter's video (ffmpeg + magick compare on adjacent frames) proves the menu now maps as a real `xdg_popup` at the correct pointer position, fully rendered, then vanishes within ≤2 frames (~66 ms) with zero further input. Verified against mutter 46 + GTK 3.24 sources: the grab serial check passes for a tap (mutter `grab_serial` = press serial, persists after release; GDK passes `press_serial`), and no compositor path dismisses a granted popup grab without input — so the popdown is client-side (GTK menushell/muda), tap-specific because the popup path (JS → 2 window queries → Tauri IPC → muda → GTK) always loses the race against a tap's instant BTN_RIGHT release. Not fixable from the app while using GTK3 menus.

**Fix:** `BookshelfItem` branches on `appService.isLinuxApp` (inside `hasContextMenu`): Linux → `BookContextMenuPopup` (in-app, ModalPortal + Overlay + Menu/MenuItem primitives, viewport-clamped at pointer, first menuitem focused so Escape works); macOS/Windows keep the native cached `Menu.new` path. Item lists share one builder (`buildBookMenuItems`/`buildGroupMenuItems`, `BookContextMenuItem = {text, action}` is assignable to Tauri `MenuItemOptions`).

**Gotchas:** the bookshelf item wrapper always carries a `scale-100/95` transform → `position:fixed` inside it is item-relative, ModalPortal is mandatory. Standalone `dropdown-content` needs `!relative` (ImportMenuPopup precedent, [[bookshelf-import-menu-popup-5247]]). muda's GTK popup uses a synthetic ButtonPress with only the time stamped — that hack survives held-button releases, not taps.

**Debug technique that cracked it:** download the reporter's GitHub video attachments, `ffmpeg -i` extract frames, `magick compare -metric AE` adjacent frames to find the flash, Read the frames as images. Terminal-recording videos can contain the decisive warning text.

Device verify on a real Wayland box PENDING (no Linux hardware in the session).
