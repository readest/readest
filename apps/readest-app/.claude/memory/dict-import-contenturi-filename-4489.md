---
name: dict-import-contenturi-filename-4489
description: "Android dict import \"incomplete bundle\" — ext-less content URIs; classify used getFilename (string) not basename (content resolver)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 92f1011c-89b9-4ae1-b128-f24cfb4462a8
---

#4489 / #4472: importing a StarDict bundle (`.ifo`+`.idx`+`.dict.dz`) on **some** Android
devices fails with "Skipped incomplete bundles"; works on Xiaomi/Boox and web.

**Root cause — two filename resolvers diverged.** Tauri's Android `path.file_name`
(used by `basename`) special-cases `content://`/`file://` URIs and calls the native
`getFileNameFromUri` plugin → **content resolver DISPLAY_NAME** (real filename WITH ext).
See `tauri-2.11.2/src/path/android.rs`. Our `getFilename()` (`src/utils/path.ts`) is pure
JS string-parse of the URI. On devices whose SAF URI is an **opaque ext-less document id**
(e.g. `content://com.android.providers.downloads.documents/document/msf%3A20`), getFilename
→ `msf%3A20` (no ext) while basename → `21cen.dict.dz`. Working devices return
`primary%3ADictionaries%3A21cen.dict.dz` (ext in the URI) so getFilename happens to work.

The OLD `selectFileTauri` extension filter ALREADY used `basename` (so files passed the
filter and got imported), but **threw the resolved name away** and returned the raw URI.
Then `dictionaryService.classify()` re-derived the name with `getFilename()` → no ext →
every file orphaned → "incomplete bundle". The bug is the divergence, not the picker.

**Fix (PR for #4489):**
- `SelectedFile.name?: string` added (`useFileSelector.ts`).
- `resolveTauriFileName(path, appService)`: `basename` for `content://` / iOS `file://`,
  else `getFilename` — resolved ONCE in `selectFileTauri`, reused by the ext filter AND
  stored on `SelectedFile.name`. Removed `processTauriFiles`.
- `classify()` (`dictionaryService.ts`): `source.file?.name ?? source.name ?? getFilename(path)`.
- Test: `groupBundlesByStem.test.ts` — ext-less content URIs + `name` form a complete bundle.
- Also fixes #4472 issue 3 (uploaded dict files renamed to the SAF dir path).

**Emulator repro (real granted URI, no rebuild needed):** drive SAF picker → "Downloads"
location → returns `content://...downloads.documents/document/msf%3A<id>` (ext-less).
basename resolves the real name ONLY for granted URIs (synthetic URIs → "path does not have
a basename"). Verified via CDP `invoke('plugin:path|basename',{path,ext:null})`. See
[[cdp-android-webview-profiling]] for the CDP harness (`src/__tests__/android/helpers/`).

**Also fixed same turn:** e-ink "black spot" on the Settings→Dictionaries `+` badges
(Import Dictionary / Add Web Search) — add `eink-inverted` to the round badge span, mirroring
the font import button #4454 (`globals.css` `[data-eink] .eink-inverted` → base-content bg +
base-100 icon).
