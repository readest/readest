import { describe, expect, it } from 'vitest';

import { createInkAnchoring } from '@/app/reader/utils/inkAnchoring';
import type { FoliateView } from '@/types/view';

const page = { left: 0, top: 0, width: 400, height: 600 };

describe('createInkAnchoring', () => {
  // Returning to the reader (e.g. back from the sign-in page) re-attaches the
  // still-open view, whose section iframe reloads: for a moment its document
  // has no root element yet.
  it('returns null while the section document has no root element', () => {
    const frame = { getBoundingClientRect: () => new DOMRect(0, 0, 400, 600) };
    const doc = { documentElement: null, defaultView: { frameElement: frame } };
    const view = {
      renderer: { getContents: () => [{ index: 3, doc }] },
    } as unknown as FoliateView;

    expect(createInkAnchoring(view, 3, page)).toBeNull();
  });

  // A section is XHTML, parsed as it streams in: while it still loads, the
  // <html> root is there but <body> isn't yet (#6901, an FB2 on first open).
  it('returns null while the section document has no body yet', () => {
    const frame = { getBoundingClientRect: () => new DOMRect(0, 0, 400, 600) };
    const doc = document.implementation.createDocument('http://www.w3.org/1999/xhtml', 'html');
    Object.defineProperty(doc, 'defaultView', {
      value: { frameElement: frame, getComputedStyle: window.getComputedStyle.bind(window) },
    });
    const view = {
      renderer: { getContents: () => [{ index: 3, doc }] },
    } as unknown as FoliateView;

    expect(doc.body).toBeNull();
    expect(createInkAnchoring(view, 3, page)).toBeNull();
  });
});
