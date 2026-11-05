---
name: anki-link-ankidroid-789
description: "Vocabulary ↔ AnkiDroid Sync with Anki (premium) — PR #7328 MERGED 2026-11-05 as 7fa58028f, UNRELEASED (worktree and branch removed); desktop AnkiConnect is the planned follow-up"
metadata:
  node_type: memory
  type: project
  originSessionId: 6ff25e5a-102d-4eba-a36b-f75936118fc1
  modified: 2026-11-04T19:16:13.873Z
---

Owner decisions: direct integration, not files ("can we directly integrate Anki and Readest?"); goal is "integrating with Anki seamlessly with less configuration and manual adjustment"; "rework this branch into Sync with Anki" (2026-11-04); "go ahead with what you recommend" (2026-11-05) = Sync sends only Learning words. Android first, desktop via AnkiConnect in a second PR (same deck, note type and tags); iOS stays on file export.

Owner rulings 2026-11-05: "B" = a word lowered after its mature card raised it stays lowered until the card lapses and matures again (per-device `localStorage` `readest-anki-matured`, fixed 16f950da1; known limit: a device that never pulled re-raises once); "fix it in this PR" = whitespace-collapsed note matching (be9f7129a). Merged at reviewed head 1b575d592.

Shape: one Sync button (pull: mature cards → Mastered, deck-only notes → Learning; push: Learning words with a sentence that have no note; mirror: readest::learning / readest::mastered tags), read-only pull when the window opens (granted + entitled only, never prompts or writes), Import Anki Deck... in the window's More menu.

**Why:** state and choices that live outside the code.

**How to apply:**
- Spec/plans (gitignored, local only) moved to the main checkout: `apps/readest-app/docs/superpowers/specs/2026-11-04-anki-link-design.md`, `.../plans/2026-11-04-anki-link.md`, `.../plans/2026-11-05-anki-sync.md`; start the desktop AnkiConnect PR from the spec.
- AnkiDroid provider facts: permission `com.ichi2.anki.permission.READ_WRITE_DATABASE` is dangerous (runtime prompt); `cards` URI only from 2.24 and it renders every returned card; `did:` excludes subdecks (pass family ids); **`did:1,2 prop:ivl>=21` ignores the prop — group it `(did:1,2) prop:ivl>=21`** (reproduced in AnkiDroid's own browser); notes/<id> update takes `tags`; Anki canonicalizes tag case to the first spelling it saw (compare tags lowercased); bulkInsert returns 0 past 1 MB (chunk 200).
- Xiaomi timings (1,000 notes): add 1.2 s, read 32 ms, 1,000 tag updates 2.75 s.
- Device CDP: python websocket must use `ws://127.0.0.1:<port>/devtools/page/<id>` and bypass the shell proxy; `__TAURI_INTERNALS__.invoke` is non-writable, so bridge calls can't be sniffed from JS.
- Device lookups for e2e: turn Readest's System Dictionary off (Settings > Language > Dictionaries) or the lookup opens Android's app chooser; turn it back on after.
- Related: [[vocabulary-builder-789-6613]].
