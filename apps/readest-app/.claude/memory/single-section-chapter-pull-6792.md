---
name: single-section-chapter-pull-6792
description: "#6792 single-section scroll chapter turns: swipe at boundary, finger-tracked pull of the adjacent chapter (MERGED #7422 + foliate #151); device oddities seen once"
metadata:
  node_type: memory
  type: project
  originSessionId: 612cbd4b-e0ad-4d87-a8d0-c0a35a310b27
  modified: 2026-11-12T17:31:11.678Z
---

#6792 (swipe to change chapter in Single Section Scroll) MERGED 2026-11-13 as readest a60b7eee0 (#7422, community PR by lxccc812, reworked by us) + foliate-js 22a49ac (#151).

Behavior (owner's product calls during the rework):
- Swipe only, behind Swipe to Paginate; the wheel/trackpad does NOT turn chapters (dropped: ungated desktop change).
- A swipe must START at the boundary; one that only reaches it mid-gesture does not turn.
- With Paging Animation on (not e-ink), the owner chose "next chapter slides in under the finger": a swipe heading out of the boundary calls `#loadAdjacentSection` (works in no-continuous-scroll; only its callers gate on it), the finger scrolls across both views, release ≥48 px eases onto the new chapter and drops the old view keeping the page in view anchored; short pull, cancel or a 2nd finger eases back. E-ink / animation off = instant turn. An earlier slide+fade version was rejected as "hard" / not following the finger.
- `#loadAdjacentSection` anchors a prepended placeholder at insertion (else a blank viewport-sized placeholder flashes at scrollTop 0, where browsers don't scroll-anchor). This was in the contributor's first version; I wrongly removed it as continuous-only.

Device oddities on the Xiaomi, first pull right after a fresh install, NOT reproduced in 11 later tries:
1. ~2 s after a backward pull, the reader jumped back to the previously synced position. `useProgressSync` calls `view.goTo(remote)` when remote CFI is ahead of local, so any backward navigation can be undone by a sync pull. Existing behavior, not filed yet.
2. One backward pull landed two chapters back with no public goTo call logged. Unexplained.

Recording recipe that worked: `adb shell screenrecord`, ffmpeg frames at 60 fps, per-frame brightness via `magick -resize 1x1`, plus an in-page rAF sampler of `scrollTop`/views pushed to `window.__x`. See [[feedback-always-verify-on-xiaomi]].
