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

### Horizontal Inset Rules (iPhone Duo only)

Every horizontal-inset rule below is gated on `isIPhoneDuo` (`themeStore`), so no device
other than iPhone Duo changes behaviour. Ordinary phones report a landscape notch inset
and tablets and Android devices report their own cutouts, but none of them was ever laid
out against a side inset, and the viewport size cannot tell the Duo apart: a landscape
Android tablet at 960x640 looks like the Duo's inner display. So the native bridge reports
`isIPhoneDuo` from the device model identifier (`get_safe_area_insets`, iOS exposes no
foldable API), `useSafeAreaInsets` stores it, and each rule takes it as an argument (pure
utils) or reads it from the store (components). Never branch on viewport size or on the
inset values alone. With `isIPhoneDuo` false, code must behave exactly as before the Duo
work; add a parity case (an iPhone with a 59 top inset, an iPhone landscape with 62/62,
an iPad, an Android cutout, 960x640 and 1024x680, desktop) when touching one of these.

On the Duo the system moves the status bar into a vertical strip along one long edge on the
cover display and on the inner display in landscape (with the cover display's camera in the
same corner), reported as a large left or right safe-area inset (#6307). That edge can flip
with rotation or Split View, so read both values every time; `useSafeAreaInsets` refetches
on window resize, but only when `isIPhoneDuo` is set. Safe-area insets are physical:
`left`/`right`, never start/end.

For a full-width bar, sheet or panel, pad it by the insets with
`getHorizontalInsetStyle(insets, isIPhoneDuo, basePx)` from `src/utils/insets.ts`, passing
the element's existing horizontal padding as `basePx` (an inline `paddingLeft`/`paddingRight`
replaces the Tailwind class on that element). It returns `{}` off the Duo, and on the Duo
when both side insets are 0, so the element keeps its own classes, responsive ones
included (`sm:ps-1.5`). Keep the class that `basePx` mirrors on the element, since the
style only takes over when there is an inset:

```tsx
style={{
  ...getHorizontalInsetStyle(insets, isIPhoneDuo, 16),
}}
```

A side panel (sidebar on the left, notebook on the right) meets the page mid-screen, so
only the full-width mobile sheet is padded on both sides. Use
`getPanelHorizontalInsetStyle(insets, isIPhoneDuo, isMobile, screenEdge)`, which pads a side
panel on its screen edge only. Those edges are physical: the document is never `dir=rtl`,
and a panel's own `dir` only flips its contents.

For an element anchored to one edge (a corner ribbon, a floating button column), offset
that edge by the matching inset instead of padding, inside an `isIPhoneDuo` spread
(`right: ${insets.right + 16}px`).

The reader page follows the same gate:

- **Viewer geometry.** `FoliateViewer` applies the horizontal insets to the viewer container
  (`left` and `width`) instead of folding them into the paginator margins, which put only
  half of a margin (a quarter in two columns) on the outer edge. Elsewhere the insets stay
  in the margins and the container is untouched. `ProgressBar` and `SectionInfo` pad each
  physical side from its own inset on the Duo; elsewhere they keep their logical padding.
- **Spread centring.** `BooksGrid` makes a two-column spread's insets symmetric
  (`getPageAreaInsets`), so the spine sits on the Duo's fold, only on the Duo and only when
  the cell spans the full grid width (`spansWidth`): books side by side have an inset on
  their outer edge only.
- **Mobile bars.** `isForcedMobileLayout(isMobileApp, isIPhoneDuo)` keeps the rule
  "mobile app, at least 640 wide, no wider than tall" everywhere, and on the Duo gives every
  pose at least 640 wide the mobile bars.
- **Edge gestures.** The brightness and auto-scroll speed zones start past the strip
  (`edgeInset`) on the Duo; elsewhere the inset is 0.
- **Popups.** Popup points are relative to the rect they were computed against, but popups
  render relative to the book cell. On the Duo, clamp to the cell shrunk by `gridInsets`
  and shift the results back to cell coordinates: `getPopupBounds(cellRect, insets,
  isIPhoneDuo)` returns the rect and the `origin` to shift by, `offsetPosition()` applies
  it. Off the Duo the rect is the raw cell and the origin is zero. Passing an inset rect
  without shifting moves every popup up by the top inset (59px on an iPhone), onto the
  selected word.

The status bar mechanism is the one thing that changes on every iOS device. It is hidden
through the root view controller's `prefersStatusBarHidden` (tao's
`setPrefersStatusBarHidden:`), which needs `UIViewControllerBasedStatusBarAppearance` set to
true in `src-tauri/Info.plist`: apps built with the iOS 27 SDK can no longer hide it with
`UIApplication.setStatusBarHidden`. `set_system_ui_visibility` and `get_safe_area_insets`
both use `appWindow()` (the webview's own window), and `get_safe_area_insets` reports
`statusBarHidden`. Everything below stays behind `isIPhoneDuo`:

- **Inset re-read.** Hiding or showing the strip moves its inset (84pt to 0 on the inner
  display), so `Reader` and `useTheme` re-read the insets after `setSystemUIVisibility`
  resolves. Other iPhones never did, and a re-read would apply their 20 to 0 top inset.
- **Reading page.** `BooksGrid` lays each cell's page out against `getReadingScreenInsets()`,
  which keeps the side insets recorded with the status bar hidden
  (`themeStore.statusBarHiddenInsets`, recorded by `useSafeAreaInsets`, keyed by window
  size), so opening the toolbar does not re-paginate and the strip overlaps the page margin
  while it is up. `HeaderBar` and `FooterBar` take the cell's live insets (`chromeInsets`) so
  their buttons clear the strip. With Always Show Status Bar on, the page uses the live
  insets. Off the Duo nothing is recorded or applied: page and chrome insets are the same.
- **Landscape rule.** An iPhone held landscape shows no status bar whatever the app asks
  for, so `useTheme` sets `systemUIAlwaysHidden` on any landscape orientation change
  (unchanged). On the Duo it instead uses `isStatusBarHiddenBySystem()`, landscape and under
  500pt tall, which leaves the 669pt inner display free to show its strip. It is evaluated on
  mount, resize and orientation change, since folding between two landscape displays fires no
  orientation event.

### Passing `gridInsets`

When creating overlay components (image viewers, table viewers, zoom controls, etc.), always pass `gridInsets` as a prop so they can position their controls correctly:

```tsx
<ImageViewer gridInsets={gridInsets} ... />
<TableViewer gridInsets={gridInsets} ... />
<ZoomControls gridInsets={gridInsets} ... />
```
