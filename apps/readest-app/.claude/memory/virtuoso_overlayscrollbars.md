---
name: Virtuoso + OverlayScrollbars pattern
description: How to integrate OverlayScrollbars with react-virtuoso for overlay scrollbars on Android/iOS webviews
type: reference
originSessionId: 9da59a46-3dff-4a77-b7a4-8de4d07297b6
---
Virtuoso manages its own internal scroller. On Android WebView (and similar) native scrollbars auto-hide, so users see no scrollbar. The fix: wrap Virtuoso with OverlayScrollbars using the `useOverlayScrollbars` hook — **not** the `OverlayScrollbarsComponent`.

## Migration from `customScrollParent`

The previous approach used `customScrollParent` to let an outer `OverlayScrollbarsComponent` own the scroll. This was replaced: Virtuoso now owns its own scroller, and OverlayScrollbars wraps it. This means:
- Remove `customScrollParent` prop from Virtuoso/VirtuosoGrid
- Remove the outer `OverlayScrollbarsComponent` wrapper
- Use `scrollerRef` instead to capture Virtuoso's scroller element
- If the parent needs the scroller ref (e.g. for pull-to-refresh, scroll save/restore), expose it via a callback prop like `onScrollerRef`

## Boilerplate

```tsx
import { useOverlayScrollbars } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';

// Inside the component:
const osRootRef = useRef<HTMLDivElement>(null);
const [scroller, setScroller] = useState<HTMLElement | null>(null);
const [initialize, osInstance] = useOverlayScrollbars({
  defer: true,
  options: { scrollbars: { autoHide: 'scroll' } },
  events: {
    initialized(instance) {
      const { viewport } = instance.elements();
      viewport.style.overflowX = 'var(--os-viewport-overflow-x)';
      viewport.style.overflowY = 'var(--os-viewport-overflow-y)';
    },
  },
});

useEffect(() => {
  const root = osRootRef.current;
  if (scroller && root) {
    initialize({ target: root, elements: { viewport: scroller } });
  }
  return () => osInstance()?.destroy();
}, [scroller, initialize, osInstance]);

const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
  const div = el instanceof HTMLElement ? el : null;
  setScroller(div);
  // If parent needs the scroller (e.g. for pull-to-refresh):
  onScrollerRef?.(div as HTMLDivElement | null);
}, [onScrollerRef]);
```

## JSX structure

```tsx
<div ref={osRootRef} data-overlayscrollbars-initialize='' className='h-full'>
  <Virtuoso
    scrollerRef={handleScrollerRef}
    style={{ height: containerHeight }}
    totalCount={items.length}
    itemContent={renderItem}
    overscan={200}
  />
</div>
```

For `VirtuosoGrid`, same pattern — pass `scrollerRef={handleScrollerRef}`.

## Footer spacer

When Virtuoso owns its own scroller (no `customScrollParent`), the last items may be hidden behind bottom UI (tab bars, safe area). Add a Virtuoso `Footer` component to the components config:

```tsx
const VIRTUOSO_COMPONENTS = {
  List: MyListComponent,
  Footer: () => <div style={{ height: 34 }} />,
};
```

## Key points

- **`useOverlayScrollbars`** hook, not `OverlayScrollbarsComponent` — the component can't share a viewport with Virtuoso
- Wrapper div needs `ref={osRootRef}` and `data-overlayscrollbars-initialize=""`
- `initialize({ target: root, elements: { viewport: scroller } })` tells OverlayScrollbars to use Virtuoso's existing scroller as its viewport (no new DOM element)
- The `initialized` event **must** restore overflow CSS vars (`--os-viewport-overflow-x/y`) so OverlayScrollbars doesn't fight Virtuoso's scroll management
- No custom Scroller component needed — `scrollerRef` replaces the old `Scroller` component pattern (e.g. `TOCScroller` was removed)

## Used in

- `src/app/library/components/Bookshelf.tsx` — library grid/list with parent scroller exposure for pull-to-refresh and scroll save/restore
- `src/app/reader/components/sidebar/TOCView.tsx` — sidebar TOC (self-contained, no parent scroller needed)
