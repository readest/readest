---
name: D-pad Navigation Design
description: Android TV / Bluetooth remote D-pad navigation architecture, key files, and pitfalls encountered during implementation
type: project
---

## D-pad Navigation Architecture

D-pad support enables Bluetooth remote controller navigation on Android TV (and keyboard arrow navigation on desktop).

### Key Files

- `src/app/reader/hooks/useSpatialNavigation.ts` — Reader toolbar D-pad navigation. Left/Right navigates between buttons, Up/Down moves between header↔footer. Auto-focuses first button on show. Uses focus-probe technique for visibility detection.
- `src/app/library/hooks/useSpatialNavigation.ts` — Library grid D-pad navigation. Arrow keys move between BookshelfItem elements. ArrowDown from outside bookshelf (e.g. header) enters the grid via window-level listener.
- `src/helpers/shortcuts.ts` — `onToggleToolbar` (Enter key) toggles reader toolbar visibility.
- `src/app/reader/hooks/useBookShortcuts.ts` — `toggleToolbar` handler shows/hides header+footer bars. Skips when a `<button>` is focused (lets native click fire).
- `src/__tests__/hooks/useSpatialNavigation.test.tsx` — Unit tests for reader toolbar navigation.

### Design Decisions

- **No third-party library**: Tried `@noriginmedia/norigin-spatial-navigation` but it failed due to init timing issues (React child effects run before parent effects) and conflicts with the existing `useShortcuts` system. Custom solution is simpler and more reliable.
- **Two `useSpatialNavigation` hooks**: Same name in different directories — library version handles grid navigation, reader version handles toolbar button navigation. Different navigation patterns but same concept.
- **Platform-agnostic hooks**: Both `useSpatialNavigation` hooks work on all platforms, not just Android.
- **Focus-probe for visibility**: `offsetParent` is unreliable for detecting visible buttons (returns null inside `position: fixed` containers on mobile). Instead, try `btn.focus()` and check if `document.activeElement === btn` — this correctly handles all hiding methods (display:none, visibility:hidden, fixed positioning).

### Pitfalls

1. **WebView spatial navigation conflict**: Android WebView has built-in spatial navigation that intercepts D-pad arrow keys and moves DOM focus between `tabIndex>=0` elements. Added `tabIndex={-1}` to non-interactive overlay elements (HeaderBar trigger, ProgressBar, FooterBar trigger, SectionInfo) to prevent focus theft.

2. **`eventDispatcher.dispatchSync` short-circuits**: When multiple handlers are registered for `native-key-down`, the first handler returning `true` stops propagation. The FooterBar's Back handler fires before the Reader's. Both must independently call `blur()` — can't rely on the Reader's handler running.

3. **Must blur on toolbar dismiss**: When Back/Escape dismisses the toolbar, the focused button must be blurred. Otherwise `document.activeElement` remains a hidden button, and `toggleToolbar` skips Enter when `activeElement.tagName === 'BUTTON'`. Blur is called in FooterBar's handleKeyDown (for Back and Escape) and in Reader's handleKeyDown.

4. **Arrow key trapping must use `stopPropagation`**: Without it, arrow keys bubble to `window` where `useShortcuts` handles them as page turns. The toolbar keydown handler on the container div calls `e.stopPropagation()` + `e.preventDefault()` to prevent this.

5. **Library grid needs window-level listener**: The bookshelf container keydown handler only fires when focus is inside it. A separate `window` keydown listener handles ArrowDown from the header into the grid (when focus is outside the container).

6. **Auto-focus race on toolbar show**: Both header and footer bars auto-focus their first button when `isVisible` becomes true simultaneously. The last effect to run wins. This is acceptable — user can navigate between them with Up/Down.

7. **`offsetParent` null in fixed containers**: On mobile, `.footer-bar` uses `position: fixed`. All child buttons have `offsetParent === null`, making `offsetParent`-based visibility checks useless. The focus-probe approach (try focus, check activeElement) is the reliable alternative.
