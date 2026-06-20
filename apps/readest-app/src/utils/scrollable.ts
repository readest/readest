// Makes wide/tall block content (tables, code blocks, equations) scroll inside the
// reading column instead of overflowing the page, and routes touch/wheel gestures so
// scrolling a box never turns the page. The matching CSS lives in getLayoutStyles()
// in ./style.ts and keys off these class names.

export const SCROLL_WRAPPER_CLASS = 'scroll-wrapper';
// Marks a wrapped table that fits its column: the wrapper drops to overflow:visible
// (not a scroll container — never clips, never captures gestures). A wider table
// keeps the default overflow:auto and scrolls. Toggled by updateTableFit.
export const SCROLL_WRAPPER_FIT_CLASS = 'scroll-wrapper-fit';
// Only the wrapper that applyScrollableStyle injects (around tables and display
// equations) captures swipe/wheel gestures so scrolling it doesn't turn the page.
// pre/code rely on native overflow scrolling and aren't routed; a bare <math> can't
// scroll itself (its box reports no overflow) — it's wrapped instead.
const SCROLLABLE_SELECTOR = `.${SCROLL_WRAPPER_CLASS}`;
const SCROLL_WRAPPER_TOLERANCE_PX = 4;
const SCROLL_WRAPPER_TOUCH_SCROLL_FLAG = 'data-readest-scroll-wrapper-touch-scroll';

const canScrollX = (el: Element) => el.scrollWidth - el.clientWidth > SCROLL_WRAPPER_TOLERANCE_PX;
const canScrollY = (el: Element) => el.scrollHeight - el.clientHeight > SCROLL_WRAPPER_TOLERANCE_PX;

/**
 * Nearest scroll box (table/equation wrapper, pre, or code) that can actually scroll
 * the gesture, or null. Walks up so a non-scrollable inner match (inline <code>, a
 * <pre><code> whose <pre> is the real scroller) doesn't shadow a scrollable
 * ancestor (e.g. a wide table wrapping that code).
 *
 * This module runs in the top-window realm but `target` comes from the iframe's
 * realm, so `target instanceof Element` is always false here — duck-type on
 * `closest` instead so the lookup works across realms.
 */
export const findScrollableBox = (target: EventTarget | null): HTMLElement | null => {
  if (!target || !('closest' in target)) return null;
  let el: Element | null = (target as Element).closest(SCROLLABLE_SELECTOR);
  while (el) {
    // Either axis: a tall code block scrolls vertically though it fits horizontally.
    if (canScrollX(el) || canScrollY(el)) return el as HTMLElement;
    el = el.parentElement?.closest(SCROLLABLE_SELECTOR) ?? null;
  }
  return null;
};

/**
 * A swipe along a box's scrollable axis scrolls the box and never turns the page —
 * the box owns that axis, even when already scrolled to the edge (no chaining into
 * a page turn). A swipe along a non-scrollable axis is left alone, so the reader
 * can still turn pages by swiping the other way over the box.
 */
export const shouldTableScrollConsumeTouch = (
  wrapper: HTMLElement,
  dx: number,
  dy: number,
): boolean => {
  if (Math.abs(dx) > Math.abs(dy)) return Math.abs(dx) >= 8 && canScrollX(wrapper);
  return Math.abs(dy) >= 8 && canScrollY(wrapper);
};

/**
 * A wheel/trackpad along a box's scrollable axis scrolls the box and never turns
 * the page, even at the edge — so trackpad momentum (or wheeling past the end of a
 * code block) can't chain into a page turn. The box owns that axis.
 */
export const shouldTableScrollConsumeWheel = (
  wrapper: HTMLElement,
  deltaX: number,
  deltaY: number,
): boolean => {
  if (Math.abs(deltaX) > Math.abs(deltaY)) return canScrollX(wrapper);
  return canScrollY(wrapper);
};

/**
 * Capture-phase touch + wheel routing so foliate's paginator and readest's wheel
 * pagination do not steal scrolls over a scroll box. Attached once per iframe document.
 */
export const applyTableTouchScroll = (document: Document) => {
  const root = document.documentElement;
  if (root.getAttribute(SCROLL_WRAPPER_TOUCH_SCROLL_FLAG) === 'true') return;
  root.setAttribute(SCROLL_WRAPPER_TOUCH_SCROLL_FLAG, 'true');

  let touchStartX = 0;
  let touchStartY = 0;
  let activeWrapper: HTMLElement | null = null;

  const onTouchStart = (e: TouchEvent) => {
    activeWrapper = findScrollableBox(e.target);
    if (!activeWrapper) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    touchStartX = touch.screenX;
    touchStartY = touch.screenY;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!activeWrapper) return;
    if (!activeWrapper.contains(e.target as Node)) return;

    const touch = e.changedTouches[0];
    if (!touch) return;

    const dx = touch.screenX - touchStartX;
    const dy = touch.screenY - touchStartY;
    if (!shouldTableScrollConsumeTouch(activeWrapper, dx, dy)) return;

    e.stopImmediatePropagation();
  };

  const onTouchEnd = () => {
    activeWrapper = null;
  };

  // Trackpad / mouse wheel over a scroll box generates wheel events (not touch).
  // foliate has no wheel handler, but readest forwards iframe wheel events to
  // pagination (see handleWheel -> 'iframe-wheel'), so a wheel over a scrollable box
  // would both scroll the box and turn the page.
  const onWheel = (e: WheelEvent) => {
    const wrapper = findScrollableBox(e.target);
    if (!wrapper) return;
    if (!shouldTableScrollConsumeWheel(wrapper, e.deltaX, e.deltaY)) return;
    // Native overflow scrolling of the box still happens (no preventDefault);
    // we only stop pagination from also acting on this wheel.
    e.stopImmediatePropagation();
  };

  const opts = { capture: true, passive: false } as const;
  document.addEventListener('touchstart', onTouchStart, opts);
  document.addEventListener('touchmove', onTouchMove, opts);
  document.addEventListener('touchend', onTouchEnd, opts);
  document.addEventListener('touchcancel', onTouchEnd, opts);
  document.addEventListener('wheel', onWheel, { capture: true, passive: true });
};

/**
 * A display equation: a <math> that is the sole content of its container (or is
 * explicitly display="block"). Those need a scroll wrapper; an inline <math> sitting
 * among text in a paragraph must be left alone so it keeps flowing with the text.
 */
const isDisplayMath = (math: Element): boolean => {
  if (math.getAttribute('display') === 'block') return true;
  const parent = math.parentElement;
  if (!parent) return false;
  for (const node of parent.childNodes) {
    if (node === math) continue;
    if (node.nodeType === Node.ELEMENT_NODE) return false;
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return false;
  }
  return true;
};

/**
 * Wrap each table — and each display equation — in a horizontally-scrollable
 * container so content wider than the column scrolls instead of overflowing the
 * page. A box that fits is marked fit (overflow:visible — not a scroll container).
 *
 * Math needs the wrapper rather than overflow on the <math> itself: a <math> box
 * reports scrollWidth === clientWidth even when its content overflows, so it can't
 * scroll on its own — but the wrapping <div>'s scrollWidth does reflect the overflow.
 */
export const applyScrollableStyle = (document: Document) => {
  const win = document.defaultView;
  const wrap = (el: Element) => {
    const parent = el.parentElement;
    if (!parent || parent.classList.contains(SCROLL_WRAPPER_CLASS)) return;
    const wrapper = document.createElement('div');
    wrapper.className = SCROLL_WRAPPER_CLASS;
    // cfi-skip keeps this layout-only wrapper out of CFIs: the wrapped element and
    // its descendants keep the same CFI they had before wrapping, so existing
    // highlights/bookmarks inside a table or equation still resolve.
    wrapper.setAttribute('cfi-skip', '');
    parent.insertBefore(wrapper, el);
    wrapper.appendChild(el);
    decideTableFit(wrapper, win);
  };
  document.querySelectorAll('table').forEach(wrap);
  document.querySelectorAll('math').forEach((math) => {
    if (isDisplayMath(math)) wrap(math);
  });
};

/**
 * Toggle SCROLL_WRAPPER_FIT_CLASS: a table within tolerance of its column fits
 * (overflow:visible — not a scroll container), a wider one stays overflow:auto.
 */
export const updateTableFit = (wrapper: HTMLElement) => {
  const fits = wrapper.scrollWidth - wrapper.clientWidth <= SCROLL_WRAPPER_TOLERANCE_PX;
  wrapper.classList.toggle(SCROLL_WRAPPER_FIT_CLASS, fits);
};

/**
 * Decide fit ONCE, after layout. applyScrollableStyle runs while the iframe is still
 * display:none (every width is 0), so the measurement must wait for layout — via a
 * ResizeObserver that disconnects on its first real measurement. It measures exactly
 * once and then never observes again, so it never fires during a page turn (a
 * *persistent* observer is what caused the #4391 relayerize storm).
 */
const decideTableFit = (wrapper: HTMLElement, win: (Window & typeof globalThis) | null) => {
  if (!win?.ResizeObserver) return; // no layout (jsdom): leave default (scrollable)
  const observer = new win.ResizeObserver(() => {
    if (wrapper.clientWidth <= 0) return; // not laid out yet
    updateTableFit(wrapper);
    observer.disconnect();
  });
  observer.observe(wrapper);
};
