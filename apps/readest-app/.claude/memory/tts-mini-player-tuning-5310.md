---
name: tts-mini-player-tuning-5310
description: "#5310 TTS mini player fine-tuning - ttsPlayerStyle now drives auto-hide AND content margin reservation"
metadata: 
  node_type: memory
  type: project
  originSessionId: 277fa2f8-17a7-4059-9138-49f1c4801000
  modified: 2026-08-02T16:02:44.332Z
---

#5310 (FR, continuation of #5101) fine-tuned the TTS mini player. MERGED as
PR #5446 on 2026-08-02 (`4f44b79ec`). Layout was verified only against a
plain-CSS harness at six widths, never on real hardware, so a phone check of
the 360/375px cases is still outstanding.

Branch was built without checking out: `dev` had 75 dirty WIP files, 45 of them
also changed on `origin/main`, so `git checkout -b` would have clobbered them.
Recipe that avoids touching HEAD or the working tree at all:
`GIT_INDEX_FILE=/tmp/i git read-tree origin/main` ->
`git update-index --add <only my files>` -> `git write-tree` ->
`git commit-tree $TREE -p origin/main -F msg` -> `git branch <name> $COMMIT`.
Verify with `git diff --stat origin/main $TREE` before committing, then
`gh pr create --head <name>` (HEAD is still on the old branch, so --head is
required).

`ttsPlayerStyle` is now load-bearing for two things that used to be
style-agnostic:

- **`full`** = ephemeral. Rides with the reader chrome via
  `useMiniPlayerAutoHide` (visible while `hoveredBookKey === bookKey`, then a
  5s linger), and reserves **zero** content margin. It overlaps the last text
  line during its visible window, same contract as the toolbars.
- **`minimal`** = persistent for the whole session, and it is the **only** style
  that reserves a band of book text (`getTTSMiniPlayerClearance`, consumed by
  FoliateViewer's `applyMarginAndGap`).

Non-obvious traps hit while building it:

- `useMiniPlayerAutoHide` takes a `mounted` arg and must be gated on it.
  `TTSControl` lives as long as the reader does, so arming the countdown on the
  hook's own mount burns the 5s at book-open — a session started without the
  toolbar (headset / lock-screen button) would then mount an already-hidden
  card. `mounted` also resets while the player sheet has replaced the card, so
  closing the sheet hands back a visible one.
- Deleting the stop button does **not** space out the remaining transport
  glyphs. The fix that works: the **transport** takes `flex-1 justify-between`
  and the time takes a **fixed** `w-14` box. Reversed (time `flex-1`) the glyphs
  stay crammed at the right edge with dead space in the middle; content-sized
  (no fixed width) every glyph re-centers each time the label narrows
  (`-10:00` -> `-9:59`). Do **not** add a `gap-*` to the transport: it adds
  16px to the row's min width and starts crushing the time box at 360px.
- A `truncate` span inside a `flex-col items-center` parent needs
  **`max-w-full`** or it does not truncate at all -- a nowrap flex item's cross
  size resolves to the text width and spills over the neighbour. This is what
  made `-9:28` render on top of `<<` on a narrow screen.
- Row min-width budget at default font: `px-3` 24 + speed button 46 + `gap-2`
  x2 16 + time 56 + 5 glyphs 170 = **312px**, i.e. fits every viewport >=344px.
  Below that the time box shrinks and the label ellipsises, but all five
  controls stay reachable and nothing overlaps.
- Verified by mirroring the Tailwind classes into a plain-CSS mock served over
  `localhost` (file:// is blocked for the Chrome MCP) and screenshotting each
  width. Worth repeating -- but keep the mock byte-honest: an earlier pass had
  `max-width:100%` in the mock and not in the component, so the preview looked
  correct while the real card collided.
- `viewSettings?.ttsPlayerStyle` had to join the `applyMarginAndGap` effect deps
  or flipping Player Style leaves a stale reservation.
- New `formatCompactTime` in `src/utils/time.ts` — `H:MM` above an hour, `M:SS`
  below, five tabular columns either way. Distinct from `formatPlaybackTime`,
  which the `full` style still uses with `forceHours`.

Out of scope by the user's call: the issue's third ask (replace the
`SpeedSettingsIcon` glyph / drop the `1x` label).

See [[reader-toolbar-touch-targets-5401]] for the 44px touch-target rule that
motivates the spacing, and [[feedback_dont_push_every_change]].
