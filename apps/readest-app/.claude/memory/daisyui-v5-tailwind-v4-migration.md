---
name: daisyui-v5-tailwind-v4-migration
description: "daisyUI 4->5 + Tailwind 3->4 migration (fixes #5587 select popup color); cascade-layer semantics, compat pins, codemod pitfalls, side-by-side verify recipe"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8eaf85cc-98c4-4e22-a355-1a942e556cc5
  modified: 2026-08-26T12:01:06.754Z
---

MERGED 2026-08-26 as PR #5884 (squash `8ef527af7`); worktree and branch removed. Follow-ups in the same PR: WebView `minSupportedMajor` 92 -> 111 (tauri.conf.json + plugin PR readest/tauri-plugin-webview-upgrade#2, submodule repinned `bbb5bd3`), and `bundle.iOS.minimumSystemVersion` 15.0 -> 16.4 (also project.yml + all 6 pbxproj targets) because iOS 15.8 renders daisyUI 5 wrong: no `color-mix()` (Safari 16.2) or `@property` (16.4), so input borders fall back to currentColor and toggle geometry collapses. macOS floor is still 12.0 = Safari 15, same gap, left alone. Fixes #5587 because daisyUI 5's `select` opts into `appearance: base-select` and themes `::picker(select)` (Chromium 135+), so Windows dark-mode native popups stop rendering white.

**Why:** daisyUI 5 requires Tailwind 4, so the whole config moved into `globals.css` (`@import 'tailwindcss' source('../')`, `@plugin 'daisyui'`, `@plugin './daisyui-themes.ts'` for the 13 built-in themes, `@custom-variant eink/not-eink/theme-dark/hover`). `tailwind.config.ts` is gone; the huge v3 safelist was dropped (no dynamically built class names in `src/`).

**How to apply:**
- Cascade layers bite: daisyUI 5 components sit in `@layer utilities { @layer daisyui.* }`. Unlayered custom CSS beats EVERYTHING (even `w-44` utilities), so the custom rules in globals.css are wrapped in `@layer utilities { ... }` = v3 precedence (utilities win by specificity/order, daisyUI sub-layers lose). `@utility` blocks must stay top-level ("cannot be nested"). Zero-specificity shims (`:where(...)`) are how you override daisyUI without beating utilities.
- v4-look pins in globals.css (all measured against main via computed styles): md fields 3rem (`--size` on .btn, `--in-size-mul`/`--sl-size-mul` 12), small-size type 0.875rem (`--fontsize`, `--font-size-min`), `.checkbox` radius = `--radius-field`, `.menu { width: auto; line-height: 1.25rem }` (v5 = fit-content), `:where(.btn-disabled:not(.btn))` transparent (v5 paints base-content/10 on non-buttons), `.dropdown .dropdown-content { animation: none; transition: none }` (v5 scales details dropdowns on open -> Dropdown's viewport clamp measured a 95% box), toggle track = currentColor with base-100 `:before` knob.
- Theme tokens: `themeVariables()` in themes.ts emits `--color-*` hex + `--radius-selector 1.9rem/--radius-field .5rem/--radius-box 1rem/--depth 0`; `*-content` = 80% mix toward white/black (v4 formula). Runtime custom themes use the same emitter (no more `--b1` oklch triplets / `--fallback-*`).
- Class-name clashes with v5: `progress-info` (daisyUI color modifier, was pseudo-element-only in v4) -> app class renamed `progress-readout`; `dropdown-center` is compatible; `label`/`form-control`/`label-text`/`*-bordered` were replaced with utilities.
- Compat shims that stand in for daisyUI component defaults MUST be `:where()` (zero specificity): a plain `.menu { width: auto }` after the utilities beat `sm:w-44` and collapsed FontDropDown's menu to 0px (its rows are `w-full overflow-hidden`). Two more v4 dropdown semantics restored: closed non-details dropdowns get `visibility: hidden` (v5 uses `display:none`, which an `inline`/`flex` utility on the content overrides -> invisible clickable overlay that changed the user's CJK font), and FontDropDown's "System Fonts" sub-list now opens only when its row is activated (row is `role=button tabIndex=0` + `onClick focus()`, so the nested `.dropdown` becomes `:focus-within`) - user chose this over v4's always-shown sub-list (v4's `.dropdown:focus-within .dropdown-content` matched nested content as a descendant). FontDropDown's nested list carried a dead `relative` class (v4's `.dropdown .dropdown-content` out-specified it; v5 utilities win) -> removed. Browser test: font-dropdown-submenu.browser.test.tsx.
- #5587 only works if selects DON'T set `appearance-none!` (it cancels `base-select`); SettingsSelect/audiobook selects dropped it, `.select::picker(select)` gets base-100 bg + shadow (chromeless selects are `bg-transparent!` so the picker inherited transparent), and `open:outline-hidden!` hides the `:open` ring.
- Tailwind 4 sorts same-property utilities differently (`hidden` < `inline-flex`, `absolute` < `fixed`, `items-center` < `items-end`): "base class + conditional override" patterns silently flip; make them exclusive (`cond ? 'hidden' : 'inline-flex'`). Also arbitrary values now come AFTER named ones (`text-[0.6em] text-xs` shipped 12px on v3, 9.6px on v4) - found only via the real-Chrome check of the library shelf titles; scanner scripts live in the session scratchpad pattern (conflicts.py / arb-conflicts.py).
- Tailwind 4 ships an OKLCH default palette, so every `*-green-500`-style accent shifts (visibly more vivid on P3). globals.css `@theme` pins the v3 hex values for the 14 families the app uses (154 vars, generated from main's `node_modules/tailwindcss/colors.js`); a family not listed opts into the new palette, so add the whole family. Guarded by a browser test (bg-green-500 = rgb(34,197,94)).
- daisyUI 5's toggle already matches v4's look (base-100 track + base-content knob) - do NOT "fix" its colors; only the track width changed (3rem -> 2.5rem), pinned via `:where(.toggle){width:3rem}`. An earlier shim forcing `background-color: currentColor` inverted it to a light track with a dark knob.
- Claude-in-Chrome recipe: production https://web.readest.com vs worktree on :3000 (same account, synced books); keep each browser_batch on ONE tab (cross-tab batches fail "Permission denied"); production's reader header does not reveal on synthetic hover, open Settings from the library menu instead; tab-strip x positions shift when the selected tab label expands, so re-screenshot before clicking a tab.
- Codemod pitfalls (regex over string literals): `!important` in CSS-text strings/tests, event names (`'blur'`), prose in test titles and comments, `${}` nested strings. Guard with: skip literals after `_(`/`it(`/`test(`/`describe(`/`toContain(`, skip tokens ending in `:`, require a dashed token for multi-token strings, require className/clsx context for single-token literals.
- Screenshot fixtures must use app themes (`default-dark`), never daisyUI stock `dark` (its base-content changed in v5; annotation-popup baselines were regenerated for that reason only).
- Side-by-side verify recipe (Chrome extension was NOT connected): run main `pnpm dev-web` (:3000) and worktree `pnpm dev-web -p 3001`, then a Playwright script (`createRequire` from the app dir to resolve `playwright`) renders scenarios on both, composes left/right PNGs and diffs computed styles via `page.evaluate`. Demo books auto-load on web; open "Hamlet" by text so both sides show the same book.

**Post-merge regressions found 2026-08-27 (Chrome-verified against production, which was still v4). Toast + dialog fixes MERGED as PR #5894 (squash `800af00f3`, 2026-08-27); worktree, local branch and remote branch all removed, and the duplicate diff cleared out of the `dev` working tree:
- **Toasts collapsed to their icon.** v4 `.toast` had `min-width: fit-content`; v5 replaced it with `width: max-content`. The component's own `w-auto` (a no-op on v4) now WINS over that, and a fixed box with `inset-inline: 50%` (`toast-center`) plus `width: auto` resolves to **0px** - measured `width: 0px, min-width: 0px, left/right 640px`. Info toasts use `toast-center` at every width, so they were broken everywhere; success/warning/error only below 640px (`sm:toast-end` rescues them above). FIX = drop `w-auto` from Toast.tsx. v5 also moved `.toast`'s `padding: 1rem` into the insets, so the app's inline `top` (header height 44) lost the 16px gap under the top bar -> `TOP_BAR_HEIGHT + TOAST_GAP`. Do NOT restore the padding in globals.css: v5's `bottom: 1rem` / `inset-inline: auto 1rem` would then double to 2rem.
- **`loading-lg` shrank 2.5rem -> 1.75rem** (v5 put the sizes on `calc(var(--size-selector,.25rem) * N)`, lg = 7). xs/sm/md are unchanged. Already fixed by chrox in #5892 (`8f9028579`) with `:where(.loading-lg){width:2.5rem}` - do not re-fix.
- **Dialog close showed a title-only strip.** NOT a v5 regression (production v4 does the same) but v5 makes it worse: v4 faded the whole `.modal` (`opacity: 0` in the base rule, 200ms, no delay); v5's `.modal` base has no opacity at all, only `visibility .3s allow-discrete`, and `.modal-box` fades `opacity .2s ease-out 50ms`. All 8 dialogs gate their body on `isOpen` (`<Dialog isOpen={o}>{o && <Body/>}</Dialog>`), so the body unmounts on the closing frame and the box collapses onto its header. FIX in Dialog.tsx: hold the last body in a ref + state for `CLOSE_TRANSITION_MS` 300 (box opacity is already 0 at 250ms, so the unmount is never visible). PlayerView.test.tsx needed `await waitFor(...toBeNull())` because the episodes sheet's rows now outlive the close.

- **Loading dots ran at reduced-motion speed for everyone (4th post-merge regression, MERGED 2026-08-27 as PR #5906, squash `9131dc946`; worktree + local/remote branch removed; all 14 CI checks green, CodeRabbit clean; reporter = chrox, no device verify needed since it is CSS-only).** daisyUI 5 ships each `.loading-*` mask TWICE: a slowed base rule that stands in for reduced motion (dots `dur='3s'`, infinity `6s`), then an `@media (prefers-reduced-motion:no-preference)` override at full speed (dots `1.05s`, infinity `2s`). Tailwind 4 REORDERS them inside `@layer utilities`, and not uniformly: `.loading` and `.loading-spinner` keep base-then-media (correct), while `.loading-dots`, `.loading-infinity` AND the `not-eink:loading-dots` variant copy come out media-then-base, so the SLOW mask wins. Visible as dots that drift up and down instead of bouncing. Upstream bug: daisyui.com itself computes `dur='3s'` with `prefers-reduced-motion: no-preference` matching. The v5 full-speed SVGs are BYTE-IDENTICAL to v4's, so re-applying them restores the v4 look exactly. FIX in globals.css (`@layer utilities`, after the `:where(.loading-lg)` pin): one `@media (prefers-reduced-motion: no-preference)` block re-declaring the fast masks for `:where(.loading-dots)` and `:where(html:not([data-eink='true'])) :where(.not-eink\:loading-dots)` (Spinner.tsx + EpisodesView reach dots through that VARIANT class, which `:where(.loading-dots)` does NOT match -- and it must stay e-ink-gated or e-ink loses its `loading-spinner` swap) plus `:where(.loading-infinity)`. Guarded in daisyui-v5-tokens.browser.test.tsx by asserting the `dur=` values parsed out of the computed `maskImage`.
- **Diagnosis recipe for "which daisyUI rule actually won":** `npx @tailwindcss/cli -i src/styles/globals.css -o out.css` renders the app's real cascade in ~600ms (no dev server, no Next build); then scan for each selector's occurrences and note which is LAST. Reading `node_modules/daisyui/components/*.css` alone is misleading -- the authored order there is correct and Tailwind is what flips it.

**Verify recipes that worked here (no worktree needed):**
- Production `https://web.readest.com` was STILL daisyUI 4 on 2026-08-27, so `curl` its `/_next/static/css/*.css` and grep `.toast{`/`.loading-lg{`/`.modal{` for the exact v4 rules; the v4 tarball also works: `curl -sL https://registry.npmjs.org/daisyui/-/daisyui-4.12.24.tgz | tar xz package/dist/full.css` (unminified, so match `^\.sel\s*\{` with a regex, not `.sel{`).
- Open the About dialog from the console with the app's own code path: `document.getElementById('about_window').dispatchEvent(new CustomEvent('setDialogVisibility',{detail:{visible:true}}))`; clicking the version string fires a real info toast.
- To SEE a close/enter animation, inject a slow-mo style (`transition-duration: 4s !important; transition-delay: 0s !important`) and screenshot - `requestAnimationFrame` and sub-second `setTimeout` are THROTTLED in a backgrounded Chrome tab, so rAF sampling loops hang the CDP call for 45s and `setTimeout` snaps to 1000ms.

**Dialog close hold: an EFFECT is the wrong place, and useLayoutEffect is not enough (React 19).** `useEffect` hands the body back after the browser may already have painted; `useLayoutEffect` looks like the fix but React 19's `flushSpawnedWork` calls `flushPendingEffects` -> `flushPassiveEffects` BEFORE it runs the re-render a layout effect spawned, so the body-less tree is still committed and observable (proved with a probe component: `{body:false, height:60, visible:true}` under useLayoutEffect too; the paint itself was fine). The working shape derives the held body DURING RENDER - `const body = isOpen ? children : isBodyHoldOver ? null : lastBodyRef.current` - so no body-less tree is ever built, and the body is reconciled instead of unmounted+remounted for the fade. State only ends the hold.

**Testing paint-order guarantees in the browser project:** a rAF sampler alone does NOT catch a deferred handoff (React's passive flush usually beats the frame, so the effect version passes). Two instruments together work: (1) a `CommitProbe` rendered AFTER the component whose `useEffect` samples the DOM on every commit - deterministic, fails on the effect version; (2) the rAF sampler for the user-visible property. Both need the close driven OUTSIDE act (`globalThis.IS_REACT_ACT_ENVIRONMENT = false` around it) from a `requestAnimationFrame` callback, or act flushes the effects and hides the ordering. Do NOT mount with `react-dom/client` directly in a browser test - it resolves a second React copy and dies with `Cannot read properties of null (reading 'useState')`; use RTL's `render` and toggle the act flag.

**Never measure a daisyUI 5 toast with `getBoundingClientRect` until its animations finish.** v5 adds `.toast > * { animation: .25s ease-out toast }` (scale .9 -> 1) on the ALERT, on top of the component's own 300ms scale/opacity transition, and rect reads see both: CI read a top of 62.8 instead of 60 while my machine passed. Waiting on computed opacity is not enough. `for (const a of el.getAnimations({subtree:true})) a.finish()` then one rAF is exact and 10x faster than waiting on the clock.

**Tailwind v4 `rotate-*` / `scale-*` / `translate-*` COMPOSE with `transform`; they no longer lose to it.** v3 folded them into `transform` via `--tw-rotate`, so an inline `style={{transform:'rotate(180deg)'}}` overrode a `rotate-180` class. v4 emits the standalone CSS `rotate` property, and the engine applies `translate` -> `rotate` -> `scale` -> `transform` in sequence, so BOTH apply and the angles ADD. Found 2026-08-27 in the selection-drag `Handle` (`AnnotationRangeEditor.tsx`), which carried `className={clsx(type==='start' && 'rotate-180')}` next to an inline transform: the start handle got 180+180=0 horizontally and 180+270=90 vertically, rendering identical to the end handle instead of mirroring it (the ball sat on the text side rather than outside the column). Fix = delete the class, keep the inline transform as the single source. DIAGNOSIS RECIPE on-device: `getComputedStyle(svg)` reports them SEPARATELY - `rotate: "180deg"` alongside `transform: "matrix(0,-1,1,0,0,0)"` - so a computed-style dump is the tell; the composed result never shows up in `transform`. `svg.style.rotate='none'` patches it live for a before/after screencap without a rebuild. Audit any `rotate-*`/`scale-*`/`translate-*` class that shares an element with an inline or CSS `transform`.

Related: [[bug-patterns]], [[css-style-fixes]], [[eink-class-substring-matchers]].

## Select regressions found 2026-08-28 (device-verified on Xiaomi, Chrome 153)

Three separate v5 select regressions, all in the translator popup / settings selects:

1. **Options wrap.** daisyUI ships `:is(.select,.select select) option { white-space: normal }`.
   Because `.select` opts into `appearance: base-select` the picker is painted
   IN-PAGE, so CSS on `<option>` is live and long entries ("Português (Brasil)",
   "System Language") wrap in a narrow select. FIX: `:where(.select) option
   { white-space: nowrap }` in globals.css `@layer utilities`.

2. **Value no longer end-aligns.** `Select.tsx` sets `text-align-last: end`, which
   worked in v4. In v5 it is inert for two reasons: `.select` gets
   `width: clamp(3rem,20rem,100%)` so the box stretches to its max width whatever
   the value is (200px while the value needs 96-154px), and the value is painted
   into a UA-generated `<selectedcontent>` in the SHADOW ROOT. Author CSS cannot
   reach it -- verified: `text-align:end` on the select and an injected
   `select.select selectedcontent{text-align:end}` both did nothing, and daisyUI's
   own `selectedcontent` rule is equally inert. FIX: `w-auto` on Select so the box
   hugs its value; `justify-between` on the row then puts it against the chevron.

3. **Picker popup not flush with the select.** daisyUI already end-aligns it
   (`position-area: self-start span-self-start`) then pushes it back 16px:
   `margin-inline: 8px` + `translate: -8px` (mirrored `[dir=rtl] translate: .5rem`).
   FIX: `margin-inline-end: 0; translate: none` on `:where(.select)::picker(select)`.
   Keep the START margin so a wide picker stays off the opposite edge.

**How to debug a `::picker(select)`:** it has no DOM node, so measure it with
`getComputedStyle(select, '::picker(select)')` -- that returns real `translate`,
`margin-inline-*`, `position-area`, `width`. To prove a selector reaches it, set
`background-color: red` and screenshot. Do NOT eyeball pixel offsets from
screenshots; and note Chrome 153 in the Android WebView does NOT support
`justify-self: anchor-end` or `anchor()` in `inset-inline-*` (both silently
dropped), while `position-area` IS supported.

**Also fixed the same day:** `TranslatorPopup` used
`grid-rows-[1fr,auto,1fr,auto]`, which Tailwind emits verbatim as
`grid-template-rows:1fr,auto,1fr,auto` -- commas are not track separators, the
browser DISCARDS the declaration, and every row became an implicit auto track
sized to content, pushing the translated pane and the provider footer off screen
with nothing scrollable. Tracks need `_` separators AND `minmax(0,1fr)` (a bare
`1fr` floors at min-content and overflows the capped popup again). This was the
only comma-in-arbitrary-grid usage in the repo. RULE: assert resolved layout in a
browser test, never the class string -- and on the popup itself
`getComputedStyle().gridTemplateRows` reports USED track sizes even when the
declaration was dropped, so probe an EMPTY grid with the same class, where a
dropped declaration reports `none`.

OPEN (minor, not fixed): `.select` also carries `flex-shrink: 1`, so in a narrow
popup the footer's provider select can be shrunk ~4px below its content and
`truncate` clips the label ("Yandex Translate" measured clientW 150 / scrollW 154
in a narrow popup; clean at 154/154 in a 367px-wide one). `shrink-0` would fix it
but no deterministic failing test could be built, so it was left alone.

## Post-merge regression 2026-08-28: `.modal-box` never paints without a `.modal`

MERGED as PR #5916 (squash `f8a3e3d2d`), branch deleted. Reporter verify pending;
never clicked through a running app (the menu item is behind sign-in), proven at the
CSS layer against the real compiled stylesheet.

**Symptom:** Library -> account submenu -> "Cloud File Transfers" dimmed the screen
and showed nothing. Same for the Group Books sheet and the Annotator's
"importing annotations" spinner.

**Root cause:** daisyUI 4 kept the enter animation on `.modal`; daisyUI 5 moved it
onto the child (`.modal-box{opacity:0;scale:.95}`) and only un-hides it from
`.modal:is(.modal-open,[open],:popover-open,:target)>.modal-box`. The app also uses
`.modal-box` as a standalone BOX CHASSIS (bg-base-100, radius, shadow, and the
`[data-eink='true'] .modal-box` border) under its own hand-rolled `fixed inset-0`
overlays. Those boxes have no `.modal` ancestor, so they laid out, swallowed
clicks, and never painted -- the backdrop was the only thing visible.

**Fix** (`globals.css`, `@layer utilities`, one rule, covers every present and
future site):
```css
:where(.modal-box):not(:where(.modal *)) { opacity: 1; scale: 1; }
```
`:where()` keeps specificity 0 so Tailwind utilities still win; the rule sits
UNLAYERED inside `@layer utilities` while daisyUI ships in the nested sublayer
`daisyui.l1.l2.l3`, and unlayered-in-a-layer beats that layer's sublayers
regardless of specificity. The `:not(:where(.modal *))` guard is load-bearing: a
box inside a CLOSED `.modal` must stay at opacity 0 or `Dialog.tsx`'s close
transition (guarded by `dialog-close-frames.browser.test.tsx`) breaks.

**Sites that were dark:** `TransferQueuePanel.tsx:256`, `GroupingModal.tsx:257`,
`Annotator.tsx:2286`. Correct already (inside `.modal modal-open` / `<dialog
class='modal' open>`): CatalogManager, FailedDownloadsDialog, TelemetryConsentDialog,
KeyboardShortcutsSettings (patched per-site in #3772 -- see
[[custom-shortcuts-3772]]), AppLockDialog, PassphrasePrompt, CustomDictionaries,
Dialog.tsx.

**Sweep for the same bug class** (a daisyUI child class whose OWN base rule hides
it until an ancestor/sibling state matches): parse `node_modules/daisyui/components/*.css`
for base-layer blocks declaring `opacity:0` / `display:none` / `visibility:hidden`.
The full v5 list is `modal-box`, `collapse-content`, `drawer-side`, `tab-content`,
`validator-hint`, `menu-dropdown`, `megamenu-vertical`, `floating-label>span`,
`swap-on/off`. Only `modal-box` and `collapse-content` are used here, and the one
`collapse-content` (`Notebook.tsx:490`) sits in a real `.collapse`. NOT this bug:
`dropdown-content` hides only via `.dropdown ... .dropdown-content`, so a bare one
is over-visible rather than invisible.

Regression test: `src/__tests__/styles/modal-box-standalone.browser.test.ts`
(browser, real stylesheet -- a jsdom test cannot see this).

## Bracket-stripping an arbitrary value only works for values Tailwind NAMES (2026-08-31, PR #5985 `d49fd8ba5`)

"Canonicalizing" `p-[Npx]` -> `p-Npx` by deleting the brackets produces a class
that matches NOTHING and emits NO CSS -- silently, since Tailwind has no unknown-class
diagnostic and `pnpm lint` (biome + tsc) cannot see into a string literal. Caught in
`BookItem.tsx` where a staged edit had turned `pt-[2px] sm:pt-[1px]` into
`pt-2px sm:pt-1px`, dropping the optical-alignment nudge under both library icons.

The spacing scale has exactly ONE named non-numeric key, `px` (= 1px hairline), so:

| class | emitted |
| --- | --- |
| `pt-px`, `sm:pt-px` | `padding-top: 1px` |
| `pt-0.5` / `-mt-0.5` | `calc(var(--spacing) * ±0.5)` = ±2px at the default 0.25rem `--spacing` |
| `pt-[1px]`, `pt-[2px]` | correct, just non-canonical |
| `pt-1px`, `pt-2px` | **nothing** |

So VS Code's `tailwindcss(suggestCanonicalClasses)` hint on `sm:pt-[1px]` reads
`sm:pt-px`, NOT `sm:pt-1px` -- the shorthand is the scale key, never the raw length.
`pt-[2px]` draws no hint at all because 2px has no key; `pt-0.5` is the rem-based
near-equivalent (chrox's preferred landing form here, and for `sm:mt-[-2px]` ->
`sm:-mt-0.5` in `HighlightOptions.tsx`) but it TRACKS root font size where the
bracket form is pinned, so it is a behaviour change, not a pure rename.

**Verify recipe (no dev server, no Next build, ~1s):** drive the project's own
compiler over the candidate list and read back which rules exist. `tailwindcss`
resolves only from the app dir, so the script must live there (not in the scratchpad):
```js
// apps/readest-app/tw-check.mjs
import { compile } from 'tailwindcss';
import fs from 'node:fs/promises'; import path from 'node:path';
const c = await compile('@import "tailwindcss";', {
  base: process.cwd(),
  loadStylesheet: async () => {
    const p = path.resolve(process.cwd(), 'node_modules/tailwindcss/index.css');
    return { path: p, base: path.dirname(p), content: await fs.readFile(p, 'utf8') };
  },
});
console.log(c.build(['pt-px','pt-1px','aspect-28/41']).split('@layer utilities')[1]);
```
A class absent from that output emits nothing. (`npx @tailwindcss/cli -i
src/styles/globals.css` from the diagnosis recipe above renders the full app cascade
instead, and is the tool when the question is which rule WON rather than whether a
class exists.) `aspect-[28/41]` -> `aspect-28/41` IS a real v4 shorthand (bare
fractions are ratios) and was kept.
