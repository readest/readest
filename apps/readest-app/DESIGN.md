## Readest Design Language

Readest's UI is **Adwaita-aligned**, **e-ink-first**, **cross-platform-aware**. This doc is the
reference for that language: principles, vocabulary, anti-patterns. New work should read it
before reaching for daisyui defaults; existing work is gradually migrating toward it.

### Status

This doc is the **first articulation** of the system, not a retrospective. Many existing
components don't fully match it yet (especially older buttons and ad-hoc panels). The goal
is that **new code uses these conventions** and **migrations land opportunistically** as
features get touched.

---

### 1. Identity & lineage

Readest's visual language descends from **Adwaita / libadwaita** — GNOME's design system —
adapted for a cross-platform Tauri + Next.js app that also runs on iOS, Android, web, and
e-ink readers.

What we take from Adwaita:

- **Content first, chrome recedes.** The reading surface is the product. Settings, toolbars,
  popups never compete with the page.
- **Boldly minimal.** Restraint over density. Whitespace is structural.
- **Surface hierarchy** — window → view → card — three explicit elevation tiers, no shadow
  gymnastics.
- **Color discipline.** Brand color is rare and earned. Neutral palette carries the weight.
- **Boxed lists are the chassis.** AdwActionRow's prefix · title · suffix anatomy is the
  canonical settings/list row everywhere.
- **Pills, ghosts, flats.** Three-tier button palette: pill/circular ghost in headers, flat
  secondary over view-bg, accent CTA only when truly primary.
- **Banner vs Toast.** AdwBanner = inline, top-of-window, persistent. AdwToast = transient,
  bottom slide-in.
- **Switches over checkboxes** for boolean settings.
- **Subtle motion.** Short, ease-out, never bouncy.

What's Readest-specific:

- **E-ink as a first-class mode.** Every surface flips to flat 1px contrast borders under
  `[data-eink='true']`. Adwaita is desktop-GNOME-only; we ship to e-ink readers and the
  visual language has to survive there.
- **Cross-platform reality.** Readest runs on macOS, Windows, Linux, iOS, Android, web. The
  identity stays Adwaita; platform grace notes (radii, target sizes) follow host
  conventions where they matter.

---

### 2. Principles

The seven rules. When in doubt, work backward from these.

#### 2.1 Surfaces continue surfaces

A control that extends a list/card should match its parent's border + fill. The
"+ Import Dictionary" button at `src/components/settings/CustomDictionaries.tsx` reads as
detached card siblings of the dictionary list above it because they share
`border-base-200 bg-base-100 rounded-lg`.

> **Bad**: a list of dictionaries in a `bg-base-100` card, followed by a `btn-outline btn-primary`
> add button. The button shouts; the list whispers; the eye bounces.
>
> **Good**: list and add-button share the same surface vocabulary. The eye flows.

#### 2.2 Color is earned

Brand `primary` is reserved for **the** primary action of a surface. Most actions don't have
a primary action — they have a list of equally-weighted choices, or a single accent.

- Settings dialog has no primary. Every panel is a list of toggles. **Zero brand color.**
- "Import a Book" in onboarding is a primary CTA. **One brand color.**
- "Add Web Search" extends a list — it's not the surface's primary action. **Neutral.**

#### 2.3 Two-step depth

State changes cycle through **`base-100 → base-200 → base-300`** instead of recoloring.
Hover lifts, active deepens, disabled fades opacity. This is theme-safe (works across all
11 color themes), e-ink-friendly (depth is preserved as borders, not shades), and
calmer than recoloring.

#### 2.4 Localize the hover signal

When a button hovers, **one focal element changes**, not the whole button. The icon chip
inverts; the label stays steady. The badge intensifies; the row stays neutral. This reads
as deliberate, not decorative.

#### 2.5 Motion is color, not transform

Default to `transition-colors duration-150`. No `scale`, no `translate`, no `rotate` unless
the motion **is** the message (a chevron rotating to indicate expansion is fine; a button
that scales on hover is not). Transforms break under `[data-eink='true']` and feel
gimmicky under Adwaita's calm rhythm.

#### 2.6 Eink-first by default

Every custom-styled bordered surface gets the `eink-bordered` class. Every primary action
gets `btn-primary` (which has dedicated eink rules). Don't rely on color or shadow alone
for hierarchy — eink screens have neither.

If you can't toggle Settings → Misc → Eink and still tell which button is the CTA, the
hierarchy is broken.

#### 2.7 Focus is visible but quiet

Keyboard focus needs a visible ring. `focus-visible:ring-2 focus-visible:ring-base-content/15`
is the canonical treatment for custom buttons. Loud `ring-primary` reserved for inputs
where the focus state IS the affordance.

#### 2.8 RTL: always use logical properties (REQUIRED)

Readest ships with RTL languages enabled. **Never use direction-bound Tailwind
utilities** when a logical equivalent exists — the visual edges flip in RTL,
the logical ones don't.

| Don't use                          | Use instead                        |
| ---------------------------------- | ---------------------------------- |
| `pl-*` / `pr-*`                    | `ps-*` (start) / `pe-*` (end)      |
| `ml-*` / `mr-*`                    | `ms-*` / `me-*`                    |
| `text-left` / `text-right`         | `text-start` / `text-end`          |
| `border-l` / `border-r`            | `border-s` / `border-e`            |
| `rounded-l-*` / `rounded-r-*`      | `rounded-s-*` / `rounded-e-*`      |
| `left-*` / `right-*` (positioning) | `start-*` / `end-*`                |
| `justify-start` / `justify-end`    | (these ARE direction-aware) — keep |

The `flex-row` direction is automatically reversed in RTL by the browser, so
you usually don't need to do anything for `flex` / `gap`. Only **explicit
edges** (padding, margin, borders, radius, absolute positioning) need
logical properties.

**Quick scan when reviewing a diff:** grep for `\b(pl|pr|ml|mr|left-|right-|text-left|text-right|border-l|border-r|rounded-l|rounded-r)-` in changed files. Any hit that isn't a deliberate LTR-only
case (rare — usually only icon glyphs that have a fixed orientation) should
be flipped to the logical equivalent.

#### 2.9 Every panel and sub-page starts with title + description (REQUIRED)

Every settings panel and every sub-page must open with:

1. **A title** — the panel name. Style: `text-lg font-semibold tracking-tight`. In a
   top-level panel this is an `<h2>`; in a sub-page this is the `parentLabel /
currentLabel` breadcrumb in `SubPageHeader` (which uses the same typography so the
   word stays anchored visually as the user navigates in/out).
2. **A one-line description** — a short sentence under the title explaining what this
   surface does or how it fits in the user's workflow. Style: `text-sm
text-base-content/70 leading-relaxed`. Skip it only when the surface is so trivial
   the breadcrumb already says everything (rare — when in doubt, write one).

Why: orientation, visual rhythm, and Adwaita parity (`AdwPreferencesPage` always has
both). The same vertical opening across every surface makes the system feel cohesive
and gives users a predictable place to learn what a screen does.

**Canonical components.** The `<SubPageHeader>` primitive in
`src/components/settings/SubPageHeader.tsx` accepts a `description?: React.ReactNode`
prop that renders the description in the canonical style — sub-pages should pass it
there rather than rolling their own `<p>` below the header. Top-level panels currently
inline the title + description; if a third or fourth panel needs the same pattern,
extract a `<PanelHeader>` primitive following the same shape.

**Examples.**

```tsx
// Sub-page (Integrations → OPDS Catalogs)
<SubPageHeader
  parentLabel={_('Integrations')}
  currentLabel={_('OPDS Catalogs')}
  description={_('Browse and download books from online catalogs')}
  onBack={() => setSubPage(null)}
/>

// Top-level panel (Integrations panel root)
<div className='w-full'>
  <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('Integrations')}</h2>
  <p className='text-base-content/70 text-sm leading-relaxed'>
    {_('Connect Readest to external services for sync, highlights, and catalogs.')}
  </p>
</div>
```

---

### 3. Surface hierarchy

Three named tiers, mapped onto daisyui tokens. Use these terms in conversation and code
comments even though the classes are still daisyui-native.

| Tier       | Token                                | Role                                                                          | Example                                         |
| ---------- | ------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| **Window** | `bg-base-200`                        | The outermost backdrop. Modal scrims, dialog content area, scroll containers. | `<Dialog>` body                                 |
| **View**   | `bg-base-100/60` or `bg-base-200/40` | Mid-tier surface inside a window. Tip boxes, secondary panels.                | The "提示 / Tips" callout in CustomDictionaries |
| **Card**   | `bg-base-100`                        | Top-tier content surface. Boxed lists, popovers, modal-box.                   | The dictionaries list card                      |

Border treatment:

- **Window** has no border (it IS the boundary).
- **View** uses no border or `border-base-200/60` for very soft delineation.
- **Card** uses `border border-base-200`. In e-ink, `eink-bordered` flips it to 1px
  `border-base-content`.

Corner radius:

- **Card / View**: `rounded-lg` (8px) — Readest's house radius. Adwaita uses 9px; 8px is
  close enough and matches Tailwind's scale.
- **Modal / Sheet**: `modal-box` default (~1rem / 16px) — bigger surfaces get bigger radii.
- **Pills / Chips**: `rounded-full`.
- **Inputs / small buttons**: `rounded-md` (6px) or `rounded-lg` (8px).

#### Surface continuity rule

When a control extends a card (an "add row" affordance, a footer button bar attached to a
list), it inherits the card's surface treatment: same `bg-base-100`, same
`border-base-200`, same `rounded-lg`. It is the card grown by one row.

---

### 4. Action vocabulary

Six archetypes. Pick by **role**, not by **appearance**.

#### 4.1 Accent CTA

The primary, accent-colored button. **One per surface, max.** Submit on a form, "Open
Book", "Sign In".

```tsx
className = 'btn btn-primary';
```

Eink: `btn-primary` has dedicated rules (inverts to base-content bg + base-100 text) so it
stays distinct from secondary actions on monochrome screens.

#### 4.2 Suggested

A non-accent-but-emphasized action. Used when there are multiple equally-weighted actions
and one is the recommended path. Adwaita's "suggested-action" CSS class.

```tsx
className = 'btn btn-neutral';
```

Rare. Most surfaces don't need this tier.

#### 4.3 Flat

The default secondary button. Sits on a view or card surface, no border, hover lifts to
`base-200`. The bulk of buttons should be flat.

```tsx
className="btn btn-ghost"
// or for a custom surface treatment:
className={clsx(
  'rounded-lg px-4 py-2 text-sm font-medium',
  'hover:bg-base-200 transition-colors duration-150',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15',
)}
```

#### 4.4 Pill / Circular ghost

Compact icon-only buttons in header bars and toolbars. Always `rounded-full`,
`btn-circle` or hand-rolled circular ghost.

```tsx
className = 'btn btn-ghost btn-circle h-8 min-h-8 w-8 p-0';
```

The window controls in `SettingsDialog.tsx` (search, menu, close) use this archetype.

#### 4.5 Destructive

Delete, remove, irreversible. Adwaita uses `destructive-action`. Readest uses red
sparingly — usually only the icon, not the whole button.

```tsx
// Icon-only delete X in delete mode:
className = 'btn btn-ghost btn-sm shrink-0 px-1';
// with <IoMdCloseCircleOutline className="text-error h-4 w-4" />
```

For destructive **dialogs** (confirmation modals), the confirm button can be `btn-error`,
but only in the modal — never on the main surface.

#### 4.6 ListExtension

A Readest-named archetype for "add another row to the list above" affordances. The two
buttons at the bottom of `CustomDictionaries.tsx` are the canonical example.

Anatomy:

- Surface matches the parent card (`border border-base-200 bg-base-100 rounded-lg`)
- Height ~h-11
- Centered: small icon chip + label
- Icon chip: `bg-base-200 text-base-content/60 rounded-full h-5 w-5`
- Hover: border deepens to `base-300`, bg lightens to `bg-base-200/60`, icon chip inverts
  to `bg-base-content text-base-100`
- `eink-bordered` on the button itself

```tsx
<button
  type='button'
  onClick={handleAdd}
  className={clsx(
    'eink-bordered group flex h-11 items-center justify-center gap-2.5',
    'border-base-200 bg-base-100 rounded-lg border px-4',
    'text-base-content text-sm font-medium',
    'transition-colors duration-150',
    'hover:border-base-300 hover:bg-base-200/60',
    'active:bg-base-200/80',
    'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
  )}
>
  <span
    className={clsx(
      'flex h-5 w-5 items-center justify-center rounded-full',
      'bg-base-200 text-base-content/60',
      'transition-colors duration-150',
      'group-hover:bg-base-content group-hover:text-base-100',
    )}
  >
    <MdAdd className='h-3.5 w-3.5' />
  </span>
  <span className='line-clamp-1'>{label}</span>
</button>
```

Use this for: "Import Dictionary", "Add Web Search", "Add Custom Theme", any "+ add new
to this list" pattern. **Do not** use `btn-outline btn-primary` for these.

---

### 5. Boxed list anatomy

The settings UI is built on boxed lists. One pattern, used everywhere.

#### Container

Use the `<BoxedList>` primitive at `src/components/settings/primitives/BoxedList.tsx`
rather than inlining the chassis classes:

```tsx
<BoxedList title={_('Reading Sync')} data-setting-id='settings.section.id'>
  {/* rows */}
</BoxedList>
```

The primitive renders:

```tsx
<div className='card eink-bordered border-base-200 bg-base-100 border'>
  <div className='divide-base-200 divide-y'>{children}</div>
</div>
```

- `card` for the radius
- `border border-base-200` for the boundary (eink upgrades this automatically)
- `eink-bordered` for the e-ink-mode contrast border
- `divide-base-200 divide-y` for inter-row separators

> **No `overflow-hidden` on the card.** Children may host popovers (color
> pickers, dropdowns, tooltips) that need to escape the card bounds. The
> `divide-y` rules sit between rows and don't touch the card's rounded
> corners, so omitting overflow-clip is visually safe AND keeps embedded
> popovers from getting clipped.

#### Row anatomy

Three slots, in order, always:

```
┌─────────────────────────────────────────────────────────────────┐
│ [prefix]   Title text                          [suffix slots]   │
│ [        ] Subtitle text (optional)            [       ][      ]│
└─────────────────────────────────────────────────────────────────┘
```

| Slot         | Contents                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------- |
| **Prefix**   | Drag handle, leading icon, avatar, status dot, or empty.                                          |
| **Title**    | Primary label. `font-medium`. Truncates with `truncate`.                                          |
| **Subtitle** | Optional secondary line. `text-sm text-base-content/70`. Used for warnings, descriptions, status. |
| **Suffix**   | Badge, switch, button, chevron, value, or any combination. End-aligned.                           |

Canonical example: `SortableRow` in `src/components/settings/CustomDictionaries.tsx`. The
drag handle is the prefix, the dict name is the title, the warning reason is the
subtitle, and the badge + toggle + edit/delete buttons stack as suffixes.

#### Row variants

- **ActionRow** — title + suffix is a single button or chevron. Tap anywhere navigates.
- **SwitchRow** — title + suffix is a toggle. Tap anywhere toggles.
- **ComboRow** — title + suffix is a dropdown/select.
- **ExpanderRow** — chevron suffix; tap expands to reveal nested rows.

These names come from libadwaita and apply 1:1 to Readest's lists. Use the names in code
comments and PR descriptions.

#### Spacing

- Row vertical padding: `py-2` (8px) for compact lists, `py-3` (12px) for breathing room.
- Row horizontal padding: `px-3` (12px) or `px-4` (16px). Stay consistent within a list.
- Slot gap: `gap-2` (8px) between prefix/title/suffix elements.

#### Disabled rows

Disabled rows fade the title to `text-base-content/60` and disable the suffix control. The
row itself stays at full opacity — only the **content** dims, not the row.

#### Toggle size

| Daisyui class                   | Use case                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `toggle` (default, h-5 / ~20px) | **Settings panel boxed-list rows** — `<SettingsSwitchRow>` uses this. Visible weight matches the 56px `min-h-14` row. |
| `toggle-sm` (h-4 / ~16px)       | Inline secondary switches in tighter contexts — e.g. dictionary list rows in `CustomDictionaries`.                    |
| `toggle-xs` (h-3 / ~12px)       | Compact metadata toggles inside cards — e.g. OPDS catalog "Auto-download".                                            |

The `<SettingsSwitchRow>` primitive bakes in the default `toggle`. **Don't override
to `toggle-sm` inside boxed-list rows** — it looks orphaned in the row's vertical
breathing room. Use the smaller sizes only when the row itself is shorter than 56px.

#### Typography inherits from `.settings-content`

The Settings dialog (and any settings-style sheet/popup) wraps its content
in `.settings-content`, which is defined in `src/styles/globals.css` as:

```css
.dropdown-content,
.settings-content {
  font-size: 14px; /* desktop */
}
@media (max-width: 768px) {
  .dropdown-content,
  .settings-content {
    font-size: 16px; /* mobile bump — high-DPI phones need bigger body text */
  }
}
```

**Don't hardcode `text-sm` on row labels, NavigationRow titles, or panel
descriptions** — that locks the text to 14px on every viewport and kills
the mobile bump. Instead:

- **Primary labels** (SettingsRow label, NavigationRow title, SubPageHeader
  description, ad-hoc row labels in panels and integration forms): no
  font-size class — inherits 14/16 from the wrapper. Use `<SettingLabel>`
  rather than inlining a `<span>`; it adds `font-medium` for cased scripts
  and drops the weight for caseless scripts (CJK / Arabic / Hebrew / Indic
  / Thai / Tibetan), since those bold poorly at body size and `font-medium`
  on Han / Hangul / Devanagari renders as uneven stroke-thickening across
  system fonts.
- **Secondary text** (SettingsRow description, NavigationRow status, Tips
  body, BoxedList description): use `text-[0.85em]` so it stays
  proportional (≈12px desktop, ≈13.6px mobile).
- **Form controls** (`<input>`, `<select>`): browsers don't inherit
  font-size onto form elements, so add the `settings-content` class
  _directly on the element_ to re-apply the 14/16 cascade. The legacy
  NumberInput already does this — match its pattern.
- **Section headers** (`BoxedList` uppercase title): use `text-[0.85em]
font-semibold uppercase tracking-wider`. The em-relative size keeps it
  proportional with the `.settings-content` cascade. **Caseless-script
  exception:** when `isCaselessUILang()` is true, bump to `text-[1em]`.
  The `uppercase` rule is a no-op in scripts without case (CJK, Arabic,
  Hebrew, Devanagari/Bengali/Tamil/Sinhala, Thai, Tibetan), so the size
  has to carry the emphasis those scripts can't pick up from casing. The
  helper lives in `src/utils/misc.ts`; the underlying `isCaselessLang`
  predicate lists every covered language code in `src/utils/lang.ts`.

Why this matters: Tailwind's `text-xs` / `text-sm` are rem-based — they
ignore the parent's `font-size` because rem is rooted at the document.
The `.settings-content` cascade is in `px`, so any child that picks a
Tailwind size literally tunes itself to the desktop default and never
grows on mobile. iOS and Android have small physical screens but high
DPI, so the mobile bump is what makes the text legible at typical reading
distance.

#### Uniform row height

Settings rows in a boxed list MUST all be the same visual height. Use
`min-h-14 items-center` (56px) on each row container — toggle, select, and
input rows then center their controls vertically inside identical boxes.
**Don't use `py-3`** — content-driven padding produces uneven heights
because toggles, selects (`h-9`), and inputs (`h-9`) have different
intrinsic sizes.

```tsx
// ✓ Right — no text-sm; label inherits .settings-content (14/16)
<label className='flex min-h-14 items-center justify-between px-4'>
  <span className='font-medium'>{_('Sync Enabled')}</span>
  <input type='checkbox' className='toggle' ... />
</label>

// ✗ Wrong — toggle row will be 48px, select rows 60px
<label className='flex items-center justify-between px-4 py-3'>...</label>

// ✗ Wrong — text-sm hardcodes 14px even on mobile (kills the bump)
<span className='text-sm font-medium'>{_('Sync Enabled')}</span>
```

#### Controls inside a boxed list have no chrome

When a control sits inside a bordered card, it shouldn't carry its own
border or fill. The card supplies the visual boundary; the control just
sits on the row.

- **Selects:** drop `select-bordered` and `eink-bordered`. Add
  `!bg-transparent !bg-none !appearance-none` to suppress daisyui's
  background chevron and native arrow. Render a real `<MdArrowDropDown>`
  icon at the cell's trailing edge for the affordance — see "End-aligned
  values" below.
- **Inputs:** drop `input-bordered` and `eink-bordered`. Add `!bg-transparent`
  with `hover:!bg-base-200/60 focus:!bg-base-200/60` so the field still
  signals interactability. Use `text-end` and `!pe-0` so the value sits
  flush against the row's trailing edge.
- **Toggles:** untouched — they're already chromeless.

This is the iOS Settings / Adwaita PreferencesGroup convention: list
chrome belongs to the container, not its children.

#### End-aligned values + chevron alignment

The selected value of a select/input MUST end-align (`text-end`). The
**visible right edge** of every row's value (toggle, chevron icon, input
text) MUST land at the same X — the row's trailing padding.

The trap: daisyui's select renders its chevron via background-image at
`calc(100% - 1rem) center`, which floats the glyph 16px _inside_ the
select's right edge. So if the toggle in row 1 ends at the row's `pe-4`
edge, the chevron in row 2 ends 16px before that — visibly misaligned.

**Fix:** suppress daisyui's bg-image chevron and render an explicit icon at
the cell's trailing edge. The select's own daisyui focus chrome (outline +
box-shadow + ring) is suppressed; **no focus ring** on controls inside the
boxed list — focus state is signaled by a subtle wrapper bg-shift instead
(hover and focus-within both lift to `bg-base-200/60`). Rings would compete
with the card's own border and double-stack with adjacent rows.

```tsx
<div className='hover:bg-base-200/60 focus-within:bg-base-200/60 flex max-w-[60%] items-center rounded-md'>
  <select className='select h-9 min-w-0 cursor-pointer !appearance-none truncate !border-0 !bg-transparent !bg-none !pe-1 !ps-2 text-end text-sm focus:!border-0 focus:!shadow-none focus:!outline-none focus:!ring-0'>
    {/* options */}
  </select>
  <MdArrowDropDown
    aria-hidden='true'
    className='text-base-content/55 pointer-events-none h-5 w-5 flex-shrink-0'
  />
</div>
```

> **Why so many `!` overrides?** daisyui's `.select` and `.input` apply
> `border-width: 1px` + `border-color` (transparent at rest, `var(--bc)` on
> focus), plus `outline`, `box-shadow`, and `ring` chrome on focus. To make
> the control truly chromeless inside a boxed list, you need to kill all
> four properties. Missing any of them — especially `border-0` — leaves a
> visible focus border leaking through.

The `<MdArrowDropDown>` icon's trailing edge now lives at the same X as the
toggle's trailing edge in adjacent rows, because both are flush with the
row's `pe-4` padding.

For inputs, no wrapper is needed — the input is one element, so put the
hover/focus bg directly on it. Suppress daisyui's own focus chrome the
same way:

```tsx
<input className='input hover:!bg-base-200/60 focus:!bg-base-200/60 h-9 max-w-[60%] rounded-md !border-0 !bg-transparent !pe-0 !ps-2 text-end text-sm focus:!border-0 focus:!shadow-none focus:!outline-none focus:!ring-0' />
```

> **Why no ring here when §2.7 says "focus needs a visible ring"?** §2.7 is
> for standalone custom buttons (Submit, Cancel, ListExtension, etc.). In a
> boxed list, the row already provides strong visual containment via the
> card border + dividers, and stacking a per-control ring inside that
> creates double chrome. The bg-shift IS the focus indicator — keyboard
> users still get clear feedback; the surface stays calm.

---

### 6. Header bars, dialogs, popups, sheets

#### Header bar

The dialog/page header. Adwaita's AdwHeaderBar.

- **48–56px tall** (`h-12` to `h-14`).
- **Center-aligned title** in `font-semibold text-base`.
- **Leading slot**: back chevron (mobile) or empty (desktop).
- **Trailing slot**: window controls — search (pill ghost), menu (pill ghost),
  close (pill ghost circle with `bg-base-300/65`).
- No bottom border; rely on tab/divider that follows.

`SettingsDialog.tsx`'s mobile header is the canonical example. The desktop header is
slightly different — tabs sit in the same row as window controls, no center title — but
it's the same archetype adapted for screen real estate.

#### Dialog (modal)

```tsx
<Dialog
  isOpen={...}
  onClose={...}
  boxClassName="sm:min-w-[520px] overflow-hidden"
  header={<HeaderBar />}
>
  {/* content */}
</Dialog>
```

- `modal-box` provides the radius, max-width, and shadow (auto-removed in eink).
- Width ~520px on desktop, full-width on mobile.
- Bottom sheets on mobile via `snapHeight` prop.
- Backdrop: `sm:!bg-black/50` (or `/20` when nested over a darker surface).

#### Popup (popover)

For dictionary lookups, annotation editors, and other anchored overlays. Uses the
`Popup` component with a triangle pointer.

- **Width**: clamp to fit content; ~320–420px typical.
- **Surface**: `bg-base-100`, `rounded-lg`, soft shadow (eink removes shadow).
- **Triangle**: pointer toward the anchor; eink has special triangle classes.
- **Padding**: `p-3` to `p-4` for content.

#### Sheet (mobile bottom)

Reserved for mobile contextual menus and full-screen secondary panels. Uses the dialog's
`snapHeight` prop. Adwaita doesn't have a native sheet but Readest's mobile pattern is
the closest analog.

- Always full-width.
- Top corners rounded; bottom corners flat (it's anchored to the bottom).
- Drag handle at top (the small horizontal pill) is mandatory if the sheet supports
  swipe-to-dismiss.

---

### 7. Motion + a11y

#### Motion

- Default duration: **150ms** for color transitions.
- Default easing: browser default (`ease`) or `ease-out`. Never `ease-in`.
- Longer transitions (300ms+) only for layout changes (sheet snap, panel slide).
- **Never** use `transform` for hover unless the transform IS the message
  (chevron rotation, drag-handle drag visualization). E-ink doesn't render mid-transitions
  cleanly and Adwaita's identity is calm.

```tsx
// Good — hover:bg-base-200 with transition-colors
className = 'transition-colors duration-150 hover:bg-base-200';

// Bad — scale on hover
className = 'transition-transform hover:scale-105';
```

Existing exceptions: `.window-button` in globals.css uses `hover:scale-105`. That's
legacy; new code shouldn't follow it.

#### Reduced motion

Reduced-motion preference is honored via the `no-transitions` class
(`globals.css:624`). Layout-changing transitions should respect
`prefers-reduced-motion: reduce` either via this class or `motion-safe:` Tailwind
prefixes.

#### Focus

- Every focusable element must have a visible focus indicator.
- Custom buttons:
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15`.
- Inputs: rely on daisyui's input focus ring; inputs with custom styling use
  `focus:ring-2 focus:ring-primary/40`.
- Don't use `outline-none` without `focus-visible:` replacement.

#### Hit targets

- **Minimum**: 32px (the size of `btn-sm`).
- **Recommended**: 40px (`btn`) on touch surfaces.
- **Mobile**: 44px+ for taps that aren't fail-safe (delete, navigate-away).
- The `touch-target` class in globals.css extends a small visual control's hit area to
  44px without changing its rendered size — use it on icon-sized buttons in mobile UIs.

#### Color contrast

- Body text on background: WCAG AA (4.5:1) minimum.
- Large text: WCAG AA Large (3:1) minimum.
- Interactive text on hover state: still passes contrast on the new background.
- Theme palette is generated from `(bg, fg, primary)`; the tinycolor pipeline keeps
  contrast within range, but custom themes can break this — Settings → Color flags
  low-contrast custom themes.

#### Keyboard

- Tab order matches visual order. If you use `flex-row-reverse` for visual layout,
  consider `tabIndex` to fix order.
- Modal focus trap: `<Dialog>` handles this.
- Esc to dismiss: `<Dialog>` and `<Popup>` handle this.
- Arrow keys for grouped controls (radio-like tab strips, sortable lists). dnd-kit's
  `KeyboardSensor` is wired for sortable lists.

---

### 8. E-ink overlay (cross-cutting)

E-ink mode is toggled by `[data-eink='true']` on the document. It applies a global
override layer in `src/styles/globals.css:484-622` that:

- Removes all `box-shadow`.
- Forces `text-base-content`, `text-blue-*`, `text-red-*`, `text-neutral-content` to a
  single foreground color.
- Inverts `btn-primary` and `btn-outline` to base-content bg + base-100 text.
- Adds 1px contrast borders to `.eink-bordered`, `.modal-box`, `.menu-container`,
  `.popup-container`, `.alert`, `.opds-navigation .card`, `.booknote-item`,
  `.bookitem-main`.

What this means for new components:

| Surface type                         | Required class          | Why                                                           |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------- |
| Custom bordered button or input      | `eink-bordered`         | Gets the 1px contrast border in eink                          |
| Primary CTA                          | `btn-primary`           | Picks up the inverted treatment                               |
| Cancel / secondary action            | `btn-ghost` (no border) | Reads as "outlined" only after pairing with the CTA           |
| Card / panel using `border-base-200` | `eink-bordered`         | Otherwise the soft border vanishes in eink                    |
| Modal / Popup                        | (auto)                  | `modal-box` and `.popup-container` are handled in globals.css |

Verification checklist before shipping a new UI:

- [ ] Toggle Settings → Misc → Eink mode and re-test every screen.
- [ ] Every container that has a soft border (`border-base-200`) still has visible
      delineation.
- [ ] Every CTA is distinguishable from its neighbors (cancel, secondary).
- [ ] No hover transforms make the UI feel jumpy.
- [ ] Text is fully opaque (no `text-base-content/60` content; eink can't render the
      reduced opacity well).

#### What's NOT compatible with e-ink

- Drop shadows for hierarchy (use borders).
- Color-only state changes (use border weight or fill swap).
- Hover scale / translate (they look broken on slow refresh).
- Animations longer than ~200ms (visible refresh artifacts).

---

### 9. Cross-platform grace notes

Readest ships on **macOS, Windows, Linux, iOS, Android, web**. Adwaita is desktop-GNOME-
native; we adapt where the host OS has strong conventions, but never at the cost of
identity.

#### iOS

- Slightly larger corner radii feel native (`rounded-xl` on dialogs, `rounded-lg` on
  cards).
- Safe area insets are mandatory for top + bottom anchored elements (see
  `docs/safe-area-insets.md`).
- Avoid Material Design ripple effects.
- Sheet-style modals (bottom-anchored) match iOS conventions and are preferred over
  centered dialogs on phone-sized screens.

#### Android

- Material 3 conventions that conflict with Adwaita (FABs, elevation shadows, ripple
  inks): **don't** copy them. Readest's identity is Adwaita; the user is reading on
  Android, not in Android.
- Touch targets bumped to 48px for primary actions (Material's recommended target).
- Back-gesture-aware UIs: ensure swipe-from-edge doesn't conflict with horizontal swipe
  controls.

#### Linux

- Native Adwaita territory. Readest can match host theme for window chrome (Tauri
  decorations) but should keep its own internal palette for the reading surface — book
  themes (sepia, gruvbox, etc.) are user choices, not OS choices.

#### macOS / Windows

- Window controls (close/minimize/maximize) are platform-native via Tauri.
- Title bar height matches platform convention; internal layout follows Readest's
  Adwaita palette.

#### Web

- No safe-area insets needed.
- Keyboard shortcuts are doubled with command-palette discoverability (Cmd/Ctrl+K).
- Browser-native focus rings: respected, augmented with `focus-visible:ring-*`.

#### E-ink readers (Android-based, custom firmware)

- Detected via the eink mode toggle (Settings → Misc).
- All rules in §8 apply.
- This is a **first-class** target, not a fallback.

---

### 10. Anti-patterns

Things that LOOK fine in isolation but break the system. Each one has a real source diff
or commit reference.

#### 10.1 Loud outlined CTAs for non-primary actions

```tsx
// Anti-pattern (was in CustomDictionaries.tsx, fixed Nov 2026):
<button className='btn btn-outline btn-primary gap-2 normal-case [--animation-btn:0s]'>
  <MdAdd className='h-5 w-5' />
  Import Dictionary
</button>

// Correct: ListExtension archetype (see §4.6)
```

Why it broke: the buttons read as primary CTAs but are list extensions. They competed
with the active settings tab indicator and pulled the eye from the list itself.

#### 10.2 Recoloring the whole button on hover

```tsx
// Anti-pattern:
<button className="text-base-content/70 hover:text-base-content hover:bg-primary/10">

// Correct: keep the label color steady, hover via bg shift on the surface
<button className="text-base-content hover:bg-base-200 transition-colors">
```

Why: principle 2.4 (localize the hover signal). Whole-button color shifts feel decorative.

#### 10.3 Transform-based hover

```tsx
// Anti-pattern:
<button className="hover:scale-105 transition-transform">

// Correct: color/border-based hover
<button className="hover:bg-base-200 hover:border-base-300 transition-colors">
```

Why: breaks under e-ink (§2.5), feels jumpy under Adwaita's calm rhythm.

#### 10.4 Soft borders without `eink-bordered`

```tsx
// Anti-pattern:
<div className="border border-base-200 bg-base-100 rounded-lg p-4">
  ...
</div>

// Correct:
<div className="eink-bordered border border-base-200 bg-base-100 rounded-lg p-4">
  ...
</div>
```

Why: in e-ink mode, `base-200` borders disappear into the background. `eink-bordered`
flips the border to `base-content` so the boundary stays visible.

Exception: containers that **don't** need a visible boundary in eink (e.g., a
`bg-base-100` surface that's already against `bg-base-200`) can skip `eink-bordered`.
The class is opt-in for "this surface needs a border to read correctly".

#### 10.5 Reduced-opacity text in e-ink

```tsx
// Anti-pattern (in eink):
<span className="text-base-content/50">Optional metadata</span>

// Correct (still readable in eink):
<span className="text-base-content text-xs">Optional metadata</span>
// Or use semantic muting that the eink overlay handles:
<span className="text-neutral-content">Optional metadata</span>
```

Why: e-ink's reduced color depth turns `/50` opacity into illegible mush. Use size or
weight for hierarchy on muted secondary text.

#### 10.6 Daisyui `btn` defaults without intent

```tsx
// Anti-pattern: just reaching for `btn` with no role:
<button className="btn">Click me</button>

// Correct: pick an archetype from §4.
<button className="btn btn-ghost">Cancel</button>      // Flat
<button className="btn btn-primary">Save</button>      // Accent CTA
```

Why: daisyui's `btn` default isn't tuned for any specific role. Pick from the action
vocabulary so the button signals its weight in the surface hierarchy.

#### 10.7 Ad-hoc surface tokens

```tsx
// Anti-pattern:
<div className="bg-white border-gray-200">

// Correct:
<div className="bg-base-100 border-base-200">
```

Why: hard-coded colors don't theme. Readest has 11 themes plus user-defined custom themes.
Always use the daisyui semantic tokens.

#### 10.8 Mixing `btn` sizes within a surface

```tsx
// Anti-pattern:
<header>
  <button className="btn btn-sm">Search</button>
  <button className="btn btn-md">Settings</button>
  <button className="btn btn-xs">Close</button>
</header>

// Correct: one size per surface
<header>
  <button className="btn btn-ghost btn-circle h-8 min-h-8 w-8">Search</button>
  <button className="btn btn-ghost btn-circle h-8 min-h-8 w-8">Settings</button>
  <button className="btn btn-ghost btn-circle h-8 min-h-8 w-8">Close</button>
</header>
```

Why: visual rhythm. Mixed sizes feel like the surface is unfinished.

---

### 11. Quick reference

When designing a new surface, walk this checklist:

1. **What's the surface tier?** Window / View / Card. (§3)
2. **What's the corner radius?** Match the tier. (§3)
3. **Is there a primary action?** If yes, ONE accent CTA. If no, all flats. (§4.1, §4.3)
4. **Are there list extensions?** Use the ListExtension archetype, not `btn-outline btn-primary`. (§4.6)
5. **Is it a list?** Use the BoxedList chassis with ActionRow / SwitchRow / ComboRow / ExpanderRow rows. (§5)
6. **Does it need `eink-bordered`?** If it has a soft border that must stay visible in
   eink mode, yes. (§8)
7. **Is the hover signal localized?** One focal element changes, not the whole control. (§2.4)
8. **Is motion color-only?** No transforms unless the transform IS the message. (§2.5)
9. **Is focus visible?** `focus-visible:ring-2 focus-visible:ring-base-content/15` on
   custom buttons. (§7)
10. **Will it work on the smallest theme + e-ink?** Toggle Sepia + Eink, retest.

---

### 12. Glossary

- **Adwaita / libadwaita**: GNOME's design system and widget toolkit. Source of Readest's
  visual lineage.
- **AdwActionRow / AdwSwitchRow / AdwComboRow / AdwExpanderRow**: libadwaita's row
  primitives. Readest mirrors these conceptually with custom React components.
- **AdwBoxedList**: libadwaita's named container for grouped action rows.
- **AdwBanner**: top-of-window inline alert (persistent).
- **AdwToast**: bottom slide-in transient alert.
- **Window / View / Card**: surface tiers (§3).
- **ListExtension**: Readest-named archetype for "+ add new row" buttons (§4.6).
- **eink-bordered**: utility class in `globals.css` that gives a surface its e-ink-mode
  contrast border. Opt-in.
- **Pill ghost**: circular icon button, `btn-ghost btn-circle`.

---

### 13. Maintenance

This doc is the **source of truth** for new design decisions. When the system grows:

- New archetypes get a numbered subsection in §4 or §5.
- New anti-patterns get added to §10 with a real source reference.
- Updates to existing principles require a brief why-changed note in the relevant section.

Cross-references that must stay in sync:

- `CLAUDE.md` E-ink mode section → §8 of this doc.
- `docs/safe-area-insets.md` → §9 (cross-platform).
- `src/styles/globals.css` `[data-eink]` rules → §8.
- `src/styles/themes.ts` Palette type → §3 token table.

If you change a rule here, search for the cross-reference and update both.
