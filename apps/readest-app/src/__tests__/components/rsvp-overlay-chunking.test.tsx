import { describe, expect, test, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';

import RSVPOverlay from '@/app/reader/components/rsvp/RSVPOverlay';
import { RSVPController } from '@/services/rsvp/RSVPController';
import { FoliateView } from '@/types/view';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    themeCode: { primary: '#3B82F6', bg: '#111827', fg: '#f3f4f6' },
    isDarkMode: true,
  }),
}));

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeController(text: string): RSVPController {
  const textNode = { nodeType: Node.TEXT_NODE, textContent: text } as unknown as Text;
  const body = {
    nodeType: Node.ELEMENT_NODE,
    tagName: 'BODY',
    childNodes: [textNode],
  } as unknown as HTMLElement;
  const doc = {
    body,
    createRange: vi.fn().mockReturnValue({ setStart: vi.fn(), setEnd: vi.fn() }),
    defaultView: {
      getComputedStyle: vi.fn().mockReturnValue({ display: 'block', visibility: 'visible' }),
    },
  } as unknown as Document;
  (body as unknown as { ownerDocument: Document }).ownerDocument = doc;
  (textNode as unknown as { ownerDocument: Document }).ownerDocument = doc;
  const view = {
    renderer: { primaryIndex: 0, getContents: vi.fn().mockReturnValue([{ doc, index: 0 }]) },
    book: { toc: [] },
    language: { isCJK: false },
    tts: null,
    getCFI: vi.fn().mockReturnValue('epubcfi(/6/4!/4/2/1:0)'),
    resolveCFI: vi.fn().mockReturnValue({ anchor: vi.fn().mockReturnValue(new Range()) }),
  } as unknown as FoliateView;
  const controller = new RSVPController(view, 'book');
  controller.setStartDelay(0);
  return controller;
}

function renderOverlay(controller: RSVPController) {
  return render(
    <RSVPOverlay
      controller={controller}
      currentChapterHref='ch1.xhtml'
      chapters={[]}
      gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
      onChapterSelect={vi.fn()}
      onRequestNextPage={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('RSVPOverlay multi-word chunks', () => {
  test('shows every word of the chunk and highlights them in the context panel', () => {
    const controller = makeController('The quick brown fox jumps');
    controller.setChunkSize(3);
    controller.start();
    controller.pause();
    const { container } = renderOverlay(controller);

    const shown = [...container.querySelectorAll('.rsvp-chunk-word')].map((el) => el.textContent);
    expect(shown).toEqual(['The', 'quick', 'brown']);

    // Current words are not clickable seek targets; the rest are.
    const contextWords = container.querySelectorAll('[data-rsvp-word-button]');
    expect([...contextWords].map((el) => el.getAttribute('role'))).toEqual([
      null,
      null,
      null,
      'button',
      'button',
    ]);
  });

  test('[ and ] keep stepping the chunk size on repeated presses', () => {
    const controller = makeController('The quick brown fox jumps');
    controller.start();
    controller.pause();
    renderOverlay(controller);

    act(() => void fireEvent.keyDown(document, { key: ']' }));
    act(() => void fireEvent.keyDown(document, { key: ']' }));
    expect(controller.currentState.chunkSize).toBe(3);
    act(() => void fireEvent.keyDown(document, { key: '[' }));
    expect(controller.currentState.chunkSize).toBe(2);
  });

  test('the settings select changes the chunk size', () => {
    const controller = makeController('The quick brown fox jumps');
    controller.start();
    controller.pause();
    const { container, getByTestId } = renderOverlay(controller);

    fireEvent.click(container.querySelector('[aria-label="Settings"]') as HTMLElement);
    fireEvent.change(getByTestId('rsvp-chunk-size-select'), { target: { value: '4' } });
    expect(controller.currentState.chunkSize).toBe(4);
  });
});
