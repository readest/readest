import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from '@/services/transformers/sanitizer';

describe('SVG content document sanitization', () => {
  it('removes executable SVG content and preserves the SVG document', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 800 1200" onload="alert(1)">
      <script href="data:text/javascript,alert(1)" xlink:href="data:text/javascript,alert(1)"/>
      <foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" srcdoc="evil"/></foreignObject>
      <a href="javascript:alert(1)"><text x="30" y="50">Chapter</text></a>
      <image href="blob:https://reader.example/cover" width="800" height="1200"/>
    </svg>`;
    const doc = new DOMParser().parseFromString(sanitizeSvg(svg), 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.localName).toBe('svg');
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 800 1200');
    expect(doc.querySelector('script, iframe, foreignObject, [onload]')).toBeNull();
    expect(doc.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(doc.querySelector('text')?.textContent).toBe('Chapter');
    expect(doc.querySelector('image')?.getAttribute('href')).toBe(
      'blob:https://reader.example/cover',
    );
  });
  it('fails closed for malformed SVG', () => {
    expect(sanitizeSvg('<svg><script>')).toBe('');
  });
});
