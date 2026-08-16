---
name: tts-miniplayer-symmetric-5636
description: "#5636 symmetric minimal TTS mini-player: mirror-width items in ONE justify-between row = even gaps AND exact centering; grid-halves attempt made uneven gaps"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7e28ac69-a058-4db6-8522-4f6a3c913576
  modified: 2026-08-14T15:28:05.906Z
---

#5636 (FR: rearrange mini-player) MERGED #5707. Minimal-style card became
`[speed] [<<] [<] [play] [>] [>>] [time]` — time far right, play dead-center as a
halfway mark against the card's bottom progress line.

**Why:** First attempt used a 3-column grid (`minmax(0,1fr)_auto_minmax(0,1fr)`) with
justify-between halves. Play was centered but gaps were UNEVEN: `<` and `>` sit flush
at their half's inner edge, hugging the play button, while outer gaps stayed wide. The
user caught it from a screenshot.

**How to apply:** To get even spacing AND exact centering in one shot, put all items in
ONE `justify-between` row and make the width sequence mirror about the middle item
(w1=w7, w2=w6, w3=w5). Equal gaps then land the middle item on the row's exact midpoint
— no grid needed. In TTSMiniPlayer the mirror comes from giving the speed glyph the same
fixed `w-14` box the time already had (its old `pe-4` room for the jutting rate label now
comes from the box's centering margins). The whole minimal row is `dir=ltr` because the
progress line it annotates fills physically left-to-right. Verified numerically in-browser:
playCenter === rowCenter, gaps all 23.7px. Related: [[scroll-offsets-quantize-subpixel-rendering]]
for the measure-pixels verification habit.
