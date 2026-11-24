---
name: android-lookup-app-picker-4937
description: "#4937 Android System Dictionary → Lookup App picker; old get/clear_lookup_dictionary were unreachable (no Rust command); HyperOS chain-start prompt"
metadata:
  node_type: memory
  type: project
  originSessionId: bff1fcb2-088e-48e2-87e5-02b348985db9
  modified: 2026-11-02T18:30:39.065Z
---

#4937 (vivo PD2520 reporter: "system dictionary still redirects to the browser" after #4568). Branch `feat/android-system-dictionary-app`, worktree `readest-feat-android-system-dictionary-app`, MERGED #7272 as 263d76cb1 on 2026-11-03, UNRELEASED. Option labelled "Default" (not "Ask Every Time") after CodeRabbit; a forced ask-every-time mode would undo #4559 remember-the-pick, so it is left to the owner. Worktree removed.

- Settings → Language → Manage Dictionaries → **System Dictionary → Lookup App** (Android only, hidden when no handler): "Ask Every Time" + every non-browser `ACTION_PROCESS_TEXT` handler (activity label, so Baidu shows 百度搜索 + 百度翻译 separately). Stored in the same prefs as the chooser memory ([[dict-lookup-browser-hijack-4559]]).
- `decideLookupDispatch` now honours the saved app first, even when no browser is among the handlers. Before, the memory only counted in the browser + ≥2-dictionaries case.
- **Root bug found:** `get_lookup_dictionary`/`clear_lookup_dictionary` (#4568) had only Kotlin + build.rs entries, no Rust `#[command]`. Tauri then forwards to the mobile plugin as camelCase (`getLookupDictionary`) → "No command ... found". So the Reset row never appeared in 0.11.9–0.12.16. Any Android plugin command must be wired through commands.rs/mobile.rs/desktop.rs/lib.rs.
- Xiaomi 13 HyperOS 3: Baidu searchbox registers PROCESS_TEXT but is NOT a browser by the https VIEW probe (only Chrome is). The first explicit launch of another app triggers MIUI "Chain start: Allow Readest to open Eudic?" (`com.miui.securitycenter/.wakepath.ui.ConfirmStartActivity`), which is OS behaviour and not ours.
- Fuzzy matching for imported dictionaries (issue item 2) is NOT done; it was left for its own PR.

**How to apply:** for "dictionary opens browser/search app" reports, point users to the Lookup App picker once it ships.
