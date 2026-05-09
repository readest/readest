---
name: i18n-koplugin
description: >
  Extract i18n strings from readest.koplugin Lua sources and translate empty
  msgstrs in apps/readest.koplugin/locales. Use when the user invokes
  /i18n-koplugin or asks to extract/translate koplugin i18n strings.
  Runs scripts/extract-i18n.js to sync .po catalogs from `_("...")` calls,
  then fills any empty `msgstr ""` entries across all locale files.
user_invocable: true
---

Extract/translate i18n strings for `readest.koplugin`. The catalogs are gettext `.po` files (not JSON like the main app). Run from the repo root or any worktree — the script resolves paths relative to the plugin dir.

## Step 1: Determine the working directory

If currently in a PR worktree (e.g., `/Users/chrox/dev/readest-pr-*`), use that. Otherwise use the main repo. The plugin dir is `<repo-root>/apps/readest.koplugin`.

## Step 2: Extract msgids from Lua sources

```bash
cd <repo-root>/apps/readest.koplugin
node scripts/extract-i18n.js
```

This scans every `*.lua` file under `apps/readest.koplugin/` (except `spec/` and dotdirs) for `_("...")` and `_([[...]])` calls, then for each language listed in `apps/readest-app/i18next-scanner.config.cjs`:

- appends new msgids with empty `msgstr ""`
- preserves existing translations
- drops obsolete msgids
- rewrites the `.po` header (Plural-Forms etc.)

The output prints `<lang>  <kept>/<total>  (-<dropped> obsolete)` per locale.

## Step 3: Find untranslated entries

An untranslated entry is a non-empty `msgid` followed by an empty `msgstr ""` (the file's header pair `msgid ""` / `msgstr ""` is NOT a translation — skip it).

```bash
cd <repo-root>/apps/readest.koplugin/locales
# List locales that still have untranslated strings, with counts
for f in */translation.po; do
  # Count empty msgstrs that follow a non-empty msgid
  n=$(awk '
    /^msgid "/  { msgid=$0; next }
    /^msgstr ""$/ { if (msgid != "msgid \"\"") c++; next }
  ' "$f")
  [ "$n" -gt 0 ] && echo "$f: $n untranslated"
done
```

If no results, report that all strings are translated and stop.

To list the actual untranslated msgids in one locale:

```bash
awk '
  /^msgid "/  { msgid=$0; next }
  /^msgstr ""$/ { if (msgid != "msgid \"\"") print msgid; next }
' <repo-root>/apps/readest.koplugin/locales/<lang>/translation.po
```

## Step 4: Translate empty msgstrs

For each empty `msgstr ""` found:

1. Read the preceding `msgid "..."` — that's the English source string.
2. Identify the target locale from the file path (e.g., `locales/ja/translation.po` → Japanese; see table below).
3. Provide an accurate translation. Use the locale reference table for the language; match the tone/terminology already used in the same file (check existing translated entries for context).
4. Preserve `printf`-style placeholders verbatim: `%s`, `%d`, `%1$s`, `%(name)s`, etc.
5. Preserve newlines as `\n`, tabs as `\t`, and escape `"` as `\"` and backslashes as `\\` inside the msgstr.

Edit the `.po` files directly with the Edit tool — do NOT use sed for this, because msgids may contain characters that confuse shell quoting. Each replacement should target the unique `msgid "<English>"\nmsgstr ""` block:

Old:
```
msgid "<English string>"
msgstr ""
```

New:
```
msgid "<English string>"
msgstr "<translation>"
```

Batch all locales for the same key together when possible — keeps the translation set consistent.

### Locale reference

The supported language set is **not hardcoded in this skill**. The ground truth is `apps/readest-app/i18n-langs.json` — both `i18next-scanner.config.cjs` (via `require`) and `src/i18n/i18n.ts` (via JSON import) source from it, and `extract-i18n.js` reads `lngs` from the scanner config at runtime. To list the current set:

```bash
cat <repo-root>/apps/readest-app/i18n-langs.json
```

Map each code to a language name when translating. If a code in `i18n-langs.json` is missing from the `LANG_META` table inside `extract-i18n.js`, the script prints `<code> skipped (no metadata in extract-i18n.js)` — in that case, add the metadata entry there first, then re-run extraction.

## Step 5: Verify

Re-run the count loop from Step 3 and confirm zero untranslated strings remain. Report:

- number of msgids extracted
- per-locale count of strings translated
- any locales that were already complete

Optionally, run the koplugin Lua tests if `busted`/`luajit` are installed:

```bash
cd <repo-root>/apps/readest-app
pnpm test:lua
```
