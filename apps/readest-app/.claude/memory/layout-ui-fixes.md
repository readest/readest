# Layout & UI Fixes Reference

## Safe Area Insets

### Architecture
- Native plugins push inset values: iOS (`NativeBridgePlugin.swift`), Android (`NativeBridgePlugin.kt`)
- `useSafeAreaInsets` hook (`src/hooks/useSafeAreaInsets.ts`) reads and caches values
- Components use `gridInsets` for positioning relative to safe areas
- CSS: `env(safe-area-inset-top/bottom/left/right)` for CSS-level insets

### Common Issues
- **Stale insets after system UI change** (#3469): Call `onUpdateInsets()` after `setSystemUIVisibility()`
- **iPad sidebar insets wrong** (#3395): Different inset handling needed for sidebar vs main view
- **Android nav bar overlap** (#3466): Use `calc(env(safe-area-inset-bottom) + 16px)` for Android bottom padding
- **Zoom controls behind status bar** (#3426): Pass `gridInsets` through component chain, use `Math.max(gridInsets.top, statusBarHeight)`

### Rules (see also `docs/safe-area-insets.md`)
- Always pass `gridInsets` to overlay/floating components near screen edges
- On Android, account for system navigation bar with `env(safe-area-inset-bottom)`
- After toggling system UI visibility, force-refresh insets via `onUpdateInsets()`

## Z-Index Hierarchy
- Navigation buttons: `z-10` (when visible)
- Annotation nav bar: `z-10` (reduced from z-30 in #3386)
- TTS control button: ensure above page nav buttons
- Floating overlays: check against `gridInsets` positioning

## macOS Traffic Lights
- Managed by `trafficLightStore.ts` and `HeaderBar.tsx`
- **Fullscreen check required** (#3129): `await currentWindow.isFullscreen()` before hiding
- **Timeout for visibility toggle** (#3488): Use 100ms delay to prevent flickering
- **Sidebar interaction** (#3488): Check `getIsSideBarVisible()` before hiding traffic lights
- Never hide traffic lights when sidebar is open

## Touch/Input Issues
- **Slider hit area on iOS** (#3382): Use min-h-12, strip browser appearance with CSS
- **Context menu on macOS** (#3324): 100ms delay before `onContextMenu()` to let pointer events complete
- **Swipe sensitivity** (#3310): Use average velocity (distance/time) instead of instantaneous velocity for non-animated paging
- **Touchpad natural scrolling** (#3127): Respect system natural scrolling setting in `usePagination.ts`

## Dialog/Menu Layout
- **Dialog header** (#3352): Use `px-2 sm:pe-3 sm:ps-2` padding to align with border radius
- **Settings alignment** (#3151): Use `Menu` component instead of raw `div` for consistent styling
- **Dropdown for screen readers** (#3035): Use `DropdownContext` with overlay dismiss, not blur-based closing

## Component-Specific Fixes

### HeaderBar.tsx
- Traffic light visibility management
- Sidebar toggle persistent position (#3193)
- Library button placement

### PageNavigationButtons.tsx
- z-10 when visible (#3201)
- Always shown for screen readers (#3036)
- Toggle via `showPageNavButtons` setting

### ProgressInfo.tsx
- Use physical `page`/`pages` from renderer, not estimated values (#3213, #3200)
- CSS classes: `time-left-label`, `pages-left-label`, `progress-info-label` (#3343)

### ReadingRuler.tsx
- Remove `containerStyle` from overlay so dimmed area covers full screen (#3304)

### NavigationBar.tsx
- Handle `gridInsets` internally, not via pre-computed `navPadding` (#3466)

### ContentNavBar.tsx (annotation search results)
- Floating buttons with drop shadow, not full-width bar (#3386)
- z-10 z-index
