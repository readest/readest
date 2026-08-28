import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import PageTurnHint from '@/app/reader/components/annotator/PageTurnHint';

const INSETS = { top: 10, right: 20, bottom: 30, left: 40 };

const bars = (container: HTMLElement) =>
  Array.from((container.firstElementChild as HTMLElement).children) as HTMLElement[];

beforeEach(() => {
  const cell = document.createElement('div');
  cell.id = 'gridcell-book-1';
  const view = document.createElement('foliate-view');
  view.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 400, bottom: 800, width: 400, height: 800 }) as DOMRect;
  cell.appendChild(view);
  document.body.appendChild(cell);
});

afterEach(() => {
  document.getElementById('gridcell-book-1')?.remove();
  cleanup();
});

describe('PageTurnHint', () => {
  test('marks nothing while no edge is armed', () => {
    const { container } = render(
      <PageTurnHint bookKey='book-1' contentInsets={INSETS} hint={null} />,
    );
    expect(container.firstChild).toBe(null);
  });

  test('draws the trailing edges of the text area, inset by the margins', () => {
    const { container } = render(
      <PageTurnHint
        bookKey='book-1'
        contentInsets={INSETS}
        hint={{ corner: 'br', turned: false }}
      />,
    );
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.left).toBe('40px');
    expect(box.style.top).toBe('10px');
    expect(box.style.width).toBe('340px');
    expect(box.style.height).toBe('760px');

    const [side, foot] = bars(container);
    expect(side!.className).toContain('right-0');
    expect(foot!.className).toContain('bottom-0');
    expect(side!.style.transformOrigin).toBe('bottom');
    expect(foot!.style.transformOrigin).toBe('right');
  });

  test('draws the leading edges when the drag is turning back', () => {
    const { container } = render(
      <PageTurnHint
        bookKey='book-1'
        contentInsets={INSETS}
        hint={{ corner: 'tl', turned: false }}
      />,
    );
    const [side, foot] = bars(container);
    expect(side!.className).toContain('left-0');
    expect(foot!.className).toContain('top-0');
    expect(side!.style.transformOrigin).toBe('top');
    expect(foot!.style.transformOrigin).toBe('left');
  });

  test('draws the armed edge solid on e-ink, which cannot run a bar out', () => {
    document.documentElement.setAttribute('data-eink', 'true');
    const { container } = render(
      <PageTurnHint
        bookKey='book-1'
        contentInsets={INSETS}
        hint={{ corner: 'br', turned: false }}
      />,
    );
    const bar = bars(container)[0]!;
    expect(bar.style.transform).toBe('scaleY(1)');
    expect(Number(bar.style.opacity)).toBe(1);
    document.documentElement.removeAttribute('data-eink');
  });

  test('fills over the dwell, then holds once the page has turned', () => {
    const { container, rerender } = render(
      <PageTurnHint
        bookKey='book-1'
        contentInsets={INSETS}
        hint={{ corner: 'br', turned: false }}
      />,
    );
    const dwelling = bars(container)[0]!;
    expect(dwelling.style.transitionDuration).toBe('500ms');
    const dwellOpacity = Number(dwelling.style.opacity);

    rerender(
      <PageTurnHint
        bookKey='book-1'
        contentInsets={INSETS}
        hint={{ corner: 'br', turned: true }}
      />,
    );
    const turned = bars(container)[0]!;
    expect(turned.style.transform).toBe('scaleY(1)');
    expect(Number(turned.style.opacity)).toBeGreaterThan(dwellOpacity);
  });
});
