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
});
