import { describe, test, expect, vi, afterEach } from 'vitest';
import type { FoliateView } from '@/types/view';
import { handleA11yNavigation } from '@/utils/a11y';

function createMockView() {
  return {} as FoliateView;
}

const LAST_POS_ID = 'readest-skip-link-last-pos';
const NEXT_SECTION_ID = 'readest-skip-link-next-section';

const cleanupSkipLinks = () => {
  document.getElementById(LAST_POS_ID)?.remove();
  document.getElementById(NEXT_SECTION_ID)?.remove();
};

const makeOptions = (overrides: Partial<Parameters<typeof handleA11yNavigation>[2]> = {}) => ({
  skipToLastPosCallback: vi.fn(),
  skipToLastPosLabel: 'last',
  skipToNextSectionCallback: vi.fn(),
  skipToNextSectionLabel: 'next',
  ...overrides,
});

describe('handleA11yNavigation', () => {
  afterEach(() => {
    cleanupSkipLinks();
    vi.restoreAllMocks();
  });

  test('returns early when view is null', () => {
    expect(() => {
      handleA11yNavigation(null, document);
    }).not.toThrow();
    expect(document.getElementById(LAST_POS_ID)).toBeNull();
    expect(document.getElementById(NEXT_SECTION_ID)).toBeNull();
  });

  test('sets tabindex="-1" on anchor elements', () => {
    const a1 = document.createElement('a');
    const a2 = document.createElement('a');
    document.body.appendChild(a1);
    document.body.appendChild(a2);

    handleA11yNavigation(createMockView(), document);

    expect(a1.getAttribute('tabindex')).toBe('-1');
    expect(a2.getAttribute('tabindex')).toBe('-1');

    a1.remove();
    a2.remove();
  });

  test('creates last-pos skip link with correct attributes as first child', () => {
    handleA11yNavigation(
      createMockView(),
      document,
      makeOptions({ skipToLastPosLabel: 'Skip to reading position' }),
    );

    const skipLink = document.getElementById(LAST_POS_ID);
    expect(skipLink).not.toBeNull();
    expect(skipLink!.getAttribute('cfi-inert')).toBe('');
    expect(skipLink!.getAttribute('tabindex')).toBe('0');
    expect(skipLink!.getAttribute('aria-hidden')).toBe('false');
    expect(skipLink!.getAttribute('aria-label')).toBe('Skip to reading position');
    expect(document.body.firstElementChild).toBe(skipLink);
  });

  test('creates next-section skip link with correct attributes as last child', () => {
    handleA11yNavigation(
      createMockView(),
      document,
      makeOptions({ skipToNextSectionLabel: 'Skip to next section' }),
    );

    const skipLink = document.getElementById(NEXT_SECTION_ID);
    expect(skipLink).not.toBeNull();
    expect(skipLink!.getAttribute('cfi-inert')).toBe('');
    expect(skipLink!.getAttribute('tabindex')).toBe('0');
    expect(skipLink!.getAttribute('aria-hidden')).toBe('false');
    expect(skipLink!.getAttribute('aria-label')).toBe('Skip to next section');
    expect(document.body.lastElementChild).toBe(skipLink);
  });

  test('last-pos skip link click calls skipToLastPosCallback', () => {
    const options = makeOptions();
    handleA11yNavigation(createMockView(), document, options);

    const skipLink = document.getElementById(LAST_POS_ID);
    expect(skipLink).not.toBeNull();
    skipLink!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(options.skipToLastPosCallback).toHaveBeenCalledOnce();
    expect(options.skipToNextSectionCallback).not.toHaveBeenCalled();
  });

  test('next-section skip link click calls skipToNextSectionCallback', () => {
    const options = makeOptions();
    handleA11yNavigation(createMockView(), document, options);

    const skipLink = document.getElementById(NEXT_SECTION_ID);
    expect(skipLink).not.toBeNull();
    skipLink!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(options.skipToNextSectionCallback).toHaveBeenCalledOnce();
    expect(options.skipToLastPosCallback).not.toHaveBeenCalled();
  });

  test('does not duplicate skip links if already exist', () => {
    handleA11yNavigation(
      createMockView(),
      document,
      makeOptions({ skipToLastPosLabel: 'First-last', skipToNextSectionLabel: 'First-next' }),
    );
    handleA11yNavigation(
      createMockView(),
      document,
      makeOptions({ skipToLastPosLabel: 'Second-last', skipToNextSectionLabel: 'Second-next' }),
    );

    expect(document.querySelectorAll(`#${LAST_POS_ID}`).length).toBe(1);
    expect(document.querySelectorAll(`#${NEXT_SECTION_ID}`).length).toBe(1);
    expect(document.getElementById(LAST_POS_ID)!.getAttribute('aria-label')).toBe('First-last');
    expect(document.getElementById(NEXT_SECTION_ID)!.getAttribute('aria-label')).toBe('First-next');
  });

  test('skip link aria-labels default to empty string when no options', () => {
    handleA11yNavigation(createMockView(), document);

    const lastPos = document.getElementById(LAST_POS_ID);
    const nextSection = document.getElementById(NEXT_SECTION_ID);
    expect(lastPos).not.toBeNull();
    expect(nextSection).not.toBeNull();
    expect(lastPos!.getAttribute('aria-label')).toBe('');
    expect(nextSection!.getAttribute('aria-label')).toBe('');
  });
});
