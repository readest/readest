// In paginated mode each column is a page, and Chromium doesn't break a column
// for `page-break-before: always` or `break-before: page`. foliate-js rewrites
// those to column breaks in linked stylesheets only, so a break written in a
// `style` attribute or a `<style>` block was ignored (#6873).
import { afterEach, describe, expect, test } from 'vitest';

import { styleTransformer } from '@/services/transformers/style';
import type { TransformContext } from '@/services/transformers/types';
import type { ViewSettings } from '@/types/book';

const iframes: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const iframe of iframes.splice(0)) iframe.remove();
});

const transform = (content: string) =>
  styleTransformer.transform({
    bookKey: 'book',
    viewSettings: { vertical: false } as ViewSettings,
    userLocale: 'en',
    isFixedLayout: false,
    width: 800,
    height: 600,
    content,
    transformers: ['style'],
  } satisfies TransformContext);

// Lays the section out in two 200px columns, as the paginator does, and
// returns the column the #target paragraph starts in.
const columnOfTarget = async (head: string, body: string) => {
  const html = await transform(`<html><head>${head}</head><body>${body}</body></html>`);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'width: 400px; height: 200px; border: 0';
  document.body.appendChild(iframe);
  iframes.push(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  doc.documentElement.style.cssText =
    'columns: 200px; column-gap: 0; column-fill: auto; height: 200px; margin: 0';
  doc.body.style.margin = '0';
  return Math.floor(doc.getElementById('target')!.getBoundingClientRect().left / 200);
};

describe('styleTransformer page breaks', () => {
  test.each([
    'page-break-before: always',
    'page-break-before:always',
    'break-before: page',
    'break-before:always;page-break-before:always;',
  ])('a break in a style attribute starts the next column: %s', async (css) => {
    const column = await columnOfTarget('', `<p>a</p><p id="target" style="${css}">b</p>`);
    expect(column).toBe(1);
  });

  test('a break in a <style> block starts the next column', async () => {
    const column = await columnOfTarget(
      '<style>.chapter { page-break-before: always; }</style>',
      '<p>a</p><p id="target" class="chapter">b</p>',
    );
    expect(column).toBe(1);
  });

  test('a custom property named like a page break is left alone', async () => {
    const html = await transform(
      '<p style="--page-break-before: column; break-before: var(--page-break-before)">b</p>',
    );
    expect(html).toContain('--page-break-before: column; break-before: var(--page-break-before)');
  });

  test('text that reads like a style attribute is left alone', async () => {
    const text = '<pre> style="page-break-before: always"</pre>';
    expect(await transform(text)).toBe(text);
  });

  test('another attribute whose value mentions a style is left alone', async () => {
    const text = `<p title="Use style='page-break-before: always'">b</p>`;
    expect(await transform(text)).toBe(text);
  });

  test('a paragraph without a break stays in the first column', async () => {
    const column = await columnOfTarget('', '<p>a</p><p id="target" style="color: red">b</p>');
    expect(column).toBe(0);
  });
});
