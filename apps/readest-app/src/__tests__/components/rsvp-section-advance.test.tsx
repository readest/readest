'use client';

import { render, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import RSVPControl from '@/app/reader/components/rsvp/RSVPControl';
import { eventDispatcher } from '@/utils/event';

// ---------- Shared mutable test state ----------
// These are captured by closure in the mock factories below.
// Each beforeEach resets them.

let primaryIndex = 4;
const viewRelocateListeners: EventListener[] = [];
const loadedSections: number[] = [];
const controllerEventListeners = new Map<string, EventListener[]>();
let capturedOnRequestNextPage: (() => Promise<void>) | null = null;

// ---------- Mocks ----------

vi.mock('@/app/reader/components/rsvp/RSVPOverlay', () => ({
  default: vi.fn(({ onRequestNextPage }: { onRequestNextPage: () => Promise<void> }) => {
    capturedOnRequestNextPage = onRequestNextPage;
    return null;
  }),
}));

vi.mock('@/app/reader/components/rsvp/RSVPStartDialog', () => ({
  default: () => null,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => mockView,
    getProgress: () => ({
      location: 'epubcfi(/6/8!/4/1:0)',
      sectionHref: `ch${primaryIndex}.xhtml`,
    }),
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ book: { format: 'EPUB' }, bookDoc: { toc: [] } }),
    getConfig: () => null,
    setConfig: vi.fn(),
    saveConfig: vi.fn(),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ themeCode: { primary: '#000' } }),
}));

// RSVPController mock: fires rsvp-start-choice immediately from requestStart(),
// and tracks loadNextPageContent calls via the shared loadedSections array.
// Must use a regular function (not arrow function) so it can be called with `new`.
vi.mock('@/services/rsvp', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  RSVPController: vi.fn(function RSVPControllerMock() {
    return {
      seedPosition: vi.fn(),
      setCurrentCfi: vi.fn(),
      requestStart: vi.fn(() => {
        const event = new CustomEvent('rsvp-start-choice', {
          detail: { hasSavedPosition: false, hasSelection: false },
        });
        (controllerEventListeners.get('rsvp-start-choice') ?? []).forEach((h) => h(event));
      }),
      startFromCurrentPosition: vi.fn(),
      stop: vi.fn(),
      loadNextPageContent: vi.fn(() => {
        loadedSections.push(primaryIndex);
      }),
      getStoredPosition: vi.fn(() => null),
      get currentState() {
        return { active: true };
      },
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (!controllerEventListeners.has(type)) controllerEventListeners.set(type, []);
        controllerEventListeners.get(type)!.push(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        const arr = controllerEventListeners.get(type) ?? [];
        controllerEventListeners.set(
          type,
          arr.filter((l) => l !== listener),
        );
      }),
    };
  }),
  buildRsvpExitConfigUpdate: vi.fn(() => ({})),
}));

// ---------- Mock FoliateView ----------
const mockView = {
  renderer: {
    get primaryIndex() {
      return primaryIndex;
    },
    get atEnd() {
      return false;
    },
    // renderer.goTo is called directly with the exact target section index,
    // bypassing the reverted primaryIndex that nextSection() would use.
    goTo: vi.fn(async ({ index }: { index: number }) => {
      const prevIdx = primaryIndex;

      // #goTo sets #primaryIndex = index before the navigation relocate fires
      primaryIndex = index;

      const navEvent = new CustomEvent('relocate', {
        detail: {
          section: { current: index },
          tocItem: { href: `ch${index}.xhtml` },
        },
      });
      [...viewRelocateListeners].forEach((l) => l(navEvent));

      // After navigation, a scroll event fires and #detectPrimaryView()
      // reverts #primaryIndex to the old section (same revert behaviour
      // as before, but now we navigated to the correct section in the first place)
      primaryIndex = prevIdx;
    }),
    getContents: vi.fn(() => []),
  },
  addEventListener: vi.fn((type: string, listener: EventListener) => {
    if (type === 'relocate') viewRelocateListeners.push(listener);
  }),
  removeEventListener: vi.fn((type: string, listener: EventListener) => {
    if (type === 'relocate') {
      const idx = viewRelocateListeners.indexOf(listener);
      if (idx >= 0) viewRelocateListeners.splice(idx, 1);
    }
  }),
  book: { format: 'EPUB' },
  getCFI: vi.fn(() => null),
  addAnnotation: vi.fn(),
  resolveCFI: vi.fn(),
};

// ---------- Tests ----------

describe('RSVPControl — section advance tracking', () => {
  beforeEach(() => {
    primaryIndex = 4;
    loadedSections.length = 0;
    viewRelocateListeners.length = 0;
    controllerEventListeners.clear();
    capturedOnRequestNextPage = null;
  });

  afterEach(() => {
    cleanup();
  });

  test('advances directly to rsvpSectionRef+1, loading section 6 on second advance', async () => {
    render(
      <RSVPControl bookKey='test-book' gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }} />,
    );

    // Start RSVP — handleStart auto-starts without showing a dialog because
    // the mock controller fires rsvp-start-choice with no saved position
    await act(async () => {
      eventDispatcher.dispatch('rsvp-start', { bookKey: 'test-book' });
      await new Promise<void>((r) => setTimeout(r, 20));
    });

    // RSVPOverlay should now be mounted and onRequestNextPage captured
    expect(capturedOnRequestNextPage).not.toBeNull();

    // First section advance: rsvpSectionRef starts at 4 → goTo(5)
    await act(async () => {
      await capturedOnRequestNextPage!();
    });

    expect(loadedSections[0]).toBe(5); // section 5 correctly loaded on first advance
    expect(primaryIndex).toBe(4); // confirms primaryIndex has reverted after navigation
    expect(mockView.renderer.goTo).toHaveBeenNthCalledWith(1, { index: 5 });

    // Second advance: rsvpSectionRef is now 5 → goTo(6).
    // Without the fix, nextSection() used the reverted primaryIndex=4 and
    // navigated to section 5 again, causing a stale-section freeze.
    await act(async () => {
      await capturedOnRequestNextPage!();
    });

    expect(loadedSections).toEqual([5, 6]);
    expect(mockView.renderer.goTo).toHaveBeenNthCalledWith(2, { index: 6 });
  });
});
