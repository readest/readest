import { describe, it, expect, vi } from 'vitest';
import { PageProgress } from 'foliate-js/progress.js';

const createHTML = (html: string): Document => {
  const parser = new DOMParser();
  return parser.parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');
};

const makeBook = (sections: { html: string }[]) => ({
  sections: sections.map(({ html }) => ({
    createDocument: () => Promise.resolve(createHTML(html)),
  })),
});

describe('PageProgress', () => {
  describe('getProgress', () => {
    it('should return fraction 0 when anchor targets the start of a section', async () => {
      const book = makeBook([{ html: '<p>Hello world</p>' }]);
      const resolveNavigation = () => ({
        index: 0,
        anchor: (doc: Document) => {
          const text = doc.body.querySelector('p')!.firstChild!;
          const range = doc.createRange();
          range.setStart(text, 0);
          range.setEnd(text, 0);
          return range;
        },
      });

      const pp = new PageProgress(book, resolveNavigation);
      const result = await pp.getProgress('cfi-start');
      expect(result).not.toBeNull();
      expect(result!.fraction).toBe(0);
      expect(result!.index).toBe(0);
    });

    it('should return fraction 1 when anchor targets the end of a section', async () => {
      const book = makeBook([{ html: '<p>Hello world</p>' }]);
      const resolveNavigation = () => ({
        index: 0,
        anchor: (doc: Document) => {
          const text = doc.body.querySelector('p')!.firstChild!;
          const range = doc.createRange();
          range.setStart(text, text.textContent!.length);
          range.setEnd(text, text.textContent!.length);
          return range;
        },
      });

      const pp = new PageProgress(book, resolveNavigation);
      const result = await pp.getProgress('cfi-end');
      expect(result).not.toBeNull();
      expect(result!.fraction).toBe(1);
      expect(result!.index).toBe(0);
    });

    it('should return correct fraction for a midpoint in a section', async () => {
      const book = makeBook([{ html: '<p>abcdefghij</p>' }]);
      const resolveNavigation = () => ({
        index: 0,
        anchor: (doc: Document) => {
          const text = doc.body.querySelector('p')!.firstChild!;
          const range = doc.createRange();
          range.setStart(text, 5);
          range.setEnd(text, 5);
          return range;
        },
      });

      const pp = new PageProgress(book, resolveNavigation);
      const result = await pp.getProgress('cfi-mid');
      expect(result).not.toBeNull();
      expect(result!.fraction).toBe(0.5);
      expect(result!.index).toBe(0);
    });

    it('should handle multiple text nodes across elements', async () => {
      const book = makeBook([{ html: '<p>aaaa</p><p>bbbb</p><p>cccc</p>' }]);
      const resolveNavigation = () => ({
        index: 0,
        anchor: (doc: Document) => {
          // target start of second <p>, which is at offset 4 of 12 total chars
          const text = doc.body.querySelectorAll('p')[1]!.firstChild!;
          const range = doc.createRange();
          range.setStart(text, 0);
          range.setEnd(text, 0);
          return range;
        },
      });

      const pp = new PageProgress(book, resolveNavigation);
      const result = await pp.getProgress('cfi-multi');
      expect(result).not.toBeNull();
      expect(result!.fraction).toBeCloseTo(4 / 12);
      expect(result!.index).toBe(0);
    });

    it('should handle anchor returning an Element instead of a Range', async () => {
      const book = makeBook([{ html: '<p>first</p><p id="target">second</p><p>third</p>' }]);
      const resolveNavigation = () => ({
        index: 0,
        anchor: (doc: Document) => doc.getElementById('target')!,
      });

      const pp = new PageProgress(book, resolveNavigation);
      const result = await pp.getProgress('cfi-element');
      expect(result).not.toBeNull();
      // "first" is 5 chars, "second" starts at offset 5 of 16 total
      expect(result!.fraction).toBeCloseTo(5 / 16);
      expect(result!.index).toBe(0);
    });

    it('should return correct index for non-zero section', async () => {
      const book = makeBook([
        { html: '<p>chapter one</p>' },
        { html: '<p>chapter two content</p>' },
      ]);
      const resolveNavigation = () => ({
        index: 1,
        anchor: (doc: Document) => {
          const text = doc.body.querySelector('p')!.firstChild!;
          const range = doc.createRange();
          range.setStart(text, 0);
          range.setEnd(text, 0);
          return range;
        },
      });

      const pp = new PageProgress(book, resolveNavigation);
      const result = await pp.getProgress('cfi-section1');
      expect(result).not.toBeNull();
      expect(result!.fraction).toBe(0);
      expect(result!.index).toBe(1);
    });

    it('should return null when resolveNavigation returns no index', async () => {
      const book = makeBook([{ html: '<p>text</p>' }]);
      const resolveNavigation = (): { index: undefined; anchor: undefined } => ({
        index: undefined,
        anchor: undefined,
      });

      const pp = new PageProgress(book, resolveNavigation);
      const result = await pp.getProgress('bad-cfi');
      expect(result).toBeNull();
    });

    it('should return null when resolveNavigation returns no anchor', async () => {
      const book = makeBook([{ html: '<p>text</p>' }]);
      const resolveNavigation = (): { index: number; anchor: undefined } => ({
        index: 0,
        anchor: undefined,
      });

      const pp = new PageProgress(book, resolveNavigation);
      const result = await pp.getProgress('no-anchor');
      expect(result).toBeNull();
    });

    it('should return null when section has no createDocument', async () => {
      const book = { sections: [{}] };
      const resolveNavigation = () => ({
        index: 0,
        anchor: () => null,
      });

      const pp = new PageProgress(book, resolveNavigation);
      const result = await pp.getProgress('no-doc');
      expect(result).toBeNull();
    });

    it('should return fraction 0 for an empty document', async () => {
      const book = makeBook([{ html: '' }]);
      const resolveNavigation = () => ({
        index: 0,
        anchor: (doc: Document) => {
          const range = doc.createRange();
          range.selectNodeContents(doc.body);
          return range;
        },
      });

      const pp = new PageProgress(book, resolveNavigation);
      const result = await pp.getProgress('cfi-empty');
      expect(result).not.toBeNull();
      expect(result!.fraction).toBe(0);
    });

    it('should return null and log error when resolveNavigation throws', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const book = makeBook([{ html: '<p>text</p>' }]);
      const resolveNavigation = () => {
        throw new Error('bad cfi');
      };

      const pp = new PageProgress(book, resolveNavigation);
      const result = await pp.getProgress('invalid');
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle nested elements correctly', async () => {
      const book = makeBook([{ html: '<div><span>ab</span><em>cd</em></div><p>ef</p>' }]);
      const resolveNavigation = () => ({
        index: 0,
        anchor: (doc: Document) => {
          // target the <em> text node "cd" at offset 0, which is at char 2 of 6
          const text = doc.body.querySelector('em')!.firstChild!;
          const range = doc.createRange();
          range.setStart(text, 0);
          range.setEnd(text, 2);
          return range;
        },
      });

      const pp = new PageProgress(book, resolveNavigation);
      const result = await pp.getProgress('cfi-nested');
      expect(result).not.toBeNull();
      expect(result!.fraction).toBeCloseTo(2 / 6);
    });
  });
});
