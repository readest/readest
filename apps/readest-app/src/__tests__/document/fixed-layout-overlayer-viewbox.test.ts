// Regression test for: TTS highlight overlay is off the text boxes in
// fixed-layout EPUBs when the page is scaled up.
//
// In non-PDF fixed-layout, the iframe is visually scaled with `transform:
// scale(N)` while its internal layout keeps native dimensions. The SVG
// overlayer sits next to the iframe at the scaled size, but
// `range.getClientRects()` inside the iframe returns positions in the
// iframe's native coord system. Without a matching `viewBox`, the SVG draws
// rects in CSS pixels and the highlight lands at scale-1 displacement from
// the actual text.
//
// The fix sets `viewBox="0 0 width height"` on the overlayer SVG so its
// coordinate system stays aligned with the iframe contents at any scale.
import { describe, expect, it } from 'vitest';

import { applyOverlayerViewBox } from 'foliate-js/fixed-layout.js';

const makeOverlayer = () => {
  const attrs: Record<string, string> = {};
  return {
    element: {
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
      removeAttribute: (name: string) => {
        delete attrs[name];
      },
      getAttribute: (name: string) => attrs[name] ?? null,
      _attrs: attrs,
    },
  };
};

describe('applyOverlayerViewBox', () => {
  it('sets viewBox to native iframe dimensions for transform-scaled frames', () => {
    const overlayer = makeOverlayer();
    applyOverlayerViewBox({ width: 558, height: 711 }, overlayer);

    expect(overlayer.element.getAttribute('viewBox')).toBe('0 0 558 711');
    expect(overlayer.element.getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('removes viewBox when frame uses onZoom (PDF text-layer rendered at scale)', () => {
    const overlayer = makeOverlayer();
    // pre-populate to simulate switching from EPUB-style frame to PDF frame
    overlayer.element.setAttribute('viewBox', '0 0 558 711');
    overlayer.element.setAttribute('preserveAspectRatio', 'none');

    applyOverlayerViewBox({ width: 558, height: 711, onZoom: () => {} }, overlayer);

    expect(overlayer.element.getAttribute('viewBox')).toBeNull();
    expect(overlayer.element.getAttribute('preserveAspectRatio')).toBeNull();
  });

  it('accepts scroll-mode frames keyed by vpWidth/vpHeight', () => {
    const overlayer = makeOverlayer();
    applyOverlayerViewBox({ vpWidth: 800, vpHeight: 1200 }, overlayer);

    expect(overlayer.element.getAttribute('viewBox')).toBe('0 0 800 1200');
  });

  it('is a no-op when the frame has no dimensions', () => {
    const overlayer = makeOverlayer();
    applyOverlayerViewBox({}, overlayer);

    expect(overlayer.element.getAttribute('viewBox')).toBeNull();
  });

  it('tolerates missing overlayer or element', () => {
    expect(() => applyOverlayerViewBox({ width: 100, height: 100 }, null)).not.toThrow();
    expect(() =>
      applyOverlayerViewBox({ width: 100, height: 100 }, { element: null }),
    ).not.toThrow();
  });
});
