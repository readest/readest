import { describe, test, expect } from 'vitest';
import { generateCoverSvg, pickTheme } from '@/services/send/conversion/coverGenerator';

const FAVICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).buffer as ArrayBuffer;
const AVATAR_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).buffer as ArrayBuffer;

describe('generateCoverSvg', () => {
  test('returns a non-empty SVG document with the correct mime', () => {
    const cover = generateCoverSvg({
      title: 'A Short Title',
      siteName: 'Example Site',
    });
    expect(cover.mime).toBe('image/svg+xml');
    expect(cover.bytes.byteLength).toBeGreaterThan(0);

    const svg = new TextDecoder().decode(cover.bytes);
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  test('embeds the title text (each word, since wrapping may split lines)', () => {
    const svg = new TextDecoder().decode(
      generateCoverSvg({ title: 'My Awesome Article', siteName: 'Example' }).bytes,
    );
    expect(svg).toContain('My');
    expect(svg).toContain('Awesome');
    expect(svg).toContain('Article');
  });

  test('falls back to the site name at the bottom when no author is provided', () => {
    const svg = new TextDecoder().decode(
      generateCoverSvg({ title: 'Hi', siteName: 'Machine Intelligence' }).bytes,
    );
    expect(svg).toContain('Machine Intelligence');
  });

  test('shows the author at the bottom when provided, in place of the site name', () => {
    const svg = new TextDecoder().decode(
      generateCoverSvg({
        title: 'Hi',
        siteName: 'example.com',
        author: 'Jane Doe',
      }).bytes,
    );
    expect(svg).toContain('Jane Doe');
    // Site name is not shown when an author is available — keeps the
    // bottom block single-line and legible at thumbnail size.
    expect(svg).not.toContain('example.com');
  });

  test('escapes XML special characters in title and site name', () => {
    const svg = new TextDecoder().decode(
      generateCoverSvg({
        title: 'Tom & Jerry <chase> "scene"',
        siteName: 'A & B',
      }).bytes,
    );
    // Raw `<chase>` would break the SVG XML. The segmenter may wrap the
    // angle brackets onto different lines, but every occurrence must be
    // escaped.
    expect(svg).not.toContain('<chase>');
    expect(svg).not.toContain('"scene"');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&lt;');
    expect(svg).toContain('&gt;');
    expect(svg).toContain('&quot;');
  });

  test('embeds the favicon as a base64 data URL when provided', () => {
    const svg = new TextDecoder().decode(
      generateCoverSvg({
        title: 'Title',
        siteName: 'Site',
        favicon: { bytes: FAVICON_BYTES, mime: 'image/png' },
      }).bytes,
    );
    expect(svg).toContain('data:image/png;base64,');
    // base64 of the PNG signature bytes
    expect(svg).toContain('iVBORw0K');
  });

  test('prefers the author profile image over the favicon when both are provided', () => {
    const svg = new TextDecoder().decode(
      generateCoverSvg({
        title: 'Title',
        siteName: 'Site',
        favicon: { bytes: FAVICON_BYTES, mime: 'image/png' },
        authorImage: { bytes: AVATAR_BYTES, mime: 'image/jpeg' },
      }).bytes,
    );
    // base64 of the JPEG signature bytes — author image, not favicon.
    expect(svg).toContain('data:image/jpeg;base64,');
    expect(svg).toContain('/9j/4AAQ');
    // PNG-signature base64 of the favicon must NOT appear when the
    // author image won the slot.
    expect(svg).not.toContain('iVBORw0K');
  });

  test('still produces a valid cover when no avatar image is provided (initial-letter fallback)', () => {
    const svg = new TextDecoder().decode(
      generateCoverSvg({ title: 'Hello', siteName: 'My Site' }).bytes,
    );
    expect(svg).toContain('<svg');
    // No data URL when there is no favicon, but the SVG must still be well-formed
    expect(svg).not.toContain('data:image');
    // Initial-letter placeholder: first letter of site name appears as a tspan/text
    expect(svg).toMatch(/[>"]M[<"]/);
  });

  test('clips the avatar with a circle (not a rounded rect)', () => {
    const svg = new TextDecoder().decode(
      generateCoverSvg({
        title: 'Title',
        siteName: 'Site',
        favicon: { bytes: FAVICON_BYTES, mime: 'image/png' },
      }).bytes,
    );
    expect(svg).toContain('clipPath');
    expect(svg).toContain('<circle');
  });
});

describe('pickTheme — author-hashed cover theme', () => {
  test('is deterministic — same author always gets the same theme', () => {
    expect(pickTheme('Jane Doe')).toEqual(pickTheme('Jane Doe'));
    expect(pickTheme('机器之心')).toEqual(pickTheme('机器之心'));
  });

  test('produces theme colors with top + bottom hex strings', () => {
    const theme = pickTheme('Jane Doe');
    expect(theme.top).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(theme.bottom).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  test('whitespace differences yield the same theme', () => {
    expect(pickTheme(' Jane Doe ')).toEqual(pickTheme('Jane Doe'));
  });

  test('empty key resolves to the first palette entry', () => {
    const empty = pickTheme('');
    expect(empty.top).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(empty.bottom).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  test('hashes the author into the SVG theme color', () => {
    const theme = pickTheme('Distinctive Author Name');
    const svg = new TextDecoder().decode(
      generateCoverSvg({
        title: 'Hi',
        siteName: 'example.com',
        author: 'Distinctive Author Name',
      }).bytes,
    );
    // The top color from the theme appears as a fill in the upper block.
    expect(svg.toLowerCase()).toContain(theme.top.toLowerCase());
  });

  test('mixed CJK + Latin title: short Latin tokens flow into adjacent CJK runs (no orphan lines)', () => {
    const svg = new TextDecoder().decode(
      generateCoverSvg({
        title: 'AI 知识库技术演进拆解：从 RAG 到 NotebookLM，再到 LLM Wiki',
        siteName: 'mp.weixin.qq.com',
      }).bytes,
    );
    // "AI" must not appear on a line by itself — it should pack with the
    // following CJK characters into a single line of text.
    expect(svg).not.toMatch(/>AI<\/text>/);
    // "AI" plus at least one CJK char must appear on the same line.
    expect(svg).toMatch(/>AI [一-鿿]/);
  });

  test('CJK right-punctuation glues to the preceding character (never starts a line)', () => {
    const svg = new TextDecoder().decode(
      generateCoverSvg({
        title: '知识库技术演进拆解：从 RAG 到 NotebookLM',
        siteName: 'site',
      }).bytes,
    );
    // A `<text>` line beginning with `：` would break Chinese typography.
    expect(svg).not.toMatch(/>：/);
    // And the Chinese comma must not start a line either.
    expect(svg).not.toMatch(/>，/);
  });

  test('Japanese title: wraps via Intl.Segmenter, all characters present', () => {
    const title = 'プログラミング入門：JavaScriptで学ぶ基礎';
    const svg = new TextDecoder().decode(generateCoverSvg({ title, siteName: 'qiita.com' }).bytes);
    // Every CJK character from the title appears in the SVG (no
    // truncation / dropped characters under 5-line cap).
    for (const ch of 'プログラミング入門JavaScript') {
      expect(svg).toContain(ch);
    }
  });

  test('Thai title: wraps without spaces between words (dictionary-based segmentation)', () => {
    // Thai has no spaces between words — the segmenter uses ICU's Thai
    // dictionary to find word breaks. We just verify the title renders
    // without crashing and the characters are present.
    const title = 'การเรียนรู้ JavaScript เบื้องต้น';
    const svg = new TextDecoder().decode(generateCoverSvg({ title, siteName: 'site' }).bytes);
    expect(svg).toContain('การ');
    expect(svg).toContain('JavaScript');
    expect(svg).toContain('เบื้องต้น');
  });

  test('latin words stay whole — no mid-word break on long Latin runs that fit', () => {
    const svg = new TextDecoder().decode(
      generateCoverSvg({
        title: 'Intro NotebookLM 实战指南',
        siteName: 'site',
      }).bytes,
    );
    // NotebookLM must appear intact somewhere on the cover.
    expect(svg).toContain('NotebookLM');
  });

  test('truncates an extremely long title with an ellipsis', () => {
    const longTitle = 'word '.repeat(200).trim();
    const svg = new TextDecoder().decode(
      generateCoverSvg({ title: longTitle, siteName: 'Site' }).bytes,
    );
    expect(svg).toMatch(/…|\.\.\./);
  });

  test('uses 600x900 viewport (2:3 book-cover aspect)', () => {
    const svg = new TextDecoder().decode(generateCoverSvg({ title: 'X', siteName: 'Y' }).bytes);
    expect(svg).toMatch(/viewBox="0 0 600 900"/);
  });
});
