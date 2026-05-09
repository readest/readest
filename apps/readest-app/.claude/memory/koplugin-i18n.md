---
name: readest.koplugin i18n system
description: Custom gettext loader, .po catalog layout, and extract/apply scripts for the KOReader plugin at apps/readest.koplugin/
type: reference
originSessionId: 08cfd0cd-b710-4674-9c90-d2ae4827d071
---
The KOReader plugin (`apps/readest.koplugin/`) has its own gettext-based i18n system, parallel to but separate from the readest-app i18next setup.

## Loader

- File: `apps/readest.koplugin/i18n.lua` — isolated module, returns a callable table via `setmetatable({}, {__call = ...})`, so `_("msg")` syntax works as a drop-in replacement for `require("gettext")`. Provides `ngettext`/`pgettext`/`npgettext` too. Falls back to KOReader's native `gettext` for missing strings.
- All Lua sources do `local _ = require("i18n")` (not `require("gettext")`).
- **Never rename `i18n.lua` to `gettext.lua`** — it would shadow KOReader's module via `require("gettext")` and break the fallback chain (recursive require / never loaded).

## Catalog layout

- `apps/readest.koplugin/locales/<lang>/translation.po` — mirrors `apps/readest-app/public/locales/<lang>/translation.json` exactly, using **i18next-style codes** (`zh-CN`, not `zh_CN`).
- The loader converts KOReader's locale (e.g. `zh_CN.utf8` → `zh-CN`) before lookup.
- Fallback chain: full code → base lang (`pt_BR` → `pt`) → `zh-CN` for any unspecified zh variant.
- Language list is the single source of truth at `apps/readest-app/i18next-scanner.config.cjs` (`options.lngs`) — currently 31 languages.

## Scripts (in `apps/readest.koplugin/scripts/`)

- **`extract-i18n.js`** — primary tool. Run with `node scripts/extract-i18n.js`. Scans `*.lua` for `_("...")`, `_('...')`, and `_([[...]])` (with proper Lua-escape handling), reads each `.po`, **preserves existing translations**, adds new msgids with empty `msgstr`, drops obsolete msgids. Idempotent.
- **`apply-translations.js`** — bulk applier. Reads `/tmp/koplugin-translations/<lang>.json` files (key = msgid, value = translation) and fills empty `msgstr ""` lines only — **never overwrites** existing translations.

## Workflow for adding/changing strings

1. Edit Lua source(s). Use `_("Foo")` or `T(_("Foo %1"), arg)` (`T` from `require("ffi/util").template`) — **never** `_("Foo ") .. arg`, because RTL/verb-final languages can't reorder the placeholder.
2. `node scripts/extract-i18n.js` — adds new empty msgids, drops obsolete.
3. To translate: drop `<lang>.json` files into `/tmp/koplugin-translations/`, then `node scripts/apply-translations.js`.
4. Verify with `luac -p apps/readest.koplugin/*.lua` and re-run `extract-i18n.js` (should report no changes — idempotency check).

## Translation conventions

- Brand names "Readest" and "KOReader" stay untranslated.
- Technical terms ("PDF", "API", "URL", "Supabase", "Hash") generally kept as-is, sometimes transliterated in non-Latin scripts.
- Dialog title = title case (`Sync Info`); menu item label = sentence case (`Sync info`).
- Lower-confidence translations (bo, si, ta, bn, sl, fa) deserve native-speaker review.

## Storage conventions for plugin state

- Global plugin state: `G_reader_settings:saveSetting("readest_sync", settings)` — login tokens, auto-sync flag, etc.
- Per-book state: `ui.doc_settings:readSetting("readest_sync")` table — keys like `meta_hash_v1`, `last_synced_at_config`, `last_synced_at_notes` (seconds since epoch).
