---
name: reading-ruler-eink-6048
description: Issue #6048 reading ruler on e-ink - what was fixed, what was declined, and why eink-bordered is wrong for see-through overlays
metadata:
  type: project
---

Issue #6048 (shahram7, the repeat e-ink reporter behind #5174) asked to move the ruler
color from the band to the surrounding lines and to auto-hide the outline above opacity 0.4.

**PR #6055** (branch `fix/reading-ruler-eink`, commit 724ea45a1), issue left OPEN on purpose.

**Shipped instead** (`ReadingRuler.tsx`, single `bandStyle` + `bandOutlineClass` pair feeding
all three layout branches): the ruler had NO e-ink handling at all. On B&W e-ink the band's
`backdrop-filter: sepia()` tint only lowered contrast on the text being read, so it is dropped
there (`isEink && !isColorEink`, matching the `annotatorUtil.ts` precedent - color e-ink keeps
its tint). E-ink also always gets a full-opacity `border-base-content` outline instead of the
translucent `border-base-content/55`, which washes out.

**Declined, with reasons posted on the issue:**
- Tinting the surroundings instead of the band: B&W e-ink renders every hue as the same gray,
  so it changes nothing on the reporter's own platform, and the contrast math is a wash
  (50% white over black text ~4.0:1, 50% red ~4.5:1). It would also regress the deliberate
  Kindle-style band tint from #3011.
- Auto-hiding the outline above opacity 0.4: hidden coupling between two unrelated controls,
  and 0.4 sits BELOW the shipped default of 0.5, so it would silently strip the outline from
  every default install.

**Gotcha:** do NOT reach for `eink-bordered` on an overlay that must stay see-through.
CLAUDE.md recommends it broadly, but its rule sets `background-color: base-100 !important`,
which would paint the ruler band opaque and hide the text under it. Use a bare
`border-base-content border` there. The dim overlays and all transitions need no e-ink work:
`.no-transitions *` already kills transitions globally in e-ink mode.

Related: [[eink-per-device-css-data-eink-5795]], [[annotator-overlay-z-layers]]
