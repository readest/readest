---
name: custom-shortcuts-3772
description: "PR #5907 customizable keyboard/mouse bindings — review findings, the daisyUI modal-box trap, and the dead-default-binding invariant"
metadata: 
  node_type: memory
  type: project
  originSessionId: aaff73ce-9ea1-4186-b91b-e08816f67b54
  modified: 2026-08-28T03:17:53.240Z
---

PR #5907 (`feat/custom-shortcuts-3772`, contributor WhiteHades) closes #3772:
per-device custom key + mouse (X1/X2) bindings, Settings → Behavior → Keyboard
Shortcuts. MERGED 2026-08-28 by chrox, squash `d27d324e1`; worktree removed,
branches deleted. Reviewed + Chrome-verified 2026-08-28; my fix commit
`fe54fde52` was pushed to the fork as a strict fast-forward onto the real head
b23571391, never the `worktree:new` rebased branch — see
[[worktree-new-rebases-pr-force-push]]. All 8 CodeRabbit threads were already
resolved and I re-verified each in the tree.

**BLOCKER found only in a browser: a bare `.modal-box` never paints.** daisyUI 5
keeps `.modal-box` at `opacity:0; scale:.95` unless it is inside an open
`.modal` (selector `.modal:is(.modal-open,[open],:target)`). The replace-shortcut
dialog rendered `<ModalPortal><div class="modal-box">` — it laid out (399x140,
centred) but was invisible, so confirming a conflicting binding was a dead end.
RULE: every `modal-box` in this repo MUST sit inside
`<dialog className='modal modal-open'>` (the pattern `TelemetryConsentDialog`,
`AppLockDialog`, `PassphrasePrompt` already use). jsdom cannot catch this — it
has no daisyUI CSS, and the UA `dialog:not([open]){display:none}` rule means the
test must query with `{ hidden: true }`. See [[daisyui-v5-tailwind-v4-migration]].

**Handler contract inverted:** `useShortcuts` went from "truthy = handled" to
`result !== false`, so it is now FIRST-MATCH-WINS within one action map. Most
handlers return `undefined`. That silently killed six default bindings that an
earlier action in `useBookShortcuts`' map already claimed:
Go Back ⇧←/⌥←, Go Forward ⇧→/⌥→, Half Page Up ⇧↑, Half Page Down ⇧↓,
Next Page ⇧J (claimed by Toggle Scroll Mode). Removed them; Go Back/Forward now
live on ⇧H/⇧L only, half-page on U/D. `shortcuts.test.ts` has the invariant
("no action shadows a later one") over an ALWAYS_FIRING_IN_ORDER list — note
`alt+X`/`opt+X` normalize identically, so only CROSS-action collisions count.
Contextual overlaps across DIFFERENT hooks (⌘F = search bar + search selection,
⇧← = adjust selection else prev page) are fine: separate window listeners, all fire.

Other fixes in that commit: `ctrl`-only defaults got cmd variants (Open Books,
Save Note — they rendered as ⌃O/⌃Enter on Mac once `MODIFIER_MAP_MAC.ctrl` was
honestly changed ⌘→⌃); ControlPanel's panel reset no longer wipes bindings;
capture timeout 8s→15s (8s expired between agent tool round-trips AND mid-chord);
per-row Clear/Reset revealed on hover via `not-eink:sm:opacity-0
not-eink:sm:group-hover:opacity-100` (always visible on touch + e-ink); 7 new
strings translated into all 34 locales.

`pnpm i18n:extract` also surfaced **15 Audiobookshelf keys missing from every
catalog** (pre-existing gap from the merged ABS work, [[abs-audio-transport-5863]]).
I DROPPED them from this PR's diff rather than commit `__STRING_NOT_TRANSLATED__`
— nothing maps that placeholder back to English at runtime, so writing it would
render the literal to users in 34 languages. STILL OPEN, needs its own pass.

NOT changed (deliberate): rebinding replaces ALL of an action's keys. A chip-per-
binding UI is the real fix but the row's trailing slot is `max-w-[60%]` and
Previous Page carries 4 bindings. Mitigated by per-action Reset (verified).
UNVERIFIED: whether `preventDefault()` on `mouseup` actually suppresses Chrome's
back/forward for X1/X2 — needs a real 5-button mouse; synthetic events only
proved the dispatch wiring.
