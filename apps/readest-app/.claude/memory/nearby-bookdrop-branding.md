---
name: nearby-bookdrop-branding
description: "The LAN book-transfer feature is branded \"Nearby BookDrop\" in UI copy; code identifiers stay localsend"
metadata: 
  node_type: memory
  type: project
  modified: 2026-08-28T04:49:43.798Z
  originSessionId: b9b94a53-b9d4-4e47-a727-327cb2286b22
---

The LAN book-transfer feature (LocalSend protocol) is **user-facing branded "Nearby BookDrop"** as of 2026-08-28. Renamed across readest-app + readest.koplugin, all 34 JSON locales and all 33 koplugin `.po` catalogs.

**Why:** chrox wanted a Readest-owned brand — users drop/send books to nearby Readest devices — instead of surfacing the third-party protocol name as the feature name.

**How to apply:**

- **Code identifiers, dirs, commands, events, settings keys stay `localsend`.** `src/services/localsend/`, `src/store/localsendStore.ts`, `LocalSendManager.tsx`, `src-tauri/src/localsend/`, `localsend_*` Tauri commands, `settings.integrations.localsend.enabled`, koplugin `readest_localsend.lua` / `localsend_enabled`. Only display strings changed. See [[localsend-integration]] and [[koplugin-localsend-receive]].
- **Brand name is never translated.** Every locale keeps the Latin `Nearby BookDrop`, same as `LocalSend`, `Readest`, and `Word Lens` (only zh-CN ever localized Word Lens). Surrounding grammar is localized ("启用 Nearby BookDrop", "Nearby BookDrop aktivieren"). Korean takes consonant-final particles (으로/을/이, not 로/를/가) because "BookDrop" ends in a consonant.
- **Keep LocalSend named where it means the other app.** Interop is real, so "No devices found. Make sure Nearby BookDrop **or LocalSend** is open on the other device." and the settings blurb still name LocalSend.
- **Action labels stayed action-shaped, not branded:** multi-select `Nearby`, context menu `Send to Nearby Device`, koplugin file-dialog `Send to nearby Readest devices`.
- **Renaming an i18n key in place beats re-extraction.** `pnpm run i18n:extract` drops the old key and appends the new one with `__STRING_NOT_TRANSLATED__`, losing 34 good translations and appending unrelated missing keys. Rewrite the key line in place (values are single-line JSON), then run the extractor only to *verify* it reports nothing new. Same for koplugin: rename the `msgid` and keep the `msgstr`, then `node scripts/extract-i18n.js` must report `188/188` with 0 dropped.

**i18n catalog findings from the same pass (2026-08-28):**

- The 15 Audiobookshelf / novel-import keys that were missing from every JSON locale are now **translated in all 34** (same session). Fixed, not outstanding.
- `ro` had 5 keys where the *placeholder name itself* was translated (`{{eroare}}`, `{{dimensiune}}`, `{{fișier}}`, `{{formate}}`, `{{număr}}`) — i18next can't interpolate those, so they rendered literally. Fixed.
- **`bo` (Tibetan) still has a broken cluster, NOT fixed.** One wrong string, `དེབ་གནས་བཅས་པའི་སྤྱོད་བྱས་མ་ཐུབ།`, is duplicated across `Calculating file info...`, `Migrating data...`, `Copying: {{file}}`, `{{current}} of {{total}} files`, `The book file is corrupted/empty`, `Failed to open the book file`; another duplicate covers the whole `Migration *` group. Two of them also dropped their `{{error}}` / `{{file}}` placeholders. Needs a real Tibetan pass, not a mechanical fix.

**Validation worth repeating after any `/i18n` run:** compare `{{var}}` sets between each key and its value (allowing `count` to be dropped in spelled-out plural forms). That check is what surfaced both defects above.
