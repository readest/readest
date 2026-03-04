import { describe, it, expect, vi, beforeAll } from 'vitest';
import { textWalker } from 'foliate-js/text-walker.js';
import { TTS } from 'foliate-js/tts.js';

beforeAll(() => {
  if (typeof CSS === 'undefined' || !CSS.escape) {
    Object.defineProperty(globalThis, 'CSS', {
      value: {
        escape: (s: string) => s.replace(/([^\w-])/g, '\\$1'),
      },
      writable: true,
    });
  }
});

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
