---
name: linux-cef-only-runtime-6218
description: "#6205/#6218 MERGED 95117b03f: Linux is CEF on EVERY shipping path incl. Flathub since flathub#33; isLinuxCefRuntime deleted; deb/rpm depends were WebKitGTK which the CEF binary never links; tauri-plugin-webdriver is webkit2gtk-only so the E2E lane is the last wry build"
metadata:
  type: project
---

PR #6218 (contributor Berserker-GM, `fix/linux-pdf-theme-colors`), maintainer
commit `8a500d0e1`. **MERGED 2026-09-16 as `95117b03f`, UNRELEASED.** Closes
#6205 ("Apply Theme Colors to PDF" missing on Linux).

**The load-bearing fact: every shipping Linux build is CEF.** `pnpm tauri
build` -> scripts/tauri.mjs forces CEF for dev/build/bundle (release.yml,
nightly.yml, try-appimage.yml all use it), nix/package.nix sets
`buildFeatures = ["cef"]`, Arch `extra` builds with the CEF CLI, and **Flathub
switched in flathub/com.bilingify.readest#33 (2026-09-06), shipping CEF from
0.12.8 on**. So any `isLinuxCefRuntime(navigator.userAgent)` probe answers the
same way always — it was written in #6074 while `tauri:cef` was still opt-in,
and went stale inside that same PR when CEF became the Linux default.
The helper is now DELETED; `needsQueryRangeReads(osType)` and
`needsPointerWindowControls()` (via `getOSPlatform()`) key off the OS.

**Two WebKitGTK-era carve-outs died with it:**
- `supportsCanvasContext2DFilter` excluded ios+macos+linux because in #3915 that
  list meant "the WebKit engines". Now `OS_TYPE !== 'ios' && !== 'macos'`.
- `supportsViewTransitionsAPI`/`Group` had `OS_TYPE !== 'linux' &&`; the crash
  they avoided was WebKitGTK snapshotting the window. Now the bare probe.
- lib.rs's `GDK_BACKEND=x11` Wayland hack (#6098, written 16h AFTER flathub#33
  landed) targeted "non-CEF Linux builds such as Flatpak" — already dead when
  merged. Removed.

**deb/rpm `depends` were wrong and the fix is not a one-line delete.** Verified
by pulling the shipped `Readest_0.12.8_amd64.deb` and parsing DT_NEEDED: the
`readest` binary needs only libcef, libgtk-3, libgdk_pixbuf, libgio/glib/
gobject, libfontconfig, libc/m/gcc_s (RUNPATH `$ORIGIN`) — **libwebkit2gtk
appears nowhere**. But it was transitively pulling in most of what libcef.so
needs, so deleting it alone regresses a minimal system to
`libnspr4.so: cannot open shared object file` (the #6144 side-finding).
libcef.so's own DT_NEEDED minus what GTK 3 already drags in leaves:
**libnss3, libgbm1, libasound2, libudev1** plus **libxkbcommon-x11-0**, which
winit `dlopen`s (not in DT_NEEDED — it is the #6151 AppImage panic). That is
the new list, mirrored as `libX.so.N()(64bit)` sonames for rpm. Debian t64
packages `Provides:` the old names, so plain names are fine on trixie.
**NOT install-tested on any distro.**

**Blocker on "make CEF the only Linux variant":** `tauri-plugin-webdriver`
0.2.1's `platform/linux.rs` is `use webkit2gtk::{...}` and drives the wry
webview directly — there is no CEF backend. `scripts/test-tauri.sh` calls the
raw `tauri` binary (not the `pnpm tauri` wrapper) precisely for this, and the
`tauri_test` CI lane in pull-request.yml runs it on ubuntu with
`libwebkit2gtk-4.1-dev`. So `wry` must stay buildable on Linux until that
harness moves to CDP (`READEST_CDP_PORT` + scripts/cdp.mjs already exist under
CEF). `default = ["wry"]` in src-tauri/Cargo.toml was left alone for the same
reason.

**Not verifiable from macOS:** every `target_os = "linux"` cfg in lib.rs is
inert here, so `pnpm clippy:check` / `test:rust` green says nothing about the
Linux build. Needs a real `pnpm tauri build` on Linux plus a deb/rpm install
test. Related: [[arch-cef-package-launch-crash-6144]],
[[worktree-new-rebases-pr-force-push]], [[git-push-socks-proxy]].
