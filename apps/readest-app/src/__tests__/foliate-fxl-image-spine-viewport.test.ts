// A bitmap spine item (EPUB 3 `image/jpeg` etc. directly in the spine, as in
// the IDPF haruko-jpeg / page-blanche-bitmaps-in-spine samples) is loaded by
// the browser as its own image document, which carries a synthetic
// `<meta name="viewport" content="width=device-width, minimum-scale=0.1">`.
// getViewport must not take that meta as the page size (it yields no numeric
// width/height, collapsing the page to the 300x150 iframe default) and must
// fall through to the image's natural size instead (#480).
import { describe, expect, it } from 'vitest';

import { getViewport } from 'foliate-js/fixed-layout.js';

const imageDocument = (naturalWidth: number, naturalHeight: number) => {
  const doc = new DOMParser().parseFromString(
    '<html><head><meta name="viewport" content="width=device-width, minimum-scale=0.1"></head>' +
      '<body><img src="page.jpg"></body></html>',
    'text/html',
  );
  const img = doc.querySelector('img')!;
  Object.defineProperty(img, 'naturalWidth', { value: naturalWidth });
  Object.defineProperty(img, 'naturalHeight', { value: naturalHeight });
  return doc;
};

describe('getViewport', () => {
  it('sizes a bitmap spine item by its natural size, not the image-document viewport meta', () => {
    expect(getViewport(imageDocument(600, 837), undefined)).toEqual({ width: 600, height: 837 });
  });

  it('keeps an explicit numeric viewport meta', () => {
    const doc = new DOMParser().parseFromString(
      '<html><head><meta name="viewport" content="width=1200, height=1600"></head><body></body></html>',
      'text/html',
    );
    expect(getViewport(doc, undefined)).toMatchObject({ width: '1200', height: '1600' });
  });

  it('prefers the book viewport over a non-numeric meta when there is no image', () => {
    const doc = new DOMParser().parseFromString(
      '<html><head><meta name="viewport" content="width=device-width"></head><body></body></html>',
      'text/html',
    );
    expect(getViewport(doc, { width: 800, height: 1000 })).toEqual({ width: 800, height: 1000 });
  });
});
