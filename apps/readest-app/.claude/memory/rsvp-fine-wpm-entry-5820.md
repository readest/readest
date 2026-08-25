---
name: rsvp-fine-wpm-entry-5820
description: "#5820 fine-grained RSVP WPM: PR #5825 MERGED e659976cc; WpmEntry row (typed field + 10 WPM nudge) in the WPM dropdown; capture-phase shortcut handler must bail for text inputs; Chrome/Xiaomi verified; device/CDP recipe gotchas"
metadata: 
  node_type: memory
  type: project
  originSessionId: b12de0d5-fbdc-4a1c-a06b-56ba0b5e7318
  modified: 2026-08-22T16:47:18.554Z
---

Issue #5820 asked for finer-than-50 WPM control on mobile RSVP. PR #5825
MERGED 2026-08-23 as `e659976cc`; worktree removed.

**What shipped:** `WpmEntry` component at the top of the WPM dropdown in
`RSVPOverlay.tsx`: digits-only `<input inputMode=numeric enterKeyHint=done>`
(Enter -> blur -> commit via `controller.setWpm`, Escape discards) flanked by
`-`/`+` that move by `WPM_FINE_STEP = 10`. Transport/swipe/arrows/presets keep 50.
No controller change (setWpm already clamps 100-1000 and persists any int). One
new i18n key `Words per minute` in all 34 locales (added by JSON-roundtrip
script, not `i18n:extract`). The draft lives inside `WpmEntry` so it dies with
the dropdown (a programmatic hide via `ttsDriven` would otherwise keep a stale
draft that commits as 100 WPM on the next blur).

**Load-bearing:** the overlay's `document` capture-phase keydown handler now
returns early for `HTMLInputElement` with `type === 'text'`; without it arrows
change speed, Space toggles play and Escape kills the session while typing.
`useShortcuts` already ignores INPUT focus, so letting keys bubble is safe.

**Verification recipes learned (reuse):**
- Chrome MCP: `computer key Escape` does NOT deliver a keydown to the page, it
  just blurs the focused element (looked like Escape committed the draft). Use a
  JS-dispatched `KeyboardEvent` to test Escape paths. Screenshot coords were
  scaled ~1.10x vs CSS px at first (viewport 1422x702, screenshot 1568x774), so
  click by `find` refs, not by coordinates. `shift+v` chord collided with
  another extension and hijacked the tab; dispatch shortcuts via JS on `window`.
- Web library on a new origin (localhost:3100) shares the auth cookie with :3000
  (cookies ignore ports), so imported test books may sync metadata; import via a
  synthetic `DragEvent` on `.library-page`, delete via details dialog afterwards.
- Xiaomi CDP: `readest://book/<hash>` only navigated on a COLD start
  (`am force-stop` then `am start -a VIEW -d ... com.bilingify.readest`); when the
  app was already on /library the intent was delivered but ignored, and both
  `.click()` and a CDP touch on the card did nothing. `Runtime.evaluate` needs
  `replMode: true` for top-level await. zsh does not word-split `$VAR` in
  `set -- $VAR`. `/tmp/cdp-eval.mjs` driver: eval | --touch x y | --type | --shot.
- `pnpm exec dotenv ...` is required outside package scripts; bare `dotenv` is a
  different binary that prints its version and exits 0 (silent no-op build).

Related: [[feedback-always-verify-on-xiaomi]], [[i18n-extract-prunes-keys]].


## Index status as of 2026-08-24 (moved verbatim from MEMORY.md)
- [#5820 RSVP fine WPM entry](rsvp-fine-wpm-entry-5820.md) MERGED #5825; Chrome + Xiaomi verified; Chrome-MCP `key Escape` only blurs, deep link needs cold start, `pnpm exec dotenv` outside scripts
