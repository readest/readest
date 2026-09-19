## Safe Area Insets

The app runs on devices with notches, status bars, and rounded corners (iOS, Android). UI elements near screen edges must account for safe area insets to avoid being obscured.

### Key Concepts

- **`gridInsets: Insets`** — Per-view insets derived from view settings (header/footer visibility, margins). Calculated by `getViewInsets()` in `src/utils/insets.ts`. Passed as a prop from `BooksGrid` → child components.
- **`statusBarHeight: number`** — OS status bar height (default 24px). Stored in `themeStore`.
- **`systemUIVisible: boolean`** — Whether the system UI (status bar, navigation bar) is currently shown. Stored in `themeStore`.
- **`appService?.hasSafeAreaInset`** — Whether the platform requires safe area handling (mobile devices).

### Top Inset Rules

For UI elements anchored to the **top** of the screen (headers, close buttons, overlays):

```tsx
// When system UI is visible, use the larger of gridInsets.top and statusBarHeight
// When system UI is hidden, use gridInsets.top alone
style={{
  marginTop: systemUIVisible
    ? `${Math.max(gridInsets.top, statusBarHeight)}px`
    : `${gridInsets.top}px`,
}}
```

For containers that need safe area padding at the top:

```tsx
style={{
  paddingTop: appService?.hasSafeAreaInset ? `${gridInsets.top}px` : '0px',
}}
```

For top-anchored slide-in panels (sidebar, notebook), use `getPanelTopInset()` from `src/utils/insets.ts`. It clears the status bar on tablet/desktop and full-height mobile sheets, but stays flush for a partial-height mobile bottom sheet (which doesn't reach the top of the screen). Gating only on `isFullHeightInMobile` is wrong — a non-mobile panel is also top-anchored and would let the status bar obscure its toolbar.

### Bottom Inset Rules

For UI elements anchored to the **bottom** of the screen (footer bars, controls, progress indicators), use `gridInsets.bottom * 0.33` as padding — a fraction of the full inset since bottom bars don't need as much clearance as the home indicator area:

```tsx
style={{
  paddingBottom: appService?.hasSafeAreaInset ? `${gridInsets.bottom * 0.33}px` : 0,
}}
```

### Horizontal Inset Rules

Safe-area insets are physical: `left`/`right`, never start/end. They are normally 0 on a
phone held portrait, but a landscape notch reports one, and iPhone Duo reports a large one
on the cover display and on the inner display in landscape, where the system moves the
status bar into a vertical strip along one edge (with the cover display's camera in the
same corner). That edge can flip with rotation or Split View, so read both values every
time (#6307).

For a full-width bar, sheet or panel, pad it by the insets with
`getHorizontalInsetStyle()` from `src/utils/insets.ts`, passing the element's existing
horizontal padding as `basePx` — an inline `paddingLeft`/`paddingRight` replaces the
Tailwind class on that element — and gate it on mobile so desktop layouts keep their
state-dependent padding:

```tsx
style={{
  ...(appService?.hasSafeAreaInset ? getHorizontalInsetStyle(insets, 16) : {}),
}}
```

For an element anchored to one edge (a corner ribbon, a floating button column, a popup
clamp), offset that edge by the matching inset instead of padding: `right: ${insets.right + 16}px`.
Popups positioned inside a grid cell should clamp to the cell rect shrunk by the cell's
`gridInsets` (`insetRect()` in `src/utils/sel.ts`).

### Passing `gridInsets`

When creating overlay components (image viewers, table viewers, zoom controls, etc.), always pass `gridInsets` as a prop so they can position their controls correctly:

```tsx
<ImageViewer gridInsets={gridInsets} ... />
<TableViewer gridInsets={gridInsets} ... />
<ZoomControls gridInsets={gridInsets} ... />
```
