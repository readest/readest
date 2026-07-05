import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  applyPageTurnAttributes,
  getCapturedTurnStyle,
  supportsViewTransitionTurns,
} from '@/app/reader/hooks/useCapturedTurn';
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
  }) as ViewSettings;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete (document as unknown as VTDocument).startViewTransition;
});

describe('supportsViewTransitionTurns', () => {
  it('reports no support without startViewTransition', () => {
    stubEngine({ startViewTransition: false, nestedGroups: true });
    expect(supportsViewTransitionTurns()).toBe(false);
  });

  it('reports no support when nested view-transition groups are missing (iOS 18 WebKit)', () => {
    stubEngine({ startViewTransition: true, nestedGroups: false });
    expect(supportsViewTransitionTurns()).toBe(false);
  });

  it('reports support on engines with nested view-transition groups', () => {
    stubEngine({ startViewTransition: true, nestedGroups: true });
    expect(supportsViewTransitionTurns()).toBe(true);
  });
});

describe('getCapturedTurnStyle', () => {
  it('captures the slide on Tauri when the engine cannot layer View Transitions', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    expect(getCapturedTurnStyle(settings('slide'), false)).toBe('slide');
  });

  it('leaves the slide to View Transitions on fully supporting engines', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: true });
    expect(getCapturedTurnStyle(settings('slide'), false)).toBeNull();
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
    applyPageTurnAttributes(view, settings('slide'), false);
    expect(renderer.getAttribute('turn-style')).toBe('slide');
  });

  it('falls back to push on web engines without full View Transitions support', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    const { view, renderer } = makeView();
    renderer.setAttribute('turn-style', 'slide');
    applyPageTurnAttributes(view, settings('slide'), false);
    expect(renderer.hasAttribute('turn-style')).toBe(false);
  });

  it('hands the slide to the capture pipeline on Tauri without full support', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    stubEngine({ startViewTransition: true, nestedGroups: false });
    const { view, renderer } = makeView();
    applyPageTurnAttributes(view, settings('slide'), false);
    // The app slides the captured page itself: the paginator must not run
    // its own View Transition nor its swipe tracking.
    expect(renderer.hasAttribute('turn-style')).toBe(false);
    expect(renderer.hasAttribute('no-swipe')).toBe(true);
  });
});
