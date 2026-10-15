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
});
