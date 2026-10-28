import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useScrollbarReveal } from '@/app/reader/hooks/useScrollbarReveal';
import { SCROLLBAR_REVEAL_VAR, SCROLLBAR_THUMB_COLOR } from '@/utils/style';

// The hook reaches the bar's reveal switch through the renderer's shadow root,
// so the fake renderer carries a real shadow tree with a `[part="container"]`
// element -- exactly what `bindTargets` looks up.
const makeRenderer = () => {
  const renderer = document.createElement('div');
  const container = document.createElement('div');
  container.setAttribute('part', 'container');
  renderer.attachShadow({ mode: 'open' }).appendChild(container);
  return { renderer, container };
};

const rect = (left: number, top: number, right: number, bottom: number) =>
  ({
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
  }) as DOMRect;

// jsdom has no PointerEvent; MouseEvent carries the client coordinates and the
// hook treats an undefined pointerType as mouse anyway.
const movePointer = (clientX: number, clientY: number, target: EventTarget = document) => {
  act(() => {
    target.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY, bubbles: true }));
  });
};

const revealed = (container: HTMLElement) =>
  container.style.getPropertyValue(SCROLLBAR_REVEAL_VAR) === SCROLLBAR_THUMB_COLOR;

describe('useScrollbarReveal hot-zone orientation', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('horizontal book: reveals in the right-hand strip and nowhere else', () => {
    const { renderer, container } = makeRenderer();
    vi.spyOn(renderer, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1000, 800));
    renderHook(() => useScrollbarReveal(renderer, true, false));

    movePointer(500, 400); // middle of the page
    expect(revealed(container)).toBe(false);
    movePointer(980, 400); // inside the 40px strip
    expect(revealed(container)).toBe(true);
    movePointer(1050, 400); // past the edge: neighbouring chrome
    expect(revealed(container)).toBe(false);
    movePointer(980, 900); // beside the strip but below the renderer
    expect(revealed(container)).toBe(false);
    movePointer(980, 400); // back in
    expect(revealed(container)).toBe(true);
  });

  it('vertical book: the strip is the bottom one, keyed by clientY', () => {
    const { renderer, container } = makeRenderer();
    vi.spyOn(renderer, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1000, 800));
    renderHook(() => useScrollbarReveal(renderer, true, true));

    movePointer(500, 400); // middle of the page
    expect(revealed(container)).toBe(false);
    movePointer(500, 780); // inside the bottom strip
    expect(revealed(container)).toBe(true);
    movePointer(500, 830); // past the bottom edge
    expect(revealed(container)).toBe(false);
    movePointer(1050, 780); // beside the strip but past the right edge
    expect(revealed(container)).toBe(false);
    movePointer(500, 780);
    expect(revealed(container)).toBe(true);
  });

  it('vertical book: frame coordinates map through the iframe and respect the edge', () => {
    const { renderer, container } = makeRenderer();
    vi.spyOn(renderer, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1000, 800));

    // jsdom gives a fresh iframe no contentDocument, but the hook only needs
    // two things from it: `contentDocument` to hang the listener on and
    // `contentDocument.defaultView.frameElement` to map coordinates back. A
    // stand-in document with both wired up exercises the same path.
    const frame = document.createElement('iframe');
    const frameDoc = document.implementation.createHTMLDocument('frame');
    Object.defineProperty(frameDoc, 'defaultView', {
      value: { frameElement: frame },
    });
    Object.defineProperty(frame, 'contentDocument', { value: frameDoc });
    renderer.shadowRoot!.appendChild(frame);
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(rect(0, 100, 1000, 900));
    // Real frame events bubble from an element inside the frame document, and
    // the hook maps back through that element's ownerDocument.
    const frameTarget = frameDoc.createElement('div');
    frameDoc.body.appendChild(frameTarget);
    renderHook(() => useScrollbarReveal(renderer, true, true));

    movePointer(500, 690, frameTarget); // 690 + 100 = 790, inside the strip
    expect(revealed(container)).toBe(true);
    movePointer(500, 740, frameTarget); // 740 + 100 = 840, past the bottom edge
    expect(revealed(container)).toBe(false);
  });
});
