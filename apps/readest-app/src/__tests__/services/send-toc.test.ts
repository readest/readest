import { describe, expect, test } from 'vitest';
import { buildNavMap, extractHeadings } from '@/services/send/conversion/toc';

const ESC = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

describe('extractHeadings', () => {
  test('returns h1–h6 in document order with their level', () => {
    const { headings } = extractHeadings(`
      <h1>Intro</h1>
      <p>...</p>
      <h2>Setup</h2>
      <h3>Install</h3>
      <h2>Usage</h2>
    `);
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'Intro'],
      [2, 'Setup'],
      [3, 'Install'],
      [2, 'Usage'],
    ]);
  });

  test('slugifies heading text into ids and writes them onto the elements', () => {
    const { html, headings } = extractHeadings(`<h2>Hello, world!</h2>`);
    expect(headings[0]!.id).toBe('hello-world');
    expect(html).toContain('id="hello-world"');
  });

  test('preserves an existing id verbatim instead of slugging', () => {
    const { headings, html } = extractHeadings(`<h2 id="custom-anchor">Section</h2>`);
    expect(headings[0]!.id).toBe('custom-anchor');
    expect(html).toContain('id="custom-anchor"');
  });

  test('de-duplicates colliding slugs with -2, -3, …', () => {
    const { headings, html } = extractHeadings(`
      <h2>Intro</h2>
      <h2>Intro</h2>
      <h2>Intro</h2>
    `);
    expect(headings.map((h) => h.id)).toEqual(['intro', 'intro-2', 'intro-3']);
    expect((html.match(/id="intro"/g) || []).length).toBe(1);
    expect((html.match(/id="intro-2"/g) || []).length).toBe(1);
    expect((html.match(/id="intro-3"/g) || []).length).toBe(1);
  });

  test('falls back to h-N when the heading text strips to nothing (CJK, emoji)', () => {
    const { headings } = extractHeadings(`<h2>简介</h2><h2>🚀</h2>`);
    expect(headings[0]!.id).toBe('h-1');
    expect(headings[1]!.id).toBe('h-2');
  });

  test('skips empty headings entirely (no id, no toc entry)', () => {
    const { headings } = extractHeadings(`<h2></h2><h2>   </h2><h2>Real</h2>`);
    expect(headings).toHaveLength(1);
    expect(headings[0]!.text).toBe('Real');
  });
});

describe('buildNavMap', () => {
  test('nests deeper levels under shallower ones', () => {
    const xml = buildNavMap(
      [
        { id: 'intro', text: 'Intro', level: 1 },
        { id: 'setup', text: 'Setup', level: 2 },
        { id: 'install', text: 'Install', level: 3 },
        { id: 'usage', text: 'Usage', level: 2 },
      ],
      'OEBPS/chapter1.xhtml',
      ESC,
    );
    // Intro contains Setup, Setup contains Install, then Usage is a sibling of Setup.
    expect(xml).toContain('<navPoint id="np1"');
    expect(xml).toContain('<navPoint id="np2"');
    expect(xml).toContain('<navPoint id="np3"');
    expect(xml).toContain('<navPoint id="np4"');
    // Install is closed before Usage opens (sibling of Setup).
    const installIdx = xml.indexOf('install');
    const usageIdx = xml.indexOf('usage');
    expect(installIdx).toBeLessThan(usageIdx);
    const installClose = xml.indexOf('</navPoint>', installIdx);
    expect(installClose).toBeLessThan(usageIdx);
  });

  test('uses sequential playOrder starting at 1', () => {
    const xml = buildNavMap(
      [
        { id: 'a', text: 'A', level: 2 },
        { id: 'b', text: 'B', level: 2 },
        { id: 'c', text: 'C', level: 2 },
      ],
      'OEBPS/chapter1.xhtml',
      ESC,
    );
    expect(xml).toContain('playOrder="1"');
    expect(xml).toContain('playOrder="2"');
    expect(xml).toContain('playOrder="3"');
    expect(xml).not.toContain('playOrder="4"');
  });

  test('emits the chapter#fragment link for each entry', () => {
    const xml = buildNavMap(
      [{ id: 'intro', text: 'Intro', level: 2 }],
      'OEBPS/chapter1.xhtml',
      ESC,
    );
    expect(xml).toContain('<content src="OEBPS/chapter1.xhtml#intro"/>');
  });

  test('returns empty string when given no headings', () => {
    expect(buildNavMap([], 'OEBPS/chapter1.xhtml', ESC)).toBe('');
  });

  test('balances opens and closes so the navMap parses', () => {
    const xml = buildNavMap(
      [
        { id: 'a', text: 'A', level: 1 },
        { id: 'b', text: 'B', level: 3 }, // skip level 2
        { id: 'c', text: 'C', level: 2 },
        { id: 'd', text: 'D', level: 4 },
      ],
      'OEBPS/chapter1.xhtml',
      ESC,
    );
    const opens = (xml.match(/<navPoint/g) || []).length;
    const closes = (xml.match(/<\/navPoint>/g) || []).length;
    expect(opens).toBe(closes);
  });
});
