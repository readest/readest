---
name: arch-cef-package-launch-crash-6144
description: "#6144 two bugs: 0.12.8 AppImage panics for EVERYONE (libxkbcommon-x11 missing, MERGED #6151 54f2ba7d6, UNRELEASED) + Arch extra CEF package SIGSEGV on CachyOS (not reproducible on stock Arch; needs backtrace); Arch container repro recipe inside"
metadata:
  type: project
---

Issue #6144 (2026-09-08): `readest` 0.12.8 dies with SIGSEGV right after the
`tauri_runtime_cef ... derived profile hash` log line on CachyOS (X11, winit
scale 1.3958). The reporter runs the **Arch `extra` package** (svenstaro,
built 2026-09-07 from the v0.12.8 tag with `pnpm tauri build -b deb`, i.e. the
CEF runtime via npm `@tauri-apps/cli-cef@3.0.0-alpha.26`); CachyOS's own
v3/v4 repos only had a 0.12.6 rebuild. 0.12.8 is the first CEF build Arch has
shipped (0.12.6 was WebKitGTK).

**Verified (container A/B, 2026-09-08):** the same `readest-0.12.8-1` package
and the official amd64 deb both launch fine on stock Arch under Xvfb, also
with `WINIT_X11_SCALE_FACTOR=1.3958333333333333`. `libcef.so`/icudtl/v8
snapshot/paks are byte-identical between Arch and the official deb (makepkg's
strip only moved the ELF section table, same build ID). Same rustc 1.98.1 on
both. So the crash is machine-specific, not the package: suspect a CachyOS
x86-64-v3 rebuilt system lib CEF loads (glibc, glib2, gtk3, nss, mesa/libgbm,
libxkbcommon, cairo, pango) or the GPU stack; tauri-apps/tauri#15457 was the
same signature on CachyOS fixed by reinstalling a lib from Arch `extra`.
**Root cause UNCONFIRMED until the reporter posts `coredumpctl gdb` output.**

**Bug 2, confirmed and MERGED (#6151 = 54f2ba7d6, 2026-09-08; ships with the next release):** the 0.12.8 AppImage
panics on every launch before any log line: `Library libxkbcommon-x11.so
could not be loaded` (xkbcommon-dl 0.4.2 x11.rs:59). winit-x11 0.31
`EventLoop::new` calls `Context::from_x11_xkb`, which dlopens
`libxkbcommon-x11.so.0`; the CEF runtime forces X11 even on Wayland, and
sharun never falls back to host libs. quick-sharun's Chromium rule
(DEPLOY_COMMON_LIBS) lists the lib but the ubuntu-22.04 runner has no
`libxkbcommon-x11-0` installed and the globs skip silently (STRACE_MODE=0
also kills dlopen discovery). Fix = apt install + explicit
`appimage.files` entry + verify-step check in release/nightly/try-appimage
workflows. RULE: any dlopen'ed lib (winit, Chromium) must be staged by hand
and verified; the strace pass is off.

**Side findings:** Arch's PKGBUILD `depends` and our own
`src-tauri/tauri.conf.json` deb/rpm `depends` still declare WebKitGTK and omit
CEF's real runtime libs (nss, nspr, libxkbcommon, alsa, cups, libgbm, atk,
atspi, libxcomposite/damage/randr/fixes, libdrm, expat, libudev); a minimal
system fails with `libnspr4.so: cannot open shared object file`.

**Why:** the Arch build path is now identical in outcome to ours, so
distro-package crash reports need a backtrace before any code change.

**How to apply:** Arch x86_64 container on this M-series Mac works via
OrbStack + Rosetta (`docker run --platform linux/amd64 archlinux`), but
pacman needs `--disable-sandbox` (seccomp fails under emulation), gdb cannot
ptrace there (use core dumps / plain runs), a v3 package would SIGILL (no
AVX2), and the base image lacks CEF's libs (install nss nspr libxkbcommon
alsa-lib libcups libdrm mesa at-spi2-core libxcomposite libxdamage libxrandr
libxfixes expat systemd-libs). Launch with `Xvfb :99` + `dbus-run-session`;
`timeout` exit 124 = still alive. The container and archlinux image were removed after the session; rebuild
from this recipe. Related: [[nix-android-avd-abi-5732]],
[[selfhosted-docker-6091-6093]].
