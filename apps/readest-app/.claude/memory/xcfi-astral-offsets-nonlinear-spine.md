---
name: xcfi-astral-offsets-nonlinear-spine
description: "crengine XPointer offsets count code points (emoji = 1); linear=\"no\" spine items DO get DocFragments; fix on branch fix/kosync-astral-offsets"
metadata:
  node_type: memory
  type: project
  originSessionId: 831363b2-bc9b-47cc-98d2-5e1f29efe630
  modified: 2026-11-02T19:44:28.627Z
---

Found 2026-11-03 by comparing with another reader's XPointer converter, checked against headless crengine (xpointer-oracle.lua, KOReader emulator):
- **Offsets:** crengine counts Unicode characters; `src/utils/xcfi.ts` counted UTF-16 units, so every emoji / astral CJK char earlier in a text node shifted positions one char early. Fixed in commit 8b7a26ec7 (was 835c5790b before rebase) on `fix/kosync-astral-offsets` (worktree `~/dev/readest-fix-kosync-astral-offsets`), fixture `sample-nonlinear-astral`. PR NOT opened yet as of 2026-11-03.
- **Non-linear spine:** NOT a bug. crengine numbers `linear="no"` items as DocFragments like any other, so `DocFragment[N]` = section N-1 holds. The other converter's "linear items only" numbering is wrong; don't "fix" ours toward it.

**How to apply:** for any "KOReader lands at the wrong spot" question, build a tiny EPUB and run the oracle (`... ./luajit xpointer-oracle.lua book.epub out.json 1`), then `XPOINTER_ORACLE=out.json pnpm test --run src/__tests__/utils/xcfi.crengine-oracle.test.ts`. The local emulator's crengine predates 137cba4: asking for DOM 20260812 returns zero words. Related: [[kosync-fb2-docfragment-xpointer-6896]].
