import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe('browser page capture', () => {
  it('captures the current page after login and navigation without browser chrome', () => {
    document.body.innerHTML =
      '<article>Sign in</article><div id="__readest_browser_chrome__">Clip Page</div>';
    window.history.replaceState({}, '', '/members/chapter-2');
    document.querySelector('article')!.textContent = 'Full chapter: 日本語 & <text>';
    const script = readFileSync('src-tauri/src/web_browser_capture.js', 'utf8');
    const page = runInNewContext(script, { document, location: window.location }) as {
      url: string;
      html: string;
    };
    expect(page.url).toBe(window.location.href);
    expect(page.url).toContain('/members/chapter-2');
    expect(page.html).toContain('Full chapter: 日本語 &amp; &lt;text&gt;');
    expect(page.html).not.toContain('__readest_browser_chrome__');
    expect(document.getElementById('__readest_browser_chrome__')).not.toBeNull();
  });

  it('does not capture internal or blank browser pages', () => {
    const script = readFileSync('src-tauri/src/web_browser_capture.js', 'utf8');
    expect(runInNewContext(script, { document, location: { protocol: 'about:' } })).toBeNull();
  });
});
