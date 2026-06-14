# Word Wise — runtime gloss-pack delivery (R2) + Language-panel placement

**Date:** 2026-06-14 · **Status:** Design (pending review) · Branch `feat/word-wise`
**Extends:** `2026-06-14-word-wise-design.md` (the gloss/render/CFI pipeline is unchanged).

---

## 1. Goal

Stop bundling gloss packs into the app. Keep them version-controlled in-repo as the source of
truth, mirror them to `cdn.readest.com` (R2), and **download on demand** into durable local
storage the first time a (book-language → hint-language) pair is needed. Make the pipeline
**multi-pair** so tiers 0–2 ship as data drops now and tier 3 later, and move the Word Wise UI
into **Settings → Language** with an explicit **hint-language** selector.

This PR delivers the **infrastructure + generalization**, routed end-to-end through the existing
EN↔中文 packs. Adding each further pair (es→en, en→es, fr→en, …) is then just "generate a pack +
manifest entry + sync" — no code change.

### Locked decisions
| | |
| --- | --- |
| Delivery | `https://cdn.readest.com/wordwise/…` (direct cross-origin fetch) |
| Download trigger | Auto-download with progress; best-effort prompt on metered connection; a global "auto-download" toggle |
| Hint language | Explicit selector (default = app UI language), limited to targets available for the book's source language |
| UI placement | Settings → Language → **Word Wise** `NavigationRow` → sub-page |
| Local storage | Durable `'Data'` base (not evictable `'Cache'`); managed in the Word Wise sub-page |

---

## 2. Repo layout — source of truth, never bundled

Move packs out of `public/wordwise/` (which is bundled into both the web deploy and the Tauri
installer) into a committed, **non-bundled** directory referenced only by build/sync scripts:

```
apps/readest-app/data/wordwise/            # committed; NOT under public/ or src/
  manifest.json                            # the index of available packs
  en-zh.v<hash>.json                       # content-hashed pack files (GlossIndexData shape)
  zh-en.v<hash>.json
  ATTRIBUTION.md
```

`data/wordwise/` is consumed by `build-wordwise-data.mjs` (writes packs + manifest) and
`sync-wordwise-r2.mjs` (uploads to R2). **No `*.json` under `public/wordwise/` ships** — delete it.
(`data/` is already used for committed non-bundled content like `src/data/demo`, but keep these at
the app root `data/`, outside `src/`, so bundlers never import them.)

### `manifest.json`
```jsonc
{
  "schemaVersion": 1,
  "packs": [
    { "pair": "en-zh", "source": "en", "target": "zh",
      "file": "en-zh.v8f3a1.json", "bytes": 2622655, "sha256": "8f3a1…", "entries": 30000 }
    // … one per available (source→target) pair
  ]
}
```
- `file` is content-hash-versioned → immutable URLs, trivial cache-busting.
- The app downloads a pack iff its local copy's recorded sha256 ≠ the manifest's.

---

## 3. Sync to R2

`scripts/sync-wordwise-r2.mjs` uploads `data/wordwise/*` (packs + `manifest.json`) to the
`cdn.readest.com`-backed bucket under `/wordwise/`. Run manually and in CI on release.
- Tooling: `wrangler r2 object put` (or the S3-compatible API). Bucket name + creds via env
  (`WORDWISE_R2_BUCKET`, Cloudflare token) — **not** the app's `wrangler.toml` (that bucket is the
  Next inc-cache; the CDN bucket is separate). Pack files use `cache-control: public, max-age=31536000, immutable`; `manifest.json` uses a short max-age (e.g. 300s) so new packs surface quickly.
- A `pnpm wordwise:sync` script wraps it.

---

## 4. Runtime: manifest → download → cache → load

New `src/services/wordwise/glossPacks.ts` (replaces the bundled-`fetch` path in `glossIndex.ts`):

```ts
export const WORDWISE_CDN_BASE = 'https://cdn.readest.com/wordwise';

export interface WordWisePack {
  pair: string; source: string; target: string;
  file: string; bytes: number; sha256: string; entries: number;
}
export interface WordWiseManifest { schemaVersion: number; packs: WordWisePack[]; }

// Session-cached; also persisted to 'Data' (manifest.json) for offline reuse.
fetchManifest(appService, opts?): Promise<WordWiseManifest | null>

// pick the pack for (source → hint) or null if none published.
resolvePack(manifest, source, hint): WordWisePack | null

// Ensure the pack file is in local 'Data'. Returns its stored path, or null.
// - if exists locally with matching sha → reuse (no network)
// - else download WORDWISE_CDN_BASE/<file> with onProgress, verify sha256, write to 'Data'
// - single-flight per pair (no concurrent double download)
ensurePack(appService, pack, onProgress?): Promise<string | null>

// High-level: manifest → resolvePack → ensurePack → readFile('Data') → GlossIndex.fromData
loadGlossIndex(appService, source, hint, onProgress?): Promise<GlossIndex | null>
```

- **Download mechanism:** reuse `downloadFile`/`webDownload`/`tauriDownload` from `src/libs/storage.ts`
  with `onProgress: ProgressHandler` (`{progress,total,transferSpeed}` from `utils/transfer.ts`).
  Store via `appService.writeFile(file, 'Data', arrayBuffer)`; check `appService.exists(file,'Data')`;
  delete via `appService.removeFile`. Web maps `'Data'`→IndexedDB (`webAppService.resolvePath`), so a
  ~3 MB JSON persists across sessions; Tauri writes to the app data dir.
- **Integrity:** verify sha256 of the downloaded bytes against the manifest before committing the
  write (discard + warn on mismatch).
- **Offline:** if a pack is already local, everything works offline. If not local and offline →
  `null` (no glosses) + a one-time toast ("Word Wise data unavailable offline").
- **Cache invalidation:** store a tiny sidecar (`<pair>.meta.json` or a row) recording the sha of the
  local pack; re-download when the manifest sha differs.

### `glossIndex.ts` / `wordwiseSection.ts` changes
- `getGlossIndex(lang, baseUrl)` → removed; callers use `loadGlossIndex(appService, source, hint, onProgress)`.
- `refreshSectionGlosses(doc, viewSettings, bookLang)` gains access to `appService` and the hint
  language (`viewSettings.wordWiseHintLang`), resolves `source = toWordWiseSource(bookLang)` and
  `hint = viewSettings.wordWiseHintLang || appUILang`, calls `loadGlossIndex(...)`. The generation
  guard, jieba gate, planner call, and DOM apply are unchanged.
- The cache in `glossIndex` becomes keyed by `pair` (source-hint), not just source.

---

## 5. Generalizing beyond en/zh (so tiers 1–3 are data-only)

- **Source languages:** `WordWiseSourceLang` broadens from `'en'|'zh'` to a general ISO-639-1 string.
  A source is *usable* iff (a) the manifest has a pack for (source→hint) **and** (b) we can tokenize
  it: **Latin/space-delimited** (en, es, fr, de, pt, it, …) via the existing regex tokenizer, or
  **Chinese** via jieba. Japanese/Korean are **blocked** until a segmenter ships (tier 3) — gate
  with a `canTokenize(source)` helper; unsupported source → no glosses (+ note).
- **Difficulty cutoffs (`difficulty.ts`):** generalize `getRankCutoff(lang, level)` to use a shared
  **frequency-scale** table for all frequency-ranked sources (en + other Latin langs all use a
  frequency rank), and the existing **HSK-scale** table only for `zh`. (Also fixes the current
  zh/cutoff mismatch found while testing: align the zh cutoffs to the HSK-derived ranks the build
  script emits, `level×3000`.)
- **Planner:** already routes `zh → jieba`, everything else → Latin tokenizer — no change beyond the
  broadened type.

---

## 6. Hint-language selector + Language-panel placement

- **Move the UI into `LangPanel.tsx`** (translation already lives there). Remove the dedicated
  `WordWise` tab: delete it from `SettingsDialog` `tabConfig` + render switch, drop `'WordWise'` from
  `SettingsPanelType`, remove the `panelIcons` entry in `commandRegistry.ts`, and remove the
  `PiTranslate` line from the `command-registry-extended.test.ts` mock. (Net deletion.)
- Add a **`NavigationRow` "Word Wise"** in `LangPanel` opening a sub-page that hosts the existing
  `WordWisePanel` content, expanded with the hint-language selector + downloads. (Sub-page over
  inline because the panel is already dense and Word Wise now has enable + slider + hint-lang +
  per-pack download/manage.)
- **Hint-language selector:** a `SettingsSelect` mirroring the "Translate To" row — options from
  `getLangOptions(TRANSLATED_LANGS)` filtered to targets the manifest offers for the current book's
  source language; value persisted as `viewSettings.wordWiseHintLang` via `saveViewSettings`.
  Default when unset = app UI language (`i18n.language` / `getLocale()`), falling back to
  `translateTargetLang`.
- **Download/manage UI:** under the selector, show the resolved pack with its size and state —
  "Download (2.6 MB)" / radial-progress while downloading (mirror `PublicationView`) / "Downloaded ·
  Delete". `removeFile` on delete. Success/failure via `eventDispatcher.dispatch('toast', …)`.
- **Auto-download:** new global `settings.globalReadSettings.wordWiseAutoDownload` (default `true`).
  When enabling Word Wise / opening a book whose pack isn't local: if auto-download is on and the
  connection isn't detectably metered, fetch silently with progress; otherwise surface the
  "Download (size)" affordance. Metered detection is **best-effort** via the Network Information API
  (`navigator.connection?.type === 'cellular'` / `saveData`) where available — absent on iOS/Tauri,
  so it simply falls through to auto.

### `WordWiseConfig` additions (`types/book.ts` + `constants.ts`)
```ts
export interface WordWiseConfig {
  wordWiseEnabled: boolean;
  wordWiseLevel: number;        // 1..5 (existing)
  wordWiseHintLang: string;     // '' = auto (app UI language)
}
// DEFAULT: { wordWiseEnabled:false, wordWiseLevel:3, wordWiseHintLang:'' }
```
(`wordWiseAutoDownload` is a global read-setting, not per-book.)

---

## 7. Data flow

```
enable WW / open book
  → source = toWordWiseSource(book.primaryLanguage); hint = viewSettings.wordWiseHintLang || appLang
  → loadGlossIndex(appService, source, hint, onProgress):
        manifest (session/'Data' cache) → resolvePack(source,hint)
          → exists in 'Data' & sha matches → read → GlossIndex
          → else (auto && !metered) download→verify→write('Data')→read→GlossIndex
          → else expose "Download (size)" in the panel
  → planGlosses → applyGlosses   (unchanged)
```

---

## 8. Testing (test-first)

- `glossPacks.test.ts` — `resolvePack` selection; `ensurePack` (a) reuses a present matching-sha
  local file without network, (b) downloads+verifies+writes when absent, (c) rejects on sha
  mismatch, (d) single-flights concurrent calls — using a fake `appService` (in-memory exists/read/
  write) and a stubbed downloader.
- `difficulty.test.ts` — extend: generalized frequency table applies to a non-en Latin source;
  zh cutoffs aligned to the build script's `level×3000` scale.
- Manifest round-trip: `build-wordwise-data.mjs` emits a `manifest.json` whose sha256/bytes match the
  written pack (unit test on the manifest-writing helper with a synthetic pack).
- Existing planner/ruby/CFI/TTS tests unchanged and green.
- Browser: enabling Word Wise with a stubbed CDN serves a pack → glosses render; delete removes the
  local file and glosses stop.
- Full `pnpm test` + `pnpm lint` green.

---

## 9. File change list

**New:** `src/services/wordwise/glossPacks.ts` (+ test); `scripts/sync-wordwise-r2.mjs`;
`apps/readest-app/data/wordwise/{manifest.json, *.json, ATTRIBUTION.md}`; a `WordWiseSubPage`/panel
under `src/components/settings/`.

**Modified:** `src/services/wordwise/{glossIndex.ts → folded into glossPacks, types.ts, difficulty.ts}`;
`src/app/reader/utils/wordwiseSection.ts`; `src/app/reader/components/FoliateViewer.tsx` (pass
`appService` + hint lang; route progress to a toast/indicator); `src/types/book.ts` +
`src/services/constants.ts` (`wordWiseHintLang`, `WORDWISE_CDN_BASE`, default + `wordWiseAutoDownload`);
`src/components/settings/LangPanel.tsx` (NavigationRow + sub-page mount + hint-lang selector +
download/manage); `src/components/settings/SettingsDialog.tsx` + `src/services/commandRegistry.ts` +
`command-registry-extended.test.ts` (remove the dedicated tab); `scripts/build-wordwise-data.mjs`
(emit `data/wordwise/` + `manifest.json` with sha/bytes/hashed filenames); delete `public/wordwise/*`.

---

## 10. Phasing

1. **Manifest + build/sync**: build script writes `data/wordwise/` + `manifest.json` (hash/bytes);
   `sync-wordwise-r2.mjs`; delete `public/wordwise/`.
2. **Runtime download/cache** (`glossPacks.ts`) + refactor `glossIndex`/`wordwiseSection`/FoliateViewer
   to load via `appService` from `'Data'`, downloading on demand; tests.
3. **Generalization**: broaden source langs + `canTokenize` gate + generalized difficulty cutoffs.
4. **UI move**: LangPanel NavigationRow + Word Wise sub-page + hint-language selector + download/manage
   + auto-download toggle; remove the dedicated tab.

## 11. Risks / notes
- **Metered detection is unreliable** cross-platform → "prompt on cellular" is best-effort; the
  always-visible size + the global auto-download toggle are the real guardrails.
- **CDN base is hardcoded** (no env precedent) → add a single `WORDWISE_CDN_BASE` constant.
- **`'Data'` durability**: packs survive cache clears (good for offline); managed only via the Word
  Wise sub-page (not the generic Manage Cache), so deletion is explicit.
- **Out of scope:** generating tier-1/2/3 *data* (es/fr/de/… and ja/ko segmenters) — this PR ships the
  infra + en↔zh through it; further pairs are data drops + a manifest entry.
