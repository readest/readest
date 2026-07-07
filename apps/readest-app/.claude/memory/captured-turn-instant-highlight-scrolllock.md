---
name: captured-turn-instant-highlight-scrolllock
description: Captured slide/curl page turns ignored the instant-highlight still-hold gate; fixed by honoring renderer.scrollLocked like the push paginator
metadata: 
  node_type: memory
  type: project
  originSessionId: 871c7b42-61c0-44e7-a1d6-8edb35d80300
---

Instant Highlight's 300ms still-hold gate ([[instant-highlight-tap-paginate]])
worked in **push** mode but NOT in **slide/curl** — a swipe after the hold turned
the page (with the slide/curl effect) instead of extending the highlight.

**Root cause: two independent swipe paths.** foliate's native `#onTouchMove`
(paginator.js) bows out at `if (this.hasAttribute('no-swipe')) return` (~2149),
THEN checks `if (this.#scrollLocked) return` (~2162), THEN the `#layeredTurn` VT
drag (~2179). So:
- **push** (no turn-style, no no-swipe) → native swipe, honors `#scrollLocked`. ✅
- **VT-layered slide** (`turn-style='slide'`, no no-swipe; engines with nested VT
  groups) → native swipe → layered turn, still AFTER the scrollLocked check. ✅
- **captured curl (always) / captured slide (Tauri w/o full VT support)** →
  `applyPageTurnAttributes` sets `no-swipe`, so native swipe returns early and the
  APP-side captured-turn touch interceptor in `useCapturedTurn.ts` (priority 5,
  driven by `iframe-touchmove` → `dispatchTouchInterceptors`) is the swipe handler.
  It began a drag on any >15px horizontal move WITHOUT checking scrollLocked. ❌

`useTextSelector.startInstantAnnotating` sets `view.renderer.scrollLocked = true`
when the hold engages. The captured interceptor is a parallel reimplementation of
swipe-to-turn and must honor the same lock independently.

**Fix (app PR readest#5000 + foliate readest/foliate-js#51, tests:
`useCapturedTurn-scrollLock.test.ts`):**
1. foliate `paginator.js`: add `get scrollLocked()` — it was setter-only, so JS
   couldn't read it back (app `src/types/view.ts` already declared it a readable
   boolean). foliate PR #51 MERGED (squash → `ba57ec8` on foliate main); app
   #5000 bumps the submodule pointer to `ba57ec8` (mergeable, awaiting merge).
2. `useCapturedTurn.ts` touch interceptor, `move` phase, before starting a drag
   (`!state` branch): `if (currentView.renderer.scrollLocked) return false;`.

**Why the `!state` branch is sufficient:** a captured drag needs >15px horizontal
travel, but `maybeCancelInstantHoldOnMove` cancels the hold at >10px — so a drag
can never already be in progress when instant annotation engages; no need to gate
an in-flight drag. See [[page-turn-styles-viewtransitions-555]].
