import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(
    process.cwd(),
    'src-tauri/plugins/tauri-plugin-native-bridge/ios/Sources/ClipUrlController.swift',
  ),
  'utf8',
);

// Execute the actual JavaScript passed to WKWebView, including the Swift
// parameter substitution. A stalled iframe leaves readyState at interactive.
function capture(
  readyState: DocumentReadyState,
  text: string,
  requireReady = true,
  minTextChars = 0,
) {
  document.body.innerHTML = text ? `<article><p>${text}</p></article>` : '';
  // jsdom has no layout-backed innerText; supply the rendered text explicitly.
  Object.defineProperty(document.body, 'innerText', { configurable: true, value: text });
  Object.defineProperty(document, 'readyState', { configurable: true, value: readyState });
  const script = source.match(/webView\.evaluateJavaScript\("(.*?)"\)/)?.[1];
  expect(script, 'native capture script').toBeDefined();
  const result: unknown = runInNewContext(
    script!
      .replace('\\(requireReady)', String(requireReady))
      .replace('\\(minTextChars)', String(minTextChars)),
    { document, location: window.location },
  );
  return typeof result === 'string' ? result : null;
}

afterEach(() => {
  Reflect.deleteProperty(document, 'readyState');
  document.body.innerHTML = '';
});

describe('iOS clip capture with stalled subresources (#6867)', () => {
  it('captures readable content while an iframe keeps the page loading', () => {
    expect(capture('interactive', 'The complete article.')).toContain('The complete article.');
  });

  it('does not capture an unfinished main document at the fallback deadline', () => {
    expect(capture('loading', 'Partial article.')).toBeNull();
  });

  it('does not save an empty SPA shell at the fallback deadline', () => {
    expect(capture('interactive', '   ')).toBeNull();
  });

  it('keeps normal and manual capture behavior', () => {
    expect(capture('loading', 'Partial article.', false)).toContain('Partial article.');
  });

  it('waits when a loaded SPA only contains navigation before its conversation renders', () => {
    expect(capture('complete', 'Sign inSign inGoogle apps', true, 400)).toBeNull();
    const conversation = 'The conversation has finished rendering. '.repeat(20);
    expect(capture('complete', conversation, true, 400)).toContain(conversation);
  });

  it('allows a short login page at the deadline and on manual capture', () => {
    expect(capture('complete', 'Sign in', true)).toContain('Sign in');
    expect(capture('complete', 'Sign in', false)).toContain('Sign in');
  });

  it('does not count surrounding whitespace as rendered content', () => {
    expect(capture('complete', `  Sign in${' '.repeat(500)}`, true, 400)).toBeNull();
  });

  it.skipIf(process.platform !== 'darwin')(
    'retries late content after 27 seconds until capture or timeout',
    () => {
      // Compile the real Swift method with a deterministic clock and WKWebView
      // boundary. Predicate behavior is exercised separately by the JS tests.
      const start = source.indexOf('  private func captureOuterHtml(');
      const end = source.indexOf('  private func finish(', start);
      const method = source.slice(start, end).replace(/^\s*clipLogger\.log.*$/m, '');
      const harness = readFileSync(
        resolve(process.cwd(), 'src/__tests__/ios/clip-url-scheduler.swift'),
        'utf8',
      );
      const directory = mkdtempSync(join(tmpdir(), 'readest-clip-scheduler-'));
      try {
        const file = join(directory, 'main.swift');
        writeFileSync(file, harness.replace('  // PRODUCTION_CAPTURE_METHOD', method));
        const output = execFileSync('swift', [file], { encoding: 'utf8', timeout: 20_000 });
        const result: unknown = JSON.parse(output);
        expect(result).toEqual({
          late: '<article>Late rendered article</article>',
          lateCompletions: 1,
          blank: 'timeout',
          blankCompletions: 1,
          blankEvaluations: 6,
        });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    25_000,
  );

  it('preserves the final URL in captured HTML', () => {
    const html = capture('complete', 'Article.');
    expect(html).toContain(`data-readest-url="${window.location.href}"`);
    expect(document.documentElement.hasAttribute('data-readest-url')).toBe(false);
  });
});
