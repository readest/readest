---
name: android-lookup-app-reset-vivo
description: "Android \"can't change system dictionary app\" support answer — vivo/iQOO choice lives in Readest, not Android defaults"
metadata:
  node_type: memory
  type: project
  originSessionId: c3a27c49-c096-4a16-b616-03e7952a868e
  modified: 2026-10-10T05:38:25.799Z
---

Android system-dictionary handoff (`show_lookup_popover`, `decideLookupDispatch` in tauri-plugin-native-bridge) stores the chosen app in one of two places:
- **No browser handles PROCESS_TEXT** (Xiaomi HyperOS, stock): plain implicit intent; an "Always" tap is an Android preferred activity. Clear via Settings → Apps → <dict app> → Clear defaults (HyperOS: directly on App info under Advanced settings; AOSP: Open by default → Other default preferences). Verified 2026-10-10 on Xiaomi HyperOS 3 / Android 16.
- **OEM browser handles PROCESS_TEXT** (vivo/iQOO OriginOS, #4559): Readest's browser-excluding chooser remembers the pick in its own prefs; Android's page shows "无默认设置/No defaults set" with Clear greyed out. Reset = Readest Settings → Dictionaries → bottom → System Lookup App → Reset (v0.11.9+). Seen 2026-10-10 from an iQOO 11 / Android 14 reporter.
- Browser + only ONE dictionary → launched directly, nothing remembered, no Reset row; the wanted app likely lacks PROCESS_TEXT.

**Why:** users (and first-pass answers) go to Android defaults, which are empty on vivo.
**How to apply:** ask phone brand first; for vivo/iQOO point to the Readest Reset row.
