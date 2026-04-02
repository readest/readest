import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FoliateView } from '@/types/view';

vi.mock('@/utils/throttle', () => ({
  throttle: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
}));
vi.mock('@/utils/debounce', () => ({
  debounce: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
}));

const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
vi.stubGlobal(
  'IntersectionObserver',
  class {
    constructor(
      public callback: IntersectionObserverCallback,
      public options?: IntersectionObserverInit,
    ) {}
    observe = mockObserve;
    disconnect = mockDisconnect;
    unobserve = vi.fn();
  },
);

import { handleA11yNavigation } from '@/utils/a11y';

function createMockView() {
  return {
    renderer: {
      addEventListener: vi.fn(),
    },
    getCFI: vi.fn().mockReturnValue('epubcfi(/6/4)'),
    resolveNavigation: vi.fn().mockReturnValue({ index: 0 }),
  };
}

describe('handleA11yNavigation', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockObserve.mockClear();
    mockDisconnect.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
    // Clean up skip link from document body between tests
    const existing = document.getElementById('readest-skip-link');
    if (existing) existing.remove();
  });

  test('returns early when view is null', () => {
    expect(() => {
      handleA11yNavigation(null, document, 0);
    }).not.toThrow();
  });

  test('sets tabindex="-1" on anchor elements', () => {
    const a1 = document.createElement('a');
    const a2 = document.createElement('a');
    document.body.appendChild(a1);
    document.body.appendChild(a2);

    const view = createMockView();
    handleA11yNavigation(view as unknown as FoliateView, document, 0);

    expect(a1.getAttribute('tabindex')).toBe('-1');
    expect(a2.getAttribute('tabindex')).toBe('-1');

    a1.remove();
    a2.remove();
  });

  test('creates skip link with correct attributes', () => {
    const callback = vi.fn();
    const view = createMockView();

    handleA11yNavigation(view as unknown as FoliateView, document, 0, {
      skipToLastPosCallback: callback,
      skipToLastPosLabel: 'Skip to reading position',
    });

    const skipLink = document.getElementById('readest-skip-link');
    expect(skipLink).not.toBeNull();
    expect(skipLink!.getAttribute('cfi-inert')).toBe('');
    expect(skipLink!.getAttribute('tabindex')).toBe('0');
    expect(skipLink!.getAttribute('aria-hidden')).toBe('false');
    expect(skipLink!.getAttribute('aria-label')).toBe('Skip to reading position');
    // Should be first child of body
    expect(document.body.firstElementChild).toBe(skipLink);
  });

  test('skip link click calls callback', () => {
    const callback = vi.fn();
    const view = createMockView();

    handleA11yNavigation(view as unknown as FoliateView, document, 0, {
      skipToLastPosCallback: callback,
      skipToLastPosLabel: 'Skip',
    });

    const skipLink = document.getElementById('readest-skip-link');
    expect(skipLink).not.toBeNull();

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    skipLink!.dispatchEvent(clickEvent);

    expect(callback).toHaveBeenCalledOnce();
  });

  test('does not duplicate skip link if already exists', () => {
    const view = createMockView();

    // First call creates the skip link
    handleA11yNavigation(view as unknown as FoliateView, document, 0, {
      skipToLastPosCallback: vi.fn(),
      skipToLastPosLabel: 'First',
    });

    // Second call should not create another
    handleA11yNavigation(view as unknown as FoliateView, document, 0, {
      skipToLastPosCallback: vi.fn(),
      skipToLastPosLabel: 'Second',
    });

    const skipLinks = document.querySelectorAll('#readest-skip-link');
    expect(skipLinks.length).toBe(1);
    // Label should still be from the first call
    expect(skipLinks[0]!.getAttribute('aria-label')).toBe('First');
  });

  test('observes paragraph elements', () => {
    const p1 = document.createElement('p');
    const p2 = document.createElement('p');
    const p3 = document.createElement('p');
    document.body.appendChild(p1);
    document.body.appendChild(p2);
    document.body.appendChild(p3);

    const view = createMockView();
    handleA11yNavigation(view as unknown as FoliateView, document, 0);

    expect(mockObserve).toHaveBeenCalledTimes(3);
    expect(mockObserve).toHaveBeenCalledWith(p1);
    expect(mockObserve).toHaveBeenCalledWith(p2);
    expect(mockObserve).toHaveBeenCalledWith(p3);

    p1.remove();
    p2.remove();
    p3.remove();
  });

  test('registers scroll and relocate listeners on renderer', () => {
    const view = createMockView();
    handleA11yNavigation(view as unknown as FoliateView, document, 0);

    expect(view.renderer.addEventListener).toHaveBeenCalledTimes(2);

    const calls = view.renderer.addEventListener.mock.calls;
    expect(calls[0]![0]).toBe('scroll');
    expect(typeof calls[0]![1]).toBe('function');
    expect(calls[0]![2]).toEqual({ passive: true });

    expect(calls[1]![0]).toBe('relocate');
    expect(typeof calls[1]![1]).toBe('function');
  });

  test('skip link aria-label defaults to empty string when no options', () => {
    const view = createMockView();
    handleA11yNavigation(view as unknown as FoliateView, document, 0);

    const skipLink = document.getElementById('readest-skip-link');
    expect(skipLink).not.toBeNull();
    expect(skipLink!.getAttribute('aria-label')).toBe('');
  });
});
