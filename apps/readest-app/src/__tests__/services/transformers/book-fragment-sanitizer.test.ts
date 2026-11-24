import { describe, expect, it } from 'vitest';

import { sanitizeBookFragment } from '@/services/transformers/sanitizer';

// Markup copied out of a book document into the app window (table viewer,
// paragraph mode) runs with the app's privileges, so it is sanitized again.
describe('sanitizeBookFragment', () => {
  it('drops executable markup and keeps book presentation', () => {
    const html = sanitizeBookFragment(
      '<p style="color: red">text<ruby>漢<rt>kan</rt></ruby>' +
        '<img src="blob:http://localhost/abc" onerror="window.__pwned=1">' +
        '<style>body{display:none}</style><script>window.__pwned=2</script>' +
        '<iframe srcdoc="x"></iframe><meta http-equiv="refresh" content="0;url=https://example.com"></p>',
    );
    const root = document.createElement('div');
    root.innerHTML = html;

    expect(root.querySelector('p')?.getAttribute('style')).toContain('color');
    expect(root.querySelector('rt')?.textContent).toBe('kan');
    expect(root.querySelector('img')?.getAttribute('src')).toBe('blob:http://localhost/abc');
    expect(root.querySelector('[onerror], script, style, iframe, meta')).toBeNull();
  });

  it('keeps data: URLs on images but not on links', () => {
    const svg =
      'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E';
    const html = sanitizeBookFragment(
      `<a href="${svg}">link</a><img src="data:image/png;base64,AAAA">` +
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        `<image xlink:href="${svg}"/><a xlink:href="${svg}"><text>t</text></a></svg>`,
    );
    const root = document.createElement('div');
    root.innerHTML = html;

    expect(root.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(root.querySelector('svg a')?.hasAttribute('xlink:href')).toBe(false);
    expect(root.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(root.querySelector('image')?.getAttribute('xlink:href')).toBe(svg);
  });
});
