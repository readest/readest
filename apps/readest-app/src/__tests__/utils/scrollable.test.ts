import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyScrollableStyle,
  applyTableTouchScroll,
  findScrollableBox,
  updateTableFit,
  shouldTableScrollConsumeTouch,
  shouldTableScrollConsumeWheel,
  SCROLL_WRAPPER_CLASS,
  SCROLL_WRAPPER_FIT_CLASS,
} from '@/utils/scrollable';

describe('applyScrollableStyle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('wraps a table in a horizontal scroll container', () => {
    document.body.innerHTML = `
      <div>
        <table>
          <tr>
            <td width="100">Cell 1</td>
            <td width="200">Cell 2</td>
          </tr>
        </table>
      </div>
    `;
    applyScrollableStyle(document);
    const table = document.querySelector('table')!;
    const wrapper = table.parentElement;
    expect(wrapper?.classList.contains(SCROLL_WRAPPER_CLASS)).toBe(true);
    expect(table.style.transform).toBe('');
  });

  it('wraps multiple tables independently', () => {
    document.body.innerHTML = `
      <div>
        <table id="t1"><tr><td>A</td></tr></table>
        <table id="t2"><tr><td>B</td></tr></table>
      </div>
    `;
    applyScrollableStyle(document);
    const wrappers = document.querySelectorAll(`.${SCROLL_WRAPPER_CLASS}`);
    expect(wrappers).toHaveLength(2);
  });

  it('does not double-wrap when applyScrollableStyle runs twice', () => {
    document.body.innerHTML = `
      <div>
        <table><tr><td>Cell</td></tr></table>
      </div>
    `;
    applyScrollableStyle(document);
    applyScrollableStyle(document);
    expect(document.querySelectorAll(`.${SCROLL_WRAPPER_CLASS}`)).toHaveLength(1);
  });

  it('does not crash on a table whose parent is body', () => {
    document.body.innerHTML = `
      <table>
        <tr><td width="100">A</td></tr>
      </table>
    `;
    applyScrollableStyle(document);
    const table = document.querySelector('table')!;
    expect(table.parentElement?.classList.contains(SCROLL_WRAPPER_CLASS)).toBe(true);
  });

  it('wraps a display equation (math that is the sole content of its container)', () => {
    document.body.innerHTML = `
      <div data-type="equation">
        <math><mrow><mi>x</mi></mrow></math>
      </div>
    `;
    applyScrollableStyle(document);
    const math = document.querySelector('math')!;
    expect(math.parentElement?.classList.contains(SCROLL_WRAPPER_CLASS)).toBe(true);
  });

  it('does not wrap inline math that flows with surrounding text', () => {
    document.body.innerHTML = `<p>tokens <math><mi>x</mi></math>, then more text</p>`;
    applyScrollableStyle(document);
    const math = document.querySelector('math')!;
    expect(math.parentElement?.classList.contains(SCROLL_WRAPPER_CLASS)).toBe(false);
    expect(math.parentElement?.tagName.toLowerCase()).toBe('p');
  });

  it('wraps math[display="block"] even when it has a sibling (e.g. an equation number)', () => {
    document.body.innerHTML = `<div><math display="block"><mi>x</mi></math><span>(1)</span></div>`;
    applyScrollableStyle(document);
    const math = document.querySelector('math')!;
    expect(math.parentElement?.classList.contains(SCROLL_WRAPPER_CLASS)).toBe(true);
  });
});

describe('updateTableFit', () => {
  const makeWrapper = (scrollWidth: number, clientWidth: number) => {
    const wrapper = document.createElement('div');
    wrapper.className = SCROLL_WRAPPER_CLASS;
    Object.defineProperty(wrapper, 'scrollWidth', { value: scrollWidth, configurable: true });
    Object.defineProperty(wrapper, 'clientWidth', { value: clientWidth, configurable: true });
    return wrapper;
  };

  it('marks a table that fits its column as not-a-scroll-container', () => {
    const wrapper = makeWrapper(200, 200);
    updateTableFit(wrapper);
    expect(wrapper.classList.contains(SCROLL_WRAPPER_FIT_CLASS)).toBe(true);
  });

  it('leaves a table wider than its column scrollable', () => {
    const wrapper = makeWrapper(400, 200);
    updateTableFit(wrapper);
    expect(wrapper.classList.contains(SCROLL_WRAPPER_FIT_CLASS)).toBe(false);
  });

  it('treats overflow within tolerance as fitting', () => {
    const wrapper = makeWrapper(203, 200); // 3px slop ≤ tolerance
    updateTableFit(wrapper);
    expect(wrapper.classList.contains(SCROLL_WRAPPER_FIT_CLASS)).toBe(true);
  });
});

describe('shouldTableScrollConsumeTouch', () => {
  it('returns false when the table is not wider than its container', () => {
    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'scrollWidth', { value: 100, configurable: true });
    Object.defineProperty(wrapper, 'clientWidth', { value: 100, configurable: true });
    expect(shouldTableScrollConsumeTouch(wrapper, -40, 0)).toBe(false);
  });

  it('consumes a horizontal swipe when more content is available to the right', () => {
    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(wrapper, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(wrapper, 'scrollLeft', { value: 0, configurable: true });
    expect(shouldTableScrollConsumeTouch(wrapper, -40, 0)).toBe(true);
  });

  it('still consumes at the right edge so it never chains to a page turn', () => {
    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(wrapper, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(wrapper, 'scrollLeft', { value: 200, configurable: true });
    expect(shouldTableScrollConsumeTouch(wrapper, -40, 0)).toBe(true);
  });

  it('ignores a vertical swipe on a box that only scrolls horizontally', () => {
    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(wrapper, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(wrapper, 'scrollLeft', { value: 0, configurable: true });
    expect(shouldTableScrollConsumeTouch(wrapper, -5, -40)).toBe(false);
  });

  it('consumes a vertical swipe when more content is available below (tall code block)', () => {
    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(wrapper, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(wrapper, 'scrollTop', { value: 0, configurable: true });
    // Finger up (dy < 0) scrolls down; content remains below the viewport.
    expect(shouldTableScrollConsumeTouch(wrapper, 0, -40)).toBe(true);
  });

  it('still consumes a vertical swipe at the bottom edge (never turns the page)', () => {
    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(wrapper, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(wrapper, 'scrollTop', { value: 200, configurable: true });
    expect(shouldTableScrollConsumeTouch(wrapper, 0, -40)).toBe(true);
  });
});

describe('shouldTableScrollConsumeWheel', () => {
  it('returns false when the table is not wider than its container', () => {
    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'scrollWidth', { value: 100, configurable: true });
    Object.defineProperty(wrapper, 'clientWidth', { value: 100, configurable: true });
    expect(shouldTableScrollConsumeWheel(wrapper, 40, 0)).toBe(false);
  });

  it('consumes a horizontal wheel when more content is available to the right', () => {
    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(wrapper, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(wrapper, 'scrollLeft', { value: 0, configurable: true });
    expect(shouldTableScrollConsumeWheel(wrapper, 40, 0)).toBe(true);
  });

  it('still consumes at the right edge so it never chains to a page turn', () => {
    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(wrapper, 'clientWidth', { value: 200, configurable: true });
    // scrolled fully to the right edge
    Object.defineProperty(wrapper, 'scrollLeft', { value: 200, configurable: true });
    expect(shouldTableScrollConsumeWheel(wrapper, 40, 0)).toBe(true);
  });

  it('still consumes at the left edge so it never chains to a page turn', () => {
    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(wrapper, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(wrapper, 'scrollLeft', { value: 0, configurable: true });
    expect(shouldTableScrollConsumeWheel(wrapper, -40, 0)).toBe(true);
  });

  it('ignores a vertical wheel on a box that only scrolls horizontally', () => {
    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(wrapper, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(wrapper, 'scrollLeft', { value: 0, configurable: true });
    expect(shouldTableScrollConsumeWheel(wrapper, 5, 40)).toBe(false);
  });

  it('consumes a vertical wheel down while a tall box can still scroll down', () => {
    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(wrapper, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(wrapper, 'scrollTop', { value: 0, configurable: true });
    expect(shouldTableScrollConsumeWheel(wrapper, 0, 40)).toBe(true);
  });

  it('still consumes a vertical wheel at the bottom edge (never turns the page)', () => {
    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(wrapper, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(wrapper, 'scrollTop', { value: 200, configurable: true });
    expect(shouldTableScrollConsumeWheel(wrapper, 0, 40)).toBe(true);
  });
});

describe('findScrollableBox', () => {
  const setScroll = (el: HTMLElement, scrollWidth: number, clientWidth: number) => {
    Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true });
    Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
  };

  const makeWrapper = () => {
    const wrapper = document.createElement('div');
    wrapper.className = SCROLL_WRAPPER_CLASS;
    const inner = document.createElement('span');
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);
    return { wrapper, inner };
  };

  it('routes a scrollable wrapper (table / equation) from a target inside it', () => {
    const { wrapper, inner } = makeWrapper();
    setScroll(wrapper, 400, 200);
    expect(findScrollableBox(inner)).toBe(wrapper);
    wrapper.remove();
  });

  it('only routes the scroll-wrapper — bare pre / code / math do not capture gestures', () => {
    // pre/code/math rely on native overflow scrolling; only the wrapper that
    // applyScrollableStyle adds (tables, display equations) is routed.
    for (const tag of ['pre', 'code', 'math'] as const) {
      const box = document.createElement(tag);
      const inner = document.createElement('span');
      box.appendChild(inner);
      document.body.appendChild(box);
      setScroll(box, 400, 200);
      expect(findScrollableBox(inner), `${tag} should NOT route`).toBeNull();
      box.remove();
    }
  });

  it('routes a wrapper that only overflows vertically (tall block)', () => {
    const { wrapper, inner } = makeWrapper();
    setScroll(wrapper, 200, 200); // fits horizontally
    Object.defineProperty(wrapper, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(wrapper, 'clientHeight', { value: 200, configurable: true });
    expect(findScrollableBox(inner)).toBe(wrapper);
    wrapper.remove();
  });

  it('ignores a wrapper that fits (overflow within tolerance)', () => {
    const { wrapper, inner } = makeWrapper();
    setScroll(wrapper, 202, 200); // 2px slop ≤ tolerance
    expect(findScrollableBox(inner)).toBeNull();
    wrapper.remove();
  });

  it('returns null for targets outside any scroll box', () => {
    const p = document.createElement('p');
    document.body.appendChild(p);
    expect(findScrollableBox(p)).toBeNull();
    expect(findScrollableBox(null)).toBeNull();
    p.remove();
  });
});

describe('applyTableTouchScroll', () => {
  it('attaches capture-phase touch and wheel listeners once per document', () => {
    document.documentElement.removeAttribute('data-readest-table-touch-scroll');
    const addSpy = vi.spyOn(document, 'addEventListener');
    applyTableTouchScroll(document);
    applyTableTouchScroll(document);
    const touchMoves = addSpy.mock.calls.filter(([type]) => type === 'touchmove');
    expect(touchMoves).toHaveLength(1);
    expect(touchMoves[0]?.[2]).toEqual({ capture: true, passive: false });
    const wheels = addSpy.mock.calls.filter(([type]) => type === 'wheel');
    expect(wheels).toHaveLength(1);
    expect(wheels[0]?.[2]).toEqual({ capture: true, passive: true });
    addSpy.mockRestore();
  });
});
