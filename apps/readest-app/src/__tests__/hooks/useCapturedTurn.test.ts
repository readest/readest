import { describe, it, expect, afterEach, vi } from 'vitest';
import { applyPageTurnAttributes, getCapturedTurnStyle } from '@/app/reader/hooks/useCapturedTurn';
import type { FoliateView } from '@/types/view';
import type { ViewSettings } from '@/types/book';

// The DOM lib types startViewTransition as always present; go through a
// loose shape so the stub can also remove it.
type VTDocument = { startViewTransition?: () => void };

// iOS 18 WebKit has startViewTransition but crashes the WebContent process on
// the layered turns (#555); engines with nested view-transition groups
// (Chrome/WebView 140+) are the ones known to run them reliably.
const stubEngine = ({
  startViewTransition,
  nestedGroups,
}: {
  startViewTransition: boolean;
  nestedGroups: boolean;
}) => {
  const doc = document as unknown as VTDocument;
  if (startViewTransition) doc.startViewTransition = () => {};
  else delete doc.startViewTransition;
  vi.stubGlobal('CSS', {
    supports: (property: string, value: string) =>
      nestedGroups && property === 'view-transition-group' && value === 'nearest',
  });
};

const makeView = () => {
  const renderer = document.createElement('foliate-paginator');
  return { view: { renderer } as unknown as FoliateView, renderer };
};

const settings = (pageTurnStyle: ViewSettings['pageTurnStyle']) =>
  ({
    pageTurnStyle,
    animated: true,
    scrolled: false,
    disableSwipe: false,
    isEink: false,
    zoomLevel: 100,
    zoomMode: 'fit-page',
  }) as ViewSettings;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete (document as unknown as VTDocument).startViewTransition;
});

describe('getCapturedTurnStyle', () => {
  it('captures the slide on Tauri when the engine cannot layer View Transitions', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    expect(getCapturedTurnStyle(settings('slide'), false, false)).toBe('slide');
  });

  it('leaves the slide to View Transitions on fully supporting desktop Tauri engines', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    expect(getCapturedTurnStyle(settings('slide'), false, false)).toBeNull();
  });

  it('keeps the slide on the pre-warmed capture path on mobile Tauri engines', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    expect(getCapturedTurnStyle(settings('slide'), false, true)).toBe('slide');
  });

  // Fixed-layout books (PDF, CBZ/CBR, fixed-layout EPUB/MOBI) share the
  // captured pipeline: `fixed-layout.js` has no turn animation of its own, and
  // its next()/prev() are already the instant jump the overlay hides
  // (readest#6239).
  it('captures the curl for fixed-layout books that fit the page', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    expect(getCapturedTurnStyle(settings('curl'), true, false)).toBe('curl');
  });

  it('captures the slide for fixed-layout books on mobile Tauri', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    expect(getCapturedTurnStyle(settings('slide'), true, true)).toBe('slide');
  });

  // Zoomed or fit-width fixed layouts pan instead of turning: a horizontal drag
  // moves the page, and `usePagination`'s swipe-flip already refuses to flip
  // there. Leave those on push rather than curl a page the finger is panning.
  it('leaves zoomed fixed-layout books on push', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const zoomed = settings('curl');
    zoomed.zoomLevel = 150;
    expect(getCapturedTurnStyle(zoomed, true, false)).toBeNull();
  });

  it('leaves fit-width fixed-layout books on push', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const fitWidth = settings('curl');
    fitWidth.zoomMode = 'fit-width';
    expect(getCapturedTurnStyle(fitWidth, true, false)).toBeNull();
  });

  it('keeps reflowable books captured whatever the fixed-layout zoom fields say', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const zoomed = settings('curl');
    zoomed.zoomLevel = 150;
    zoomed.zoomMode = 'fit-width';
    expect(getCapturedTurnStyle(zoomed, false, false)).toBe('curl');
  });

  it('never captures a scrolled fixed-layout book', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const scrolled = settings('curl');
    scrolled.scrolled = true;
    expect(getCapturedTurnStyle(scrolled, true, false)).toBeNull();
  });

  // Push on fixed layout is the captured pipeline's third style: the outgoing
  // capture slides out while the live view is translated in beside it. A
  // reflowable book keeps the paginator's native strip scroll (readest#6239).
  it('captures the push for fixed-layout books', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    expect(getCapturedTurnStyle(settings('push'), true, false)).toBe('push');
  });

  it('leaves the push to the paginator for reflowable books', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    expect(getCapturedTurnStyle(settings('push'), false, false)).toBeNull();
  });

  it('leaves a panning fixed-layout book on the instant push', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const zoomed = settings('push');
    zoomed.zoomLevel = 150;
    expect(getCapturedTurnStyle(zoomed, true, false)).toBeNull();
  });

  it('never captures outside Tauri platforms', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    expect(getCapturedTurnStyle(settings('slide'), false)).toBeNull();
    expect(getCapturedTurnStyle(settings('curl'), false)).toBeNull();
  });
});

describe('applyPageTurnAttributes', () => {
  it('keeps the View Transition slide on fully supporting engines', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('slide'), false, false);
    expect(renderer.getAttribute('turn-style')).toBe('slide');
  });

  it('falls back to push on web engines without full View Transitions support', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    const { view, renderer } = makeView();
    renderer.setAttribute('turn-style', 'slide');
    renderer.setAttribute('captured-turn-style', 'slide');
    applyPageTurnAttributes(view, settings('slide'), false, false);
    expect(renderer.hasAttribute('turn-style')).toBe(false);
    expect(renderer.hasAttribute('captured-turn-style')).toBe(false);
  });

  it('hands the slide to the capture pipeline on Tauri without full support', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('slide'), false, false);
    // The app slides the captured page itself: the paginator must not run
    // its own View Transition nor its swipe tracking.
    expect(renderer.hasAttribute('turn-style')).toBe(false);
    expect(renderer.hasAttribute('no-swipe')).toBe(true);
    expect(renderer.getAttribute('captured-turn-style')).toBe('slide');
  });

  it('keeps the View Transition slide on fully supporting desktop Tauri engines', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('slide'), false, false);
    expect(renderer.getAttribute('turn-style')).toBe('slide');
    expect(renderer.hasAttribute('no-swipe')).toBe(false);
    expect(renderer.hasAttribute('captured-turn-style')).toBe(false);
  });

  it('hands the slide to the capture pipeline on fully supporting mobile Tauri engines', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('slide'), false, true);
    expect(renderer.hasAttribute('turn-style')).toBe(false);
    expect(renderer.hasAttribute('no-swipe')).toBe(true);
    expect(renderer.getAttribute('captured-turn-style')).toBe('slide');
  });

  it('publishes the captured arena for fixed-layout books', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('curl'), true, false);
    expect(renderer.getAttribute('captured-turn-style')).toBe('curl');
    expect(renderer.hasAttribute('turn-style')).toBe(false);
  });

  it('withholds the captured arena from a zoomed fixed-layout book', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const { view, renderer } = makeView();
    const zoomed = settings('curl');
    zoomed.zoomLevel = 150;
    applyPageTurnAttributes(view, zoomed, true, false);
    expect(renderer.hasAttribute('captured-turn-style')).toBe(false);
  });

  it('publishes the captured push arena for fixed-layout books', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('push'), true, false);
    expect(renderer.getAttribute('captured-turn-style')).toBe('push');
    expect(renderer.hasAttribute('turn-style')).toBe(false);
  });

  it('keeps reflowable push off the captured arena', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('push'), false, false);
    expect(renderer.hasAttribute('captured-turn-style')).toBe(false);
    expect(renderer.hasAttribute('turn-style')).toBe(false);
  });

  it('does not publish the native touch arena when swipe navigation is disabled', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    const { view, renderer } = makeView();
    const disabled = settings('slide');
    disabled.disableSwipe = true;

    applyPageTurnAttributes(view, disabled, false, false);

    expect(renderer.hasAttribute('no-swipe')).toBe(true);
    expect(renderer.hasAttribute('captured-turn-style')).toBe(false);
  });
});
