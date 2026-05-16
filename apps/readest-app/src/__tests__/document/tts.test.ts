import { describe, it, expect, vi } from 'vitest';
import { textWalker } from 'foliate-js/text-walker.js';
import { TTS } from 'foliate-js/tts.js';
import { createRejectFilter } from '@/utils/node';

const createHTMLDoc = (bodyHTML: string, attrs: Record<string, string> = {}): Document => {
  const parser = new DOMParser();
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  const html = `<!DOCTYPE html><html${attrStr}><body>${bodyHTML}</body></html>`;
  return parser.parseFromString(html, 'text/html');
};

const createXHTMLDoc = (bodyHTML: string, attrs: Record<string, string> = {}): Document => {
  const parser = new DOMParser();
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<html${attrStr}><head><title></title></head><body>${bodyHTML}</body></html>`;
  return parser.parseFromString(xml, 'application/xhtml+xml');
};

const createPlainHTMLDoc = (html: string): Document => {
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
};

/** Strip all XML tags to get plain text content from SSML */
const stripTags = (ssml: string): string => ssml.replace(/<[^>]+\/?>/g, '').trim();

const highlight = vi.fn();

/** Node filter mirroring the footnote rules TTSController passes to TTS. */
const ttsNodeFilter = createRejectFilter({
  tags: ['rt', 'canvas', 'br'],
  classes: [
    'annotationLayer',
    'epubtype-footnote',
    'duokan-footnote-content',
    'duokan-footnote-item',
  ],
  attributeTokens: [
    { tag: 'aside', attribute: 'epub:type', tokens: ['footnote', 'endnote', 'note', 'rearnote'] },
  ],
  contents: [{ tag: 'a', content: /^[\[\(]?[\*\d]+[\)\]]?$/ }],
});

describe('TTS', () => {
  describe('plain HTML document', () => {
    it('should init and generate SSML for a plain HTML doc without doctype or lang', () => {
      const doc = createPlainHTMLDoc(`<html><head></head><body><p>Hello world</p></body></html>`);
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(stripTags(ssml!)).toBe('Hello world');
    });
  });

  describe('document with lang attribute', () => {
    it('should init and generate SSML with lang on html element', () => {
      const doc = createHTMLDoc('<p>Hello world</p>', { lang: 'en' });
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(stripTags(ssml!)).toBe('Hello world');
    });

    it('should init and generate SSML with xml:lang on XHTML element', () => {
      const doc = createXHTMLDoc('<p>Hello world</p>', {
        xmlns: 'http://www.w3.org/1999/xhtml',
        'xml:lang': 'en',
      });
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(stripTags(ssml!)).toBe('Hello world');
    });

    it('should propagate lang into SSML speak element', () => {
      const doc = createHTMLDoc('<p>Hello world</p>', { lang: 'fr' });
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(ssml).toContain('xml:lang="fr"');
    });
  });

  describe('document without lang or xml:lang', () => {
    it('should init and generate SSML for HTML doc without any lang', () => {
      const doc = createHTMLDoc('<p>Hello world</p>');
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(stripTags(ssml!)).toBe('Hello world');
    });

    it('should init and generate SSML for XHTML doc with xmlns but no lang', () => {
      const doc = createXHTMLDoc('<p>Hello world</p>', {
        xmlns: 'http://www.w3.org/1999/xhtml',
      });
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(stripTags(ssml!)).toBe('Hello world');
    });

    it('should navigate with next() on doc without lang', () => {
      const doc = createHTMLDoc('<p>First paragraph</p><p>Second paragraph</p>');
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml1 = tts.start();
      const ssml2 = tts.next();

      expect(ssml1).toBeTruthy();
      expect(stripTags(ssml1!)).toContain('First paragraph');
      if (ssml2) {
        expect(stripTags(ssml2)).toContain('Second paragraph');
      }
    });

    it('should generate SSML with sentence granularity on doc without lang', () => {
      const doc = createHTMLDoc('<p>First sentence. Second sentence.</p>');
      const tts = new TTS(doc, textWalker, undefined, highlight, 'sentence');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(stripTags(ssml!)).toContain('First sentence');
    });

    it('should not include xml:lang on speak element when doc has no lang', () => {
      const doc = createHTMLDoc('<p>No lang content</p>');
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      const speakMatch = ssml!.match(/<speak[^>]*>/);
      expect(speakMatch).toBeTruthy();
      expect(speakMatch![0]).not.toContain('xml:lang');
    });
  });

  describe('document without xmlns namespace declarations', () => {
    it('should init and generate SSML for XHTML doc without xmlns', () => {
      // XHTML without xmlns="http://www.w3.org/1999/xhtml" causes doc.body to be null
      const doc = createXHTMLDoc('<p>Hello world</p>');
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(stripTags(ssml!)).toBe('Hello world');
    });

    it('should init and generate SSML for XHTML doc without xmlns but with xml:lang', () => {
      const doc = createXHTMLDoc('<p>Hello world</p>', {
        'xml:lang': 'en',
      });
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(stripTags(ssml!)).toBe('Hello world');
    });

    it('should init and generate SSML for XHTML doc without epub namespace', () => {
      // Missing xmlns:epub="http://www.idpf.org/2007/ops" should not prevent TTS
      const doc = createXHTMLDoc('<p>Hello world</p>', {
        xmlns: 'http://www.w3.org/1999/xhtml',
      });
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(stripTags(ssml!)).toBe('Hello world');
    });
  });

  describe('document without both lang and xmlns', () => {
    it('should init and generate SSML for bare XHTML doc', () => {
      // No xmlns and no lang: both issues combined
      const doc = createXHTMLDoc('<p>Bare document content</p>');
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(stripTags(ssml!)).toBe('Bare document content');
    });

    it('should handle multiple blocks in bare XHTML doc', () => {
      const doc = createXHTMLDoc('<p>First block</p><div>Second block</div><p>Third block</p>');
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml1 = tts.start();
      expect(ssml1).toBeTruthy();

      const ssml2 = tts.next();
      if (ssml2) {
        expect(ssml2).toBeTruthy();
      }
    });
  });

  describe('footnotes', () => {
    /** Collect plain text of every TTS block by walking start()/next(). */
    const collectBlocks = (tts: InstanceType<typeof TTS>): string[] => {
      const blocks: string[] = [];
      let ssml = tts.start();
      while (ssml) {
        blocks.push(stripTags(ssml));
        ssml = tts.next();
      }
      return blocks;
    };

    it('should not read aside footnotes (epub:type) at the end of a chapter', () => {
      const doc = createHTMLDoc(
        '<p>First paragraph of the chapter.</p>' +
          '<p>Second paragraph of the chapter.</p>' +
          '<aside epub:type="footnote" id="fn1"><p>Hidden footnote content.</p></aside>',
      );
      const tts = new TTS(doc, textWalker, ttsNodeFilter, highlight, 'word');
      const combined = collectBlocks(tts).join(' ');

      expect(combined).toContain('First paragraph');
      expect(combined).toContain('Second paragraph');
      expect(combined).not.toContain('Hidden footnote content');
    });

    it('should not read aside footnotes in a namespaced XHTML doc', () => {
      const doc = createXHTMLDoc(
        '<p>Body text here.</p>' +
          '<aside epub:type="footnote"><p>Namespaced footnote.</p></aside>',
        {
          xmlns: 'http://www.w3.org/1999/xhtml',
          'xmlns:epub': 'http://www.idpf.org/2007/ops',
        },
      );
      const tts = new TTS(doc, textWalker, ttsNodeFilter, highlight, 'word');
      const combined = collectBlocks(tts).join(' ');

      expect(combined).toContain('Body text here');
      expect(combined).not.toContain('Namespaced footnote');
    });

    it('should not read endnote, note, or rearnote asides', () => {
      for (const type of ['endnote', 'note', 'rearnote']) {
        const doc = createHTMLDoc(
          '<p>Visible paragraph.</p>' +
            `<aside epub:type="${type}"><p>Hidden ${type} text.</p></aside>`,
        );
        const tts = new TTS(doc, textWalker, ttsNodeFilter, highlight, 'word');
        const combined = collectBlocks(tts).join(' ');

        expect(combined).toContain('Visible paragraph');
        expect(combined).not.toContain(`Hidden ${type} text`);
      }
    });

    it('should not read elements with the epubtype-footnote class', () => {
      const doc = createHTMLDoc(
        '<p>Chapter body.</p>' +
          '<aside class="epubtype-footnote" epub:type="footnote">' +
          '<p>Transformed footnote.</p></aside>',
      );
      const tts = new TTS(doc, textWalker, ttsNodeFilter, highlight, 'word');
      const combined = collectBlocks(tts).join(' ');

      expect(combined).toContain('Chapter body');
      expect(combined).not.toContain('Transformed footnote');
    });

    it('should not read duokan footnote content', () => {
      const doc = createHTMLDoc(
        '<p>Real text.</p>' + '<div class="duokan-footnote-content"><p>Duokan footnote.</p></div>',
      );
      const tts = new TTS(doc, textWalker, ttsNodeFilter, highlight, 'word');
      const combined = collectBlocks(tts).join(' ');

      expect(combined).toContain('Real text');
      expect(combined).not.toContain('Duokan footnote');
    });

    it('should not leak footnote text into the preceding block', () => {
      const doc = createHTMLDoc(
        '<p>Paragraph before footnote.</p>' +
          '<aside epub:type="footnote"><p>Inline footnote text.</p></aside>' +
          '<p>Paragraph after footnote.</p>',
      );
      const tts = new TTS(doc, textWalker, ttsNodeFilter, highlight, 'word');
      const blocks = collectBlocks(tts);

      expect(blocks.some((b) => b.includes('Paragraph before footnote'))).toBe(true);
      expect(blocks.some((b) => b.includes('Paragraph after footnote'))).toBe(true);
      for (const block of blocks) {
        expect(block).not.toContain('Inline footnote text');
      }
    });

    it('should still read non-footnote aside elements', () => {
      const doc = createHTMLDoc(
        '<p>Main content.</p>' + '<aside epub:type="sidebar"><p>Sidebar content stays.</p></aside>',
      );
      const tts = new TTS(doc, textWalker, ttsNodeFilter, highlight, 'word');
      const combined = collectBlocks(tts).join(' ');

      expect(combined).toContain('Main content');
      expect(combined).toContain('Sidebar content stays');
    });

    it('should keep reading footnote text when no node filter is given', () => {
      // getBlocks only skips a block when the filter rejects it; without a
      // filter, behaviour is unchanged (footnote handling lives in the filter).
      const doc = createHTMLDoc(
        '<p>Body paragraph.</p>' +
          '<aside epub:type="footnote"><p>Unfiltered footnote.</p></aside>',
      );
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const combined = collectBlocks(tts).join(' ');

      expect(combined).toContain('Body paragraph');
      expect(combined).toContain('Unfiltered footnote');
    });
  });

  describe('createRejectFilter attributeTokens', () => {
    it('should reject an element whose attribute value contains a token', () => {
      const aside = document.createElement('aside');
      aside.setAttribute('epub:type', 'footnote');
      expect(ttsNodeFilter(aside)).toBe(NodeFilter.FILTER_REJECT);
    });

    it('should match a single token within a space-separated value', () => {
      const aside = document.createElement('aside');
      aside.setAttribute('epub:type', 'bodymatter rearnote');
      expect(ttsNodeFilter(aside)).toBe(NodeFilter.FILTER_REJECT);
    });

    it('should not reject when no token matches', () => {
      const aside = document.createElement('aside');
      aside.setAttribute('epub:type', 'sidebar');
      expect(ttsNodeFilter(aside)).toBe(NodeFilter.FILTER_SKIP);
    });

    it('should not reject when the tag does not match', () => {
      const section = document.createElement('section');
      section.setAttribute('epub:type', 'footnote');
      expect(ttsNodeFilter(section)).toBe(NodeFilter.FILTER_SKIP);
    });

    it('should not reject an element missing the attribute', () => {
      const aside = document.createElement('aside');
      expect(ttsNodeFilter(aside)).toBe(NodeFilter.FILTER_SKIP);
    });
  });

  describe('SSML output correctness', () => {
    it('should produce valid SSML with speak root element', () => {
      const doc = createHTMLDoc('<p>Test content</p>', { lang: 'en' });
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(ssml).toContain('<speak');
      expect(ssml).toContain('</speak>');
    });

    it('should include mark elements in SSML output', () => {
      const doc = createHTMLDoc('<p>Some text with words</p>', { lang: 'en' });
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(ssml).toContain('<mark');
    });
  });
});
