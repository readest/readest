---
name: eink-class-substring-matchers
description: "globals.css e-ink rules use [class*=] substring matching, so they fire on hover:/not-eink: variants and outrank inline styles"
metadata: 
  node_type: memory
  type: project
  originSessionId: eb38cb03-e7cd-4bde-9139-101b0811baf3
  modified: 2026-08-16T05:49:31.215Z
---

`src/styles/globals.css` flattens colors in e-ink with **substring** attribute
matchers plus `!important`:

```css
[data-eink='true'] [class*='text-base-content'] { color: base-content !important; }
[data-eink='true'] [class*='bg-base-content']   { background-color: base-content !important; }
```

Two traps, both hit in #5667:

1. **`!important` outranks an inline `style={{ color }}`.** A component that
   sets its own contrasting ink inline is silently flattened. Fix = don't emit
   `text-base-content` on that element at all.
2. **`[class*=]` matches the class attribute as plain text, so it fires on
   variant-prefixed utilities.** `hover:bg-base-content/10` and even
   `not-eink:hover:bg-base-content/10` were painted **solid at rest, on every
   screen**. That is what made the footer bar page indicator and the progress
   panel page bubble render as black pills. It also caused #4454, which was
   worked around per-element by adding `eink-inverted`.

MERGED #5735 fixed the bg matcher with
`[class*='bg-base-content']:not([class*=':bg-base-content'])`.
The `text-base-content` matcher was left as-is (its variant uses want
flattening anyway). Audited blast radius: only `PageJumpInput` and
`ParagraphBar` changed; the three `group-hover:bg-base-content` badges in
`CustomFonts`/`CustomDictionaries` carry `eink-inverted` and are unaffected;
`eink:bg-base-content` (TTSMiniPlayer) emits its own higher-specificity rule.

Cascade order matters: `.eink-inverted` (line ~553) is declared AFTER the
substring matchers and has equal specificity, so it wins. Never reorder them.

**Why:** `not-eink:` looks like it should exempt an element. It does not — the
override is a global rule keyed on the class-attribute string, not on the
Tailwind variant.

**How to apply:** in e-ink, resolved colors are the only truth. Assert
`getComputedStyle`, never the class string. Browser tests
(`*.browser.test.tsx`) import `@/styles/globals.css` and run real Chromium,
so they are the only place this cascade is testable —
`src/__tests__/components/eink-base-content-bg.browser.test.tsx` guards it.
Related: [[eink-highlight-difference-mask-5667]].

## Two more traps (2026-08-30, yearly-subscription store front)

3. **`bg-primary/10` is NOT matched by the `.bg-primary` e-ink rule.** That rule
   is an exact class selector (`[data-eink='true'] .bg-primary`), not a
   substring matcher, so an opacity-suffixed tint keeps its brand colour while
   the plain class inverts — sibling plan badges rendered inconsistently in
   e-ink. The `bg-base-content` rule is the reverse: it IS `[class*=]`, so
   `bg-base-content/10` was forced to a **solid** fill, painting base-content
   text on a base-content ground (invisible pill). Rule of thumb: for any
   tinted chip, stay on `bg-base-200`/`bg-base-300`, which no e-ink rule
   touches.
4. **`btn-primary`, `btn-contrast` and `btn-outline` all collapse to the same
   solid `base-content` fill in e-ink** (one shared rule, globals.css ~1037).
   Two sibling CTAs styled with any two of them are indistinguishable on
   e-ink — exactly the failure CLAUDE.md's "can you still tell which button is
   the CTA" test exists to catch. To keep a recommended action distinct, pair
   ONE of those classes with a plain `btn eink-bordered` (which stays an
   outline); never two solids.

Both were found by rendering the component in a `*.browser.test.tsx` with
`[data-eink='true']` set on `documentElement` and screenshotting it — the
class strings look correct in every case.
