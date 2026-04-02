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

### Bottom Inset Rules

For UI elements anchored to the **bottom** of the screen (footer bars, controls, progress indicators), use `gridInsets.bottom * 0.33` as padding — a fraction of the full inset since bottom bars don't need as much clearance as the home indicator area:

```tsx
style={{
  paddingBottom: appService?.hasSafeAreaInset ? `${gridInsets.bottom * 0.33}px` : 0,
}}
```

### Passing `gridInsets`

When creating overlay components (image viewers, table viewers, zoom controls, etc.), always pass `gridInsets` as a prop so they can position their controls correctly:

```tsx
<ImageViewer gridInsets={gridInsets} ... />
<TableViewer gridInsets={gridInsets} ... />
<ZoomControls gridInsets={gridInsets} ... />
```
