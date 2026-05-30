import type { TocEntry } from './types';

/**
 * Walk an article HTML fragment, find every `<h1>`–`<h6>`, assign each a
 * stable `id` if missing, and return:
 *   - the rewritten HTML (headings now carry IDs)
 *   - the heading list in document order
 *
 * Used as a pre-step before sanitizing for the EPUB chapter so the
 * fragment IDs referenced by `toc.ncx` actually exist in the chapter
 * XHTML. Stable slugs mean a re-convert of the same article produces a
 * byte-identical EPUB (combined with the zeroed zip timestamps), which
 * keeps the import-time hash stable.
 */
export function extractHeadings(html: string): { html: string; headings: TocEntry[] } {
  const doc = new DOMParser().parseFromString(
    '<!doctype html><html><body></body></html>',
    'text/html',
  );
  const root = doc.createElement('div');
  root.id = '__toc_root';
  root.innerHTML = html;
  doc.body.appendChild(root);
  if (!root) return { html, headings: [] };

  const headings: TocEntry[] = [];
  const used = new Set<string>();
  let fallbackCounter = 0;

  for (const el of Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    // Honour the page's existing id if it looks usable; otherwise slug
    // from the heading text.
    let id = (el.getAttribute('id') || '').trim();
    if (!id) {
      id = slugify(text);
    }
    if (!id) {
      fallbackCounter++;
      id = `h-${fallbackCounter}`;
    }
    // De-duplicate. Two `## Intro` sections become `intro` + `intro-2`.
    let unique = id;
    let n = 2;
    while (used.has(unique)) {
      unique = `${id}-${n}`;
      n++;
    }
    used.add(unique);
    el.setAttribute('id', unique);

    const level = parseInt(el.tagName.charAt(1), 10);
    headings.push({ id: unique, text, level });
  }

  return { html: root.innerHTML, headings };
}

/** Slug a heading title into a fragment-id-safe string. CJK / emoji /
 *  other non-Latin scripts strip entirely — the caller falls back to
 *  `h-{n}` so we never emit an empty id. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * Render the nested `<navPoint>` tree for `toc.ncx` `<navMap>`. Each
 * heading becomes a navPoint nested under any prior heading of a
 * shallower level (`h2` under `h1`, `h3` under `h2`, etc.). `playOrder`
 * is a flat global counter — EPUB 2 requires it to be unique and start
 * at 1.
 */
export function buildNavMap(
  toc: TocEntry[],
  chapterFile: string,
  escapeXml: (s: string) => string,
): string {
  if (toc.length === 0) return '';
  const parts: string[] = [];
  const stack: number[] = [];
  let order = 0;
  for (const h of toc) {
    while (stack.length && stack[stack.length - 1]! >= h.level) {
      stack.pop();
      parts.push('</navPoint>');
    }
    order++;
    parts.push(
      `<navPoint id="np${order}" playOrder="${order}">` +
        `<navLabel><text>${escapeXml(h.text)}</text></navLabel>` +
        `<content src="${escapeXml(chapterFile)}#${escapeXml(h.id)}"/>`,
    );
    stack.push(h.level);
  }
  while (stack.length) {
    stack.pop();
    parts.push('</navPoint>');
  }
  return parts.join('\n');
}
