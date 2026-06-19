---
name: zindex-overlay-scale
description: Global overlay z-index scale; why Add-Catalog-behind-Settings was mobile-only (window-border trap); RSVP de-escalated from 10000
metadata: 
  node_type: memory
  type: project
  originSessionId: e7590344-aa6d-4bec-9b6d-6f3b93b18c87
---

RESOLVED — PR #4669 (merged 2026-06-19). Redesigned the overlay z-index scale (was: RSVP `z-[10000]`, Settings `!z-[10050]`,
ModalPortal `z-[100]`). Compact scale now, all clearing the desktop `.window-border`
page frame (`z-99` in `globals.css`):

- `100` RSVP immersive overlay (`RSVPOverlay.tsx`)
- `101` RSVP controls — start dialog + lookup chip (`RSVPStartDialog.tsx`, `RSVPOverlay.tsx`)
- `110` Settings dialog (`SettingsDialog.tsx`, `!z-[110]`)
- `120` modal / command palette (`ModalPortal.tsx`, `CommandPalette.tsx`)
- `130` toast (`Alert.tsx`)
- `200` app-lock (`AppLockScreen.tsx`, unchanged)

**Bug fixed:** "Add OPDS Catalog" dialog (a `ModalPortal`, opened via `CatalogManager
inSubPage` inside Settings → Integrations) rendered BEHIND the Settings sheet on mobile.
Root cause = regression from #3235, which raised Settings to `!z-[10050]` (to beat the
RSVP `z-[10000]` overlay for in-overlay dictionary mgmt) — that jumped Settings above the
`ModalPortal` layer (`z-[100]`), so any modal opened from inside Settings was buried.

**Why MOBILE-ONLY (non-obvious):** `Dialog` does NOT portal — `SettingsDialog` renders
inline inside `.reader-page` (`ReaderContent.tsx:273`). On desktop rounded-window,
`.reader-page` has `.window-border` (`z-99`, `position:relative`) = a stacking context
that TRAPS Settings at the `z-99` layer. `ModalPortal` uses `createPortal(document.body)`
→ escapes to body `z-100+` → already wins on desktop. On mobile `hasRoundedWindow` is
false → no `.window-border` → Settings' `z-10050` competes at body level and buries the
modal. So RSVP must stay **≥100** to cover the `z-99` frame on desktop (an early `z-[70]`
idea would have broken desktop RSVP).

**Invariant lock:** `src/__tests__/styles/zIndexScale.test.ts` reads the z values straight
from source and asserts MODAL>SETTINGS>RSVP_CTRL>RSVP>99, APP_LOCK>MODAL, and all <1000.
This static test would have caught #3235. Scale also documented in `DESIGN.md` §6 and a
comment block in `ModalPortal.tsx`.

**On-device verify recipe (Xiaomi fuxi):** release build has WebView debugging OFF (no CDP
socket). `pnpm dev-android` builds the RELEASE-signed APK with `--features devtools` and
`adb install -r` — same signing key (`65:2D:..`), replaces in place, KEEPS data, enables
`@webview_devtools_remote_<pid>`. Proof of the bug = `document.elementFromPoint(cx,cy)` at
the Add-Catalog modal-box center returns a Settings `<P>` (topInsideSettings:true); after
fix returns the Add-Catalog `FORM`. Drove UI via `adb shell input tap` (logical*3 = physical
on this 1080×2400/360×800 device) + stdlib-only CDP ws client at `/tmp/cdp.py`.
Related: [[android-cdp-e2e-lane]], [[cdp-android-webview-profiling]], [[tts-sync-paragraph-rsvp-3235]].
