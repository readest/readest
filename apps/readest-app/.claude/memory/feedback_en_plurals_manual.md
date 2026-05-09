---
name: en/translation.json holds ONLY plural variants and proper-noun overrides
description: For non-plural strings, do NOT add to en/translation.json — the source-code key IS the en value via `defaultValue: key`. ONLY plural strings need explicit `_one`/`_other` entries in en, because i18next needs the forms to pick from.
type: feedback
originSessionId: e4ddc690-b1a9-4557-855f-d4e67055824f
---

**Rule:** `public/locales/en/translation.json` is hand-curated and contains essentially two kinds of entries:

1. **Plural variants** (`<base>_one`, `<base>_other`, and locale-specific `_few`/`_many`/etc. as needed by CLDR). i18next MUST find these to know which form to render — without them, `count: 1` falls back to the bare key like `{{count}} days` and renders "1 days" instead of "1 day".
2. **Proper-noun overrides** (e.g., font names like `LXGW WenKai GB Screen`) where the en value differs from the key.

Everything else — ordinary translatable strings like `Sign in to share books` — does NOT belong in en/translation.json. The translation hook calls `t(key, { defaultValue: key, ...options })`, so for any string not in en/translation.json, i18next renders the key itself. That's why a 51-key en file works for a codebase with thousands of `_()` callsites.

**Why en is hand-curated:** the project's `i18next-scanner.config.cjs` lists every locale EXCEPT `en` in its `lngs` array. The scanner generates `__STRING_NOT_TRANSLATED__` placeholders only for the listed locales; `en` is never touched.

**Workflow when adding `_(...)` calls:**

- **Non-plural string** (e.g. `_('Sign in to share books')`): add the `_(...)` call, run `pnpm run i18n:extract`, translate the new placeholders in non-en locales. **Do NOT touch `en/translation.json`** — the key itself is the en value.
- **Plural string** (e.g. `_('{{count}} days', { count: n })`): same as above, PLUS hand-add `<base>_one` and `<base>_other` to `en/translation.json` (and `_few`/`_many`/etc. only if the source language ever needs them, which English doesn't). Convention from existing entries (e.g., `Are you sure to delete {{count}} selected book(s)?_one` → `Are you sure to delete {{count}} selected book?`): keep `{{count}}` interpolated even in `_one`, and swap any `(s)` placeholder to the proper singular/plural noun.

**Audit script:** walk `src/`, regex-match `_('...', { ..., count: ... })`, for each base key verify both `<base>_one` and `<base>_other` exist in `en/translation.json`. (See conversation history for an implementation.)

**Where this bit us:**

- Initial bug: `_('{{count}} days', { count: n })` rendered "1 days" because en had no `_one` form.
- Audit found 16 missing en plural keys from earlier PRs (OPDS / TTS / dictionary import) silently rendering wrong.
- Then overcorrected and added non-plural keys like `Sign in to share books` to en/translation.json — wrong, breaks the project's convention. en stays clean for non-plural strings.
