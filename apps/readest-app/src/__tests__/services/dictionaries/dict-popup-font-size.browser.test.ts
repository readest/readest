import { afterEach, describe, expect, it } from 'vitest';

// Real-browser regression test for readest#4443 (adjustable dictionary popup
// font size). The feature hangs entirely on CSS behaviour jsdom cannot model:
//   1. Tailwind `text-*` utilities re-based to `em` so they ride a scaled
//      `font-size` root on `[data-dict-content]`.
//   2. `::part(dict-content)` reaching into the MDict shadow root, with the
//      `--dict-font-scale` custom property inheriting across the boundary.
// Both need a layout engine + a real Shadow DOM + Custom Highlight-free part
// styling, so this lives in the browser lane.
//
// The rules below mirror the `[data-dict-content]` block in
// `src/styles/globals.css`; keep them byte-identical to what ships.
const POPUP_FONT_RULES = `
[data-dict-content] {
  font-size: calc(var(--dict-font-scale, 1) * 1em);
}
[data-dict-content] .text-xs { font-size: 0.75em; }
[data-dict-content] .text-sm { font-size: 0.875em; }
[data-dict-content] .text-base { font-size: 1em; }
[data-dict-content] .text-lg { font-size: 1.125em; }
[data-dict-content] .dict-shadow-host::part(dict-content) {
  font-size: calc(var(--dict-font-scale, 1) * 0.875rem);
}
`;

let style: HTMLStyleElement | null = null;
let root: HTMLElement | null = null;

const px = (el: Element): number => parseFloat(getComputedStyle(el).fontSize);

/**
 * Build the exact DOM the popup produces for a card: a `[data-dict-content]`
 * content root holding a light-DOM headword + body (e.g. the DICT provider)
 * and an MDict shadow host whose shadow body carries `part="dict-content"`.
 */
const mountCard = (scale: number) => {
  root = document.createElement('div');
  // The popup's surrounding chrome inherits the document base; force a known
  // 16px base so `rem`/`em` math is deterministic regardless of UA defaults.
  root.style.fontSize = '16px';
  root.innerHTML = `
    <div data-dict-content style="--dict-font-scale: ${scale}">
      <h1 class="text-lg" data-testid="headword">word</h1>
      <pre class="text-sm" data-testid="light-body">a definition</pre>
      <div class="dict-shadow-host mt-2 text-sm" data-testid="host"></div>
    </div>`;
  document.body.appendChild(root);

  const host = root.querySelector('[data-testid="host"]') as HTMLElement;
  const shadow = host.attachShadow({ mode: 'open' });
  const body = document.createElement('div');
  body.dataset['dictKind'] = 'mdict';
  body.setAttribute('part', 'dict-content');
  body.textContent = 'shadow definition';
  shadow.appendChild(body);

  return {
    headword: root.querySelector('[data-testid="headword"]') as HTMLElement,
    lightBody: root.querySelector('[data-testid="light-body"]') as HTMLElement,
    shadowBody: body,
  };
};

describe('dictionary popup font size (#4443)', () => {
  afterEach(() => {
    root?.remove();
    root = null;
    style?.remove();
    style = null;
  });

  it('renders default sizes at scale 1 and scales every region linearly', () => {
    style = document.createElement('style');
    style.textContent = POPUP_FONT_RULES;
    document.head.appendChild(style);

    const base = mountCard(1);
    // Defaults match the pre-feature look exactly: text-lg=18, text-sm=14,
    // and the MDict shadow body keeps its 0.875rem (14px) base.
    expect(px(base.headword)).toBeCloseTo(18, 1);
    expect(px(base.lightBody)).toBeCloseTo(14, 1);
    expect(px(base.shadowBody)).toBeCloseTo(14, 1);
    root!.remove();

    const big = mountCard(1.5);
    // Light-DOM utilities ride the scaled `[data-dict-content]` root...
    expect(px(big.headword)).toBeCloseTo(27, 1); // 18 * 1.5
    expect(px(big.lightBody)).toBeCloseTo(21, 1); // 14 * 1.5
    // ...and `::part()` carries the same factor across the shadow boundary,
    // proving --dict-font-scale inherits into the shadow tree.
    expect(px(big.shadowBody)).toBeCloseTo(21, 1); // 14 * 1.5
  });

  it('leaves the shadow body at its default when the part hook is absent', () => {
    // Without the part attribute the rule cannot reach the shadow content —
    // this guards against a future refactor dropping the hook silently.
    style = document.createElement('style');
    style.textContent = POPUP_FONT_RULES;
    document.head.appendChild(style);

    root = document.createElement('div');
    root.style.fontSize = '16px';
    root.innerHTML = `<div data-dict-content style="--dict-font-scale: 1.5">
      <div class="dict-shadow-host" data-testid="host"></div>
    </div>`;
    document.body.appendChild(root);
    const host = root.querySelector('[data-testid="host"]') as HTMLElement;
    const shadow = host.attachShadow({ mode: 'open' });
    const body = document.createElement('div');
    body.style.fontSize = '0.875rem'; // its own author style, no part exposed
    body.textContent = 'unreachable';
    shadow.appendChild(body);

    expect(px(body)).toBeCloseTo(14, 1); // unscaled — the ::part rule can't bind
  });
});
