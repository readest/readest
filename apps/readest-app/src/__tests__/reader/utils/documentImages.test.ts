import { describe, it, expect } from 'vitest';

import { collectDocumentImages } from '@/app/reader/utils/documentImages';

const docFromBody = (body: string) =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');

const getCFI = (index: number) => `cfi-${index}`;

describe('collectDocumentImages', () => {
  // #5232: EPUBs often carry the caption/table description of an illustration
  // in the `alt` attribute rather than a <figcaption>, so the image viewer
  // needs it alongside the src to show it while the image is zoomed.
  it('captures the alt text of every image in document order', () => {
    const doc = docFromBody(`
      <div class="figure">
        <p><img alt="Tabella di come creare una buona abitudine" src="https://book/07b.jpg"/></p>
      </div>
      <p><img alt="Second figure" src="https://book/08.jpg"/></p>
    `);

    const images = collectDocumentImages([{ doc, index: 3 }], getCFI);

    expect(images).toEqual([
      {
        src: 'https://book/07b.jpg',
        cfi: 'cfi-3',
        alt: 'Tabella di come creare una buona abitudine',
      },
      { src: 'https://book/08.jpg', cfi: 'cfi-3', alt: 'Second figure' },
    ]);
  });

  it('reports no description for images without usable alt text', () => {
    const doc = docFromBody(`
      <img src="https://book/a.jpg"/>
      <img alt="   " src="https://book/b.jpg"/>
    `);

    const images = collectDocumentImages([{ doc, index: 0 }], getCFI);

    expect(images.map((image) => image.alt)).toEqual(['', '']);
  });

  // Full-page illustrations are frequently wrapped in <svg><image/></svg>,
  // where the accessible description lives in the SVG <title> instead.
  it('uses the SVG <title> as the description for svg-wrapped images', () => {
    const doc = docFromBody(
      `<svg viewBox="0 0 100 100"><title>Diagram of the habit loop</title>` +
        `<image href="https://book/diagram.png"/></svg>`,
    );

    const images = collectDocumentImages([{ doc, index: 1 }], getCFI);

    expect(images).toEqual([
      { src: 'https://book/diagram.png', cfi: 'cfi-1', alt: 'Diagram of the habit loop' },
    ]);
  });
});
