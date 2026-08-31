---
name: settings-scope-menu-5933
description: "PR #5933 landed as a 1-file menu-label fix, not a scope banner; includes measured proof that the info/warning tint pair fails on every Readest theme"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7698bb2c-d1c5-4bfa-820f-1d84b319ce69
  modified: 2026-08-29T18:53:22.075Z
---

#5932 "readers don't know the Settings dialog has a scope" was fixed by relabelling
the ⋮ menu, not by adding a surface. MERGED as #5933 (squash `5755f25d7`, 2026-08-29).

ROOT CAUSE was narrower than the issue framed it: the consequence text
(`Apply to All Books` / `Apply to This Book`) existed but lived in `buttonClass='lg:tooltip'`
plus `MenuItem`'s native `title` attribute. Native `title` never fires on touch and `lg:`
starts at 1024px, so on phones/tablets the row read only "Global Settings" + a checkmark —
the mode named, the consequence invisible. Fix = two exclusive `toggled` rows using the
house idiom (library `ViewMenu.tsx:199`). Both strings already existed in all 34 locales,
so 0 new i18n keys, 0 new UI.

The contributor's original PR was a tinted banner in the dialog header (+742/−37, 43 files);
it was declined and reworked down to +18/−8 in one file. Two reusable lessons:

**1. `--color-info` / `--color-warning` tints DO NOT WORK in this app. Measured, don't re-derive:**
`STATE_COLORS` (themes.ts:60-64) is one fixed pair — info `oklch(72.06% .191 231.6)` → `#00b5ff`,
warning `oklch(84.71% .199 83.87)` → `#ffbe00` — applied identically to all 11 themes. Being
theme-invariant is why it fails, not why it's safe:
- `bg-info/15` vs `bg-warning/10` land **1.02–1.09:1 against each other** (indistinguishable).
- A 4px `border-s-4` accent misses DESIGN.md §7's 3:1 floor on **every** light theme:
  1.49 default-light, 1.24 sepia, 1.11 gray.
- Dark themes invert it: bar reads fine (5.3–8.0:1) but the two tints collapse to 1.02:1.
There is **no theme where both signals work**. Before this PR, `bg-info`/`border-info`/`text-info`
had **zero** consumers in `src/`. `bg-warning/10` has 4 (MigrateDataWindow, CatalogManager, 2 reedy),
all with a full border. Contradicts DESIGN.md §2.2 (settings = zero brand colour) and §2.3
(state cycles base-100→200→300 *because* that's theme-safe). Use the `Tips` surface
(`bg-base-200/40`) + icon + words instead. See [[eink-class-substring-matchers]].

**2. An always-on indicator teaches nothing.** The banner rendered on every panel, in every
scope, and in the library — so in the default state (where nearly every session sits) it just
restated the default, while costing ~31px permanently on a sheet `snapHeight` caps at 70% on
mobile. Only mark the *unusual* state, or don't mark it at all.

Sizing evidence that justified declining: #5932 had 0 comments/0 reactions and was filed by the
PR author; #5296 (move book settings to reader view) has 1 upvote and would dissolve the flag
rather than explain it. Global-by-default also matches Kindle/Apple Books/Play Books.

`ViewSettings.isGlobal` is `boolean` (types/book.ts:471) — NOT optional. So
`getViewSettings(k)?.isGlobal ?? true` only defaults when the whole object is null, and any
`typeof x === 'boolean'` guard on the field is unreachable. A helper wrapping this was added
then removed; inline is the house spelling (17 files).
