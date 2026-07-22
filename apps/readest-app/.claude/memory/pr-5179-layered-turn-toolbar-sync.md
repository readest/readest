---
name: pr-5179-layered-turn-toolbar-sync
description: "#5179 + foliate#56 (toolbar sync with layered slide/curl turns, #5169) MERGED 2026-07-19 after local rebase; review found real defects that were NOT fixed before merge — open follow-up list inside"
metadata: 
  node_type: memory
  type: project
  originSessionId: bfe3c4f3-8f81-46a7-876b-492fc006092b
---

MERGED 2026-07-19: readest#5179 (squash `1680e53b1`, contributor chihumyum/
VellerRider, closes #5169) + foliate#56 (squash `74d8022`). Adds the
`layered-turn-state` lifecycle (before-capture/covered/ready/cancelled/
finished) from paginator.js, app-side toolbar sync (`.captured-turn-sync-
chrome` transition suppression, flushSync under the VT update callback),
module-global `activeLayeredTurnGestures` Set, touchcancel relay,
synthesized-click suppression map in iframeEventHandlers.ts, and
`#vtFinishing`/`#vtProgrammatic` exclusive-ownership guards.

Both PRs were CONFLICTING (based pre-#5184/#5185/foliate#57); I rebased
locally preserving #57's 24px/1.5x wobble gate + sub-pixel settle +
whole-gesture aligned commit, deduped endDrag serialization against #5184,
and force-pushed to the contributor's fork via maintainerCanModify. dev
carries the same content as cherry-pick `072bec27a` + gitlink bump
`e3908af7f`; expect clean dedupe when dev merges main. Worktree and local
branches cleaned up post-merge.

**Review findings that MERGED UNFIXED (3-reviewer consensus; candidates for
follow-up issues; verify on device before chasing):**
1. Stale `suppressedSwipeClicks` entry eats the next deliberate tap within
   750ms/15px of a swipe end on engines that never synthesize swipe clicks
   (most). touchend now delegates ALL tap handling to the click path, so a
   swallowed click = dead tap (no toolbar toggle, no tap-zone turn). Fix:
   clear the entry on the next iframe-touchstart.
2. `#viewTransitionTurn` ownership guard silently DROPS programmatic turns
   (keyboard/TTS/tap-zone next()) during the ~300-450ms finishing window —
   next() resolves as success, no retry; section-boundary next()
   inconsistently bypasses via #goTo. Fix: queue-latest or fall through to
   the instant path.
3. `#touchState.blocked` latches at touchstart and never re-evaluates: a
   swipe starting 1ms before settle completes stays dead its whole lifetime
   (caps flip cadence on the VT path; Tauri captured pipeline queues
   instead). Fix: unlatch in #onTouchMove once clear, re-baseline deltas.
4. Non-terminal lifecycle paths poison the global Set (cleared only on
   'finished'/unmount): #onTouchEnd resolves the drag BELOW the scrolled/
   no-swipe early-returns (mid-drag settings flip strands it); turn-style
   change mid-cancel bumps #slideTurnId past the terminal dispatch. Fix:
   hoist drag resolution, dispatch terminal event in a finally.
5. Minor: suppressed clicks lack preventDefault (in-iframe link/footnote
   consumers still fire); flushSync reachable from effect-cleanup (React
   commit-phase warning); multi-book hoveredBookKey clobber on cancel
   restore; pinch can arm click suppression; vacuous `pageCurlBackend`
   assertion in captured-turn.browser.test.ts; PR's "fast swipe" test
   duplicates main's "endDrag racing capture can commit".

Workflow gotcha: a hand-typed full SHA in `--force-with-lease=<ref>:<sha>`
rejects with "stale info" — paste `headRefOid` from the API verbatim.
See [[layered-snap-vertical-swipe-random-turn]],
[[captured-turn-instant-highlight-scrolllock]].
