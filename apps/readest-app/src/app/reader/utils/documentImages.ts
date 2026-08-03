export interface DocumentImage {
  src: string;
  cfi: string | null;
  // The image's own description: the `alt` attribute, or the SVG <title> for
  // svg-wrapped images. Empty when the book provides none.
  alt: string;
}

// Every image of the rendered sections, in document order, so the image viewer
// can page through them and caption each one with its own description (#5232).
export const collectDocumentImages = (
  contents: { doc: Document; index?: number }[],
  getCFI: (index: number, range: Range) => string | null,
): DocumentImage[] => {
  const images: DocumentImage[] = [];
  contents.forEach(({ doc, index }) => {
    if (index === undefined) return;
    doc.querySelectorAll('img, svg').forEach((el) => {
      const cfiOf = (node: Element) => {
        const range = doc.createRange();
        range.selectNodeContents(node);
        return getCFI(index, range);
      };
      if (el.localName === 'img') {
        const img = el as HTMLImageElement;
        if (img.src && img.parentNode) {
          images.push({ src: img.src, cfi: cfiOf(img), alt: (img.alt || '').trim() });
        }
      } else if (el.localName === 'svg') {
        const svgImage = el.querySelector('image');
        const href =
          svgImage?.getAttribute('href') ||
          svgImage?.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (href) {
          const title = el.querySelector('title')?.textContent || '';
          images.push({ src: href, cfi: cfiOf(el), alt: title.trim() });
        }
      }
    });
  });
  return images;
};
