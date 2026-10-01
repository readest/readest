// A bitmap spine item (EPUB 3 `image/jpeg` etc. directly in the spine, as in
// the IDPF haruko-jpeg / page-blanche-bitmaps-in-spine samples) is loaded by
// the browser as its own image document, which carries a synthetic
// `<meta name="viewport" content="width=device-width, minimum-scale=0.1">`.
// getViewport must not take that meta as the page size (it yields no numeric
// width/height, collapsing the page to the 300x150 iframe default) and must
// fall through to the image's natural size instead (#480).
import { afterEach, describe, expect, it, vi } from 'vitest';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getViewport', () => {
  it('sizes a bitmap spine item by its natural size, not the image-document viewport meta', async () => {
    expect(await getViewport(imageDocument(600, 837), undefined)).toEqual({
      width: 600,
      height: 837,
    });
  });

  it('keeps an explicit numeric viewport meta', async () => {
    const doc = new DOMParser().parseFromString(
      '<html><head><meta name="viewport" content="width=1200, height=1600"></head><body></body></html>',
      'text/html',
    );
    expect(await getViewport(doc, undefined)).toMatchObject({ width: '1200', height: '1600' });
  });

  it('parses a numeric book viewport string into a page size', async () => {
    const doc = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
    expect(await getViewport(doc, 'width=1200, height=1600')).toMatchObject({
      width: '1200',
      height: '1600',
    });
  });

  // KCC-style comics declare `rendition:viewport` as `width=(None, None),
  // height=(None, None)` and wrap each page as an unsized SVG <image>; the
  // page then has to be sized by the image, not left at the iframe's 300x150
  // default (#6530)
  it('sizes an SVG-wrapped page image by its natural size when the book viewport is not numeric', async () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><div><svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">' +
        '<image xlink:href="blob:page"/></svg></div></body></html>',
      'text/html',
    );
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        naturalWidth = 0;
        naturalHeight = 0;
        async decode() {
          if (this.src === 'blob:page')
            Object.assign(this, { naturalWidth: 1350, naturalHeight: 1920 });
        }
      },
    );
    expect(await getViewport(doc, 'width=(None, None), height=(None, None)')).toEqual({
      width: 1350,
      height: 1920,
    });
  });

  it('prefers the book viewport over a non-numeric meta when there is no image', async () => {
    const doc = new DOMParser().parseFromString(
      '<html><head><meta name="viewport" content="width=device-width"></head><body></body></html>',
      'text/html',
    );
    expect(await getViewport(doc, { width: 800, height: 1000 })).toEqual({
      width: 800,
      height: 1000,
    });
  });
});
