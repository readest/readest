---
name: settings-row-two-controls
description: "SettingsSelect max-w-[60%] truncates inside a wrapper div; swatch+select must be SIBLINGS of SettingsRow with ms-auto on the swatch"
metadata:
  type: reference
---

Putting a color swatch **and** a select in one `<SettingsRow>` has two traps.
Both produce visible bugs and both were hit while building #5938
([[header-footer-style-5938]]). Codified in `DESIGN.md` §5 "Two controls in one
suffix".

**1. Never wrap them together in a `<div>`.** `SettingsSelect`'s root carries
`flex max-w-[60%]`, and that 60% resolves against its **containing block**. A
shared wrapper shrinks to fit its content, so 60% of that is a few dozen pixels
and every option label truncates — `Auto` renders as `Au`. Pass both as direct
children of `SettingsRow` so the select sizes against the row.

**2. Put `ms-auto` on the swatch.** `SettingsRow` is `flex … justify-between`,
so with three items (label, swatch, select) the free space lands *in front of
the middle item* and the swatch drifts horizontally with each row's label
width — swatches in adjacent rows visibly fail to line up. `ms-auto` on the
swatch collapses that space so swatches align down the list. Logical property,
never `ml-`/`mr-` (RTL).

```tsx
<SettingsRow label={_('Background Color')}>
  {isHexColor(value) && (
    <div className='ms-auto'>
      <ColorInput … />
    </div>
  )}
  <SettingsSelect … />
</SettingsRow>
```

Canonical example: the Text Color / Background Color rows in `LayoutPanel.tsx`.
`ColorInput` (`components/settings/theme/ColorInput.tsx`) takes no `className`,
hence the wrapper div for `ms-auto`.
