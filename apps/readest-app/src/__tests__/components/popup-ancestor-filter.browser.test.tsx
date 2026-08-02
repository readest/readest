/**
 * Regression test: the popup must not be wrapped in a `filter` ancestor.
 *
 * `Popup` is handed OUTER-webview viewport coordinates and pins itself with
 * `position: absolute` + `z-50`. A non-none `filter` on any ancestor makes that
 * ancestor a containing block AND a stacking context for absolutely positioned
 * descendants, which silently:
 *
 *   1. re-anchors the popup to the wrapper instead of the viewport, and
 *   2. demotes `z-50` so later reader chrome (FooterBar, BooknotesNav,
 *      SearchResultsNav, FootnotePopup — all siblings rendered after
 *      <Annotator> in BooksGrid) paints over the popup.
 *
 * Shadows around the pointer triangle therefore have to live on the triangle
 * elements themselves, never on a wrapper.
 */

import React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { page } from 'vitest/browser';

vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => {} }));

const { default: Popup } = await import('@/components/Popup');
await import('@/styles/globals.css');

beforeAll(async () => {
  await page.viewport(800, 600);
});
afterEach(() => cleanup());

const renderPopup = (children: React.ReactNode) =>
  render(
    <>
      <Popup width={200} height={60} position={{ dir: 'down', point: { x: 300, y: 200 } }}>
        <div style={{ height: 60 }}>content</div>
      </Popup>
      {children}
    </>,
  );

describe('Popup ancestor filter regressions', () => {
  it('anchors to the requested viewport point inside an offset unpositioned ancestor', () => {
    const { container } = render(
      <div style={{ marginLeft: 120, marginTop: 90 }}>
        <Popup width={200} height={60} position={{ dir: 'down', point: { x: 300, y: 200 } }}>
          <div style={{ height: 60 }}>content</div>
        </Popup>
      </div>,
    );
    const rect = (
      container.querySelector('#popup-container') as HTMLElement
    ).getBoundingClientRect();
    expect({ x: Math.round(rect.left), y: Math.round(rect.top) }).toEqual({ x: 300, y: 200 });
  });

  it('paints above reader chrome rendered after it with a lower z-index', () => {
    renderPopup(
      <div
        style={{ position: 'absolute', left: 300, top: 200, width: 200, height: 60, zIndex: 40 }}
      />,
    );
    expect(document.elementFromPoint(400, 230)?.closest('#popup-container')).not.toBeNull();
  });
});
