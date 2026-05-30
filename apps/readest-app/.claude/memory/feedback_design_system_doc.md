---
name: Design rules live in DESIGN.md
description: Readest has a design system doc — codify recurring UI/UX rules there, don't just apply them ad-hoc. Memory points at the canonical location and the patterns it covers.
type: feedback
originSessionId: 85757e57-a029-40f8-b098-88039c43514b
---
The project's design system is documented at `apps/readest-app/DESIGN.md`.
**When the user articulates a UI/UX rule** ("X should always Y", "we follow Z
convention"), add it to DESIGN.md so it persists for the team and for future
sessions — don't just apply it inline and move on.

**Why:** Readest's UI is Adwaita-aligned, e-ink-first, cross-platform-aware.
A doc'd system avoids drift across panels and gives reviewers a reference
point. The user explicitly asked to "remember the UI/UX rules somewhere"
when refining the OPDS Integration sub-page.

**How to apply:** When the user surfaces a new rule:
1. Add it to the appropriate `DESIGN.md` section (numbered principles in §2,
   anatomy details in §5, anti-patterns in §10).
2. Cross-reference from related sections so it's discoverable from multiple
   entry points.
3. Save the actual code change reference if it captures a canonical example.

**Rules already codified there (don't re-invent — reference instead):**
- §2.1–2.7: surface continuity, color discipline, two-step depth, localized
  hover, motion=color, eink-first, focus visibility.
- §2.8: RTL — always use logical properties (`ps`/`pe`/`ms`/`me`/`text-start`
  /`text-end`/`border-s`/`border-e`/`start-*`/`end-*`). Never `pl`/`pr`/`ml`
  /`mr`/`text-left`/`text-right`/`left-*`/`right-*`. The user is strict on
  this — Readest ships RTL languages.
- §2.9: every panel/sub-page must open with title + one-line description.
- §3: surface tier hierarchy (window/view/card → base-200/100-tinted/100).
- §4: action vocabulary (Accent CTA, Suggested, Flat, Pill, Destructive,
  ListExtension).
- §5: boxed list anatomy + uniform row height (`min-h-14 items-center`,
  never `py-3`) + chromeless controls inside the box + end-aligned values
  with custom `<MdArrowDropDown>` icon (don't trust daisyui's bg-image
  chevron for trailing-edge alignment).
- §8: e-ink overlay rules.
- §10: anti-pattern catalog with real before/after examples.

**Common file paths to remember:**
- `apps/readest-app/DESIGN.md` — source of truth.
- `apps/readest-app/src/components/settings/SubPageHeader.tsx` — title +
  description sub-page primitive that embodies §2.9.
- `apps/readest-app/src/components/settings/integrations/` — the canonical
  reference implementation of the boxed-list-with-rows pattern.
- `apps/readest-app/src/styles/globals.css` — eink overlay rules at
  `[data-eink='true']`.
