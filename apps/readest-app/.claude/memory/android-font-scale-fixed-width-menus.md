---
name: android-font-scale-fixed-width-menus
description: "Android system font_scale multiplies every CSS font-size uniformly (WebView text zoom) but not fixed w-* menu boxes, so labels wrap and menus outgrow the landscape viewport"
metadata: 
  node_type: memory
  type: project
  originSessionId: de39490e-b684-4a0d-bed2-7d92e8295f49
  modified: 2026-08-02T08:23:32.534Z
---

Reported 2026-08-02 as "search options dropdown is huge / wraps" on Xiaomi 13 (fuxi). MERGED #5434 (b1ec4f5e9), fixing `LibrarySearchOptionsMenu.tsx` + reader `sidebar/SearchOptions.tsx`. Verified via CDP class-injection on device, NOT a rebuilt APK.

**Not font boosting.** Android WebView applies the system font size setting (`adb shell settings get system font_scale` = 1.25 here) as a **uniform text zoom**: every declared size scales exactly — 10→12.5, 14→17.5, 16→20, 20→25, `html`/`body` included. `-webkit-text-size-adjust` was `100%` and irrelevant. Don't chase text-autosizing/`text-size-adjust`; measure `getComputedStyle` for a declared-vs-computed control pair to tell uniform zoom from per-cluster boosting.

**The real bug:** a hard-coded `w-56` (224px) box does NOT scale with text zoom. At 1.25 the label column offered only 154px, so "Regular Expression" wrapped to 2 lines (row 46→76px), menu 382px tall, and with no `overflow-y-auto` the bottom item was unreachable in landscape (overflowed viewport bottom by 46px).

**Fix:** drop the fixed width (`:where(.dropdown-content)` in globals.css already gives `width:max-content` + `max-width:calc(100vw-32px)` at zero specificity, so removing `w-56` is enough), add `whitespace-nowrap` to label spans, add `max-h-[calc(100vh-96px)] overflow-y-auto`. Verified on-device: 250px wide, 0 wrapped rows, landscape clamps to 296.7px and actually scrolls.

**Gotcha — do NOT reuse `components/Menu.tsx` for a bordered menu.** Its base includes `border-0`, and in the built CSS `.border-0` is emitted AFTER `.border` (checked byte offsets in `.next/static/chunks/*.css`), so it silently kills a light-theme 1px border. E-ink survives only because `.eink-bordered` uses `!important`. `Menu` is still the right reference for the scroll contract (`max-h-[calc(100vh-96px)] overflow-y-auto`) + Escape/Android-Back via `useKeyDownActions`.

CDP note: rebuild the ws URL as `ws://127.0.0.1:9222/devtools/page/<id>` and send **no** `Origin` header — DevTools 403s handshakes that carry one. See [[cdp-android-webview-profiling]].
