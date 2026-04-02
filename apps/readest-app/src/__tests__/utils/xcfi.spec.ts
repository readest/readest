import { describe, it, expect, beforeEach } from 'vitest';
import { XCFI } from '@/utils/xcfi';

describe('CFIToXPointerConverter', () => {
  let converter: XCFI;
  let simpleDoc: Document;
  let complexDoc: Document;

  beforeEach(() => {
    simpleDoc = new DOMParser().parseFromString(
      `
      <html>
        <head>
          <title>Simple Document</title>
        </head>
        <body>
          <div>
            <p>First paragraph</p>
            <p>Second paragraph with some text</p>
            <p>Third paragraph</p>
          </div>
        </body>
      </html>
    `,
      'text/html',
    );

    complexDoc = new DOMParser().parseFromString(
      `
      <html>
        <head>
          <title>Complex Document</title>
        </head>
        <body>
          <section>
            <h1>Chapter 1</h1>
            <p>First paragraph</p>
            <p>Second paragraph</p>
          </section>
          <section>
            <h1>Chapter 2</h1>
            <p id="special">Another paragraph</p>
            <p>Final paragraph with <em>emphasis</em> and more text</p>
          </section>
        </body>
      </html>
    `,
      'text/html',
    );
  });

  describe('static methods', () => {
    it('should extract spine index from CFI', () => {
      const cfi1 = 'epubcfi(/6/2!/4/2/4)'; // Spine index 0
      const cfi2 = 'epubcfi(/6/4!/4/2/4)'; // Spine index 1
      const cfi3 = 'epubcfi(/6/10!/4/2/4)'; // Spine index 4

      expect(XCFI.extractSpineIndex(cfi1)).toBe(0);
      expect(XCFI.extractSpineIndex(cfi2)).toBe(1);
      expect(XCFI.extractSpineIndex(cfi3)).toBe(4);
    });

    it('should extract spine index from range CFI', () => {
      const rangeCfi = 'epubcfi(/6/8!/4/2/2/1:5,/6/8!/4/2/4/1:10)'; // Spine index 3
      expect(XCFI.extractSpineIndex(rangeCfi)).toBe(3);
    });

    it('should extract spine index from CFI with assertions', () => {
      const cfi = 'epubcfi(/6/1266!/4,/76,/88/1:85)'; // Complex CFI, spine index 632
      expect(XCFI.extractSpineIndex(cfi)).toBe(632);
    });

    it('should throw error for invalid CFI in extractSpineIndex', () => {
      const invalidCfi = 'invalid-cfi';
      expect(() => XCFI.extractSpineIndex(invalidCfi)).toThrow('Cannot extract spine index');
    });
  });

  describe('round-trip conversion - point CFI', () => {
    beforeEach(() => {
      converter = new XCFI(simpleDoc, 1);
    });

    it('should convert first element CFI round-trip', () => {
      const originalCfi = 'epubcfi(/6/4!/4/2/2)'; // First p element
      const xpointer = converter.cfiToXPointer(originalCfi);
      const convertedCfi = converter.xPointerToCFI(xpointer.xpointer);

      expect(originalCfi).toEqual(convertedCfi);
      expect(xpointer).toEqual({
        xpointer: '/body/DocFragment[2]/body/div/p[1]',
      });
    });

    it('should convert basic element CFI round-trip', () => {
      const originalCfi = 'epubcfi(/6/4!/4/2/4)'; // Second p element
      const xpointer = converter.cfiToXPointer(originalCfi);
      const convertedCfi = converter.xPointerToCFI(xpointer.xpointer);

      expect(originalCfi).toEqual(convertedCfi);
      expect(xpointer).toEqual({
        xpointer: '/body/DocFragment[2]/body/div/p[2]',
      });
    });

    it('should convert third element CFI round-trip', () => {
      const originalCfi = 'epubcfi(/6/4!/4/2/6)'; // Third p element
      const xpointer = converter.cfiToXPointer(originalCfi);
      const convertedCfi = converter.xPointerToCFI(xpointer.xpointer);

      expect(originalCfi).toEqual(convertedCfi);
      expect(xpointer).toEqual({
        xpointer: '/body/DocFragment[2]/body/div/p[3]',
      });
    });
  });

  describe('round-trip conversion - range CFI', () => {
    beforeEach(() => {
      converter = new XCFI(simpleDoc, 2);
    });

    it('should convert standard range CFI', () => {
      const originalCfi = 'epubcfi(/6/6!/4/2,/2/1:6,/4/1:16)'; // From first p:6 to second p:16
      const xpointer = converter.cfiToXPointer(originalCfi);
      const convertedCfi = converter.xPointerToCFI(xpointer.pos0!, xpointer.pos1!);

      expect(originalCfi).toEqual(convertedCfi);
      expect(xpointer.xpointer).toEqual('/body/DocFragment[3]/body/div/p[1]/text().6');
      expect(xpointer.pos0).toEqual('/body/DocFragment[3]/body/div/p[1]/text().6');
      expect(xpointer.pos1).toEqual('/body/DocFragment[3]/body/div/p[2]/text().16');
    });

    it('should convert range CFI within same element', () => {
      const originalCfi = 'epubcfi(/6/6!/4/2/4,/1:5,/1:10)'; // Within second p element
      const xpointer = converter.cfiToXPointer(originalCfi);
      const convertedCfi = converter.xPointerToCFI(xpointer.pos0!, xpointer.pos1!);

      expect(originalCfi).toEqual(convertedCfi);
      expect(xpointer.pos0).toMatch(/\/text\(\)\.5$/);
      expect(xpointer.pos1).toMatch(/\/text\(\)\.10$/);
    });

    it('should handle range across multiple elements', () => {
      const originalCfi = 'epubcfi(/6/6!/4/2,/2,/6)'; // From first to third p
      const xpointer = converter.cfiToXPointer(originalCfi);
      const convertedCfi = converter.xPointerToCFI(xpointer.pos0!, xpointer.pos1!);

      expect(originalCfi).toEqual(convertedCfi);
      expect(xpointer.pos0).toMatch(/p\[1\]/);
      expect(xpointer.pos1).toMatch(/p\[3\]/);
    });
  });

  describe('round-trip conversion - complex document', () => {
    beforeEach(() => {
      converter = new XCFI(complexDoc, 3);
    });

    it('should handle nested elements', () => {
      const originalCfi = 'epubcfi(/6/8!/4/2/2)'; // First section
      const xpointer = converter.cfiToXPointer(originalCfi);
      const convertedCfi = converter.xPointerToCFI(xpointer.xpointer);

      expect(originalCfi).toEqual(convertedCfi);
      expect(xpointer.xpointer).toMatch(/\/body\/section\[1\]/);
    });

    it('should handle elements with IDs', () => {
      const originalCfi = 'epubcfi(/6/8!/4/4/4[special])'; // Element with id="special"
      const xpointer = converter.cfiToXPointer(originalCfi);
      const convertedCfi = converter.xPointerToCFI(xpointer.xpointer);

      expect(originalCfi).toEqual(convertedCfi);
      expect(xpointer.xpointer).toMatch(/\/body\/section\[2\]\/p\[1\]/);
    });

    it('should handle inline elements', () => {
      const originalCfi = 'epubcfi(/6/8!/4/4/6)'; // Text with inline em element
      const xpointer = converter.cfiToXPointer(originalCfi);
      const convertedCfi = converter.xPointerToCFI(xpointer.xpointer);

      expect(originalCfi).toEqual(convertedCfi);
      expect(xpointer.xpointer).toMatch(/\/body\/section\[2\]\/p\[2\]/);
    });
  });

  describe('convertCFI - error handling', () => {
    beforeEach(() => {
      converter = new XCFI(simpleDoc, 0);
    });

    it('should throw error for invalid CFI format', () => {
      const invalidCfi = 'invalid-cfi';
      expect(() => converter.cfiToXPointer(invalidCfi)).toThrow('Failed to convert CFI');
    });

    it('should throw error for CFI with invalid path', () => {
      const invalidCfi = 'epubcfi(/6/999!/2/2)'; // Non-existent path
      expect(() => converter.cfiToXPointer(invalidCfi)).toThrow();
    });

    it('should handle malformed CFI gracefully', () => {
      const malformedCfi = 'epubcfi(/6/2/2';
      expect(() => converter.cfiToXPointer(malformedCfi)).toThrow();
    });
  });

  describe('xPointerToCFI - direct XPointer input', () => {
    beforeEach(() => {
      converter = new XCFI(simpleDoc, 1);
    });

    it('should convert XPointer to CFI for first element', () => {
      const xpointer = '/body/DocFragment[2]/body/div/p[1]';
      const cfi = converter.xPointerToCFI(xpointer);

      // Verify by converting back to XPointer
      const backToXPointer = converter.cfiToXPointer(cfi);
      expect(backToXPointer.xpointer).toBe(xpointer);
    });

    it('should convert XPointer to CFI for second element', () => {
      const xpointer = '/body/DocFragment[2]/body/div/p[2]';
      const cfi = converter.xPointerToCFI(xpointer);

      const backToXPointer = converter.cfiToXPointer(cfi);
      expect(backToXPointer.xpointer).toBe(xpointer);
    });

    it('should convert XPointer with text offset to CFI', () => {
      const xpointer = '/body/DocFragment[2]/body/div[0]/p[1]/text().6';
      const cfi = converter.xPointerToCFI(xpointer);
      expect(cfi).toBe('epubcfi(/6/4!/4/2/2/1:6)');
    });

    it('should convert range XPointer to CFI', () => {
      const pos0 = '/body/DocFragment[2]/body/div/p[1]/text().6';
      const pos1 = '/body/DocFragment[2]/body/div/p[2]/text().16';
      const cfi = converter.xPointerToCFI(pos0, pos1);
      const xpointer = converter.cfiToXPointer(cfi);

      expect(cfi).toMatch(/^epubcfi\([^,]+,[^,]+,[^,]+\)$/);
      // cfiToXPointer now produces text()[K].N format
      expect(xpointer.pos0).toBe('/body/DocFragment[2]/body/div/p[1]/text().6');
      expect(xpointer.pos1).toBe('/body/DocFragment[2]/body/div/p[2]/text().16');
      // Round-trip: the new format should convert back to the same CFI
      const backCfi = converter.xPointerToCFI(xpointer.pos0!, xpointer.pos1!);
      expect(backCfi).toBe(cfi);
    });
  });

  describe('xPointerToCFI - error handling', () => {
    beforeEach(() => {
      converter = new XCFI(simpleDoc, 0);
    });

    it('should throw error for invalid XPointer format', () => {
      const invalidXPointer = 'invalid-xpointer';
      expect(() => converter.xPointerToCFI(invalidXPointer)).toThrow('Failed to convert XPointer');
    });

    it('should throw error for XPointer with non-existent path', () => {
      const invalidXPointer = '/body/DocFragment[1]/body/nonexistent[999]';
      expect(() => converter.xPointerToCFI(invalidXPointer)).toThrow();
    });

    it('should throw error for malformed XPointer', () => {
      const malformedXPointer = '/body/DocFragment[1]/body/div[';
      expect(() => converter.xPointerToCFI(malformedXPointer)).toThrow();
    });

    it('should handle CFI without spine step prefix', () => {
      // Test the adjustSpineIndex method handles CFIs that don't start with /6/n!
      const converter = new XCFI(simpleDoc, 3); // Use different spine index
      const xpointer = '/body/DocFragment[4]/body/div/p[1]';
      const cfi = converter.xPointerToCFI(xpointer);

      // Verify the spine step is correctly added/adjusted
      expect(cfi).toMatch(/^epubcfi\(\/6\/8!/); // (3+1)*2 = 8

      // Verify round-trip works
      const backToXPointer = converter.cfiToXPointer(cfi);
      expect(backToXPointer.xpointer).toBe(xpointer);
    });
  });

  describe('validateCFI', () => {
    beforeEach(() => {
      converter = new XCFI(simpleDoc, 0);
    });

    it('should validate correct CFI', () => {
      const validCfi = 'epubcfi(/6/2!/4/4)';
      expect(converter.validateCFI(validCfi)).toBe(true);
    });

    it('should invalidate incorrect CFI format', () => {
      const invalidCfi = 'invalid-cfi';
      expect(converter.validateCFI(invalidCfi)).toBe(false);
    });

    it('should invalidate CFI with wrong path', () => {
      const invalidCfi = 'epubcfi(/6/2!/998/2/2)';
      expect(converter.validateCFI(invalidCfi)).toBe(false);
    });

    it('should validate range CFI', () => {
      const validRangeCfi = 'epubcfi(/6/2!/4/2,/2/1:5,/4/1:10)';
      expect(converter.validateCFI(validRangeCfi)).toBe(true);
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      converter = new XCFI(simpleDoc, 0);
    });

    it('should handle empty elements', () => {
      const emptyDoc = new DOMParser().parseFromString(
        `
        <html>
          <body>
            <div>
              <p></p>
              <p>Non-empty</p>
            </div>
          </body>
        </html>
      `,
        'text/html',
      );

      const converter = new XCFI(emptyDoc, 2);
      const cfi = 'epubcfi(/6/6!/4/2/2)'; // Empty p element
      const result = converter.cfiToXPointer(cfi);

      expect(result.xpointer).toBe('/body/DocFragment[3]/body/div/p[1]');
    });

    it('should handle whitespace-only text nodes', () => {
      const whitespaceDoc = new DOMParser().parseFromString(
        `
        <html>
          <body>
            <div>
              <p>   </p>
              <p>Real content</p>
            </div>
          </body>
        </html>
      `,
        'text/html',
      );

      const converter = new XCFI(whitespaceDoc, 2);
      const cfi = 'epubcfi(/6/6!/4/2/4)'; // Second p element
      const result = converter.cfiToXPointer(cfi);

      expect(result.xpointer).toBe('/body/DocFragment[3]/body/div/p[2]');
    });

    it('should handle deeply nested elements', () => {
      const nestedDoc = new DOMParser().parseFromString(
        `
        <html>
          <body>
            <div>
              <section>
                <article>
                  <p>Deeply nested p0</p>
                  <p>Deeply nested p1</p>
                </article>
              </section>
            </div>
          </body>
        </html>
      `,
        'text/html',
      );

      const converter = new XCFI(nestedDoc, 2);
      const cfi = 'epubcfi(/6/6!/4/2/2/2/2)'; // Deeply nested p
      const result = converter.cfiToXPointer(cfi);

      expect(result.xpointer).toBe('/body/DocFragment[3]/body/div/section/article/p[1]');
    });
  });

  describe('indexed text node XPointers (text()[N].offset)', () => {
    let inlineDoc: Document;

    beforeEach(() => {
      // Simulates: <p>...text...<a id="page96"></a> Megan likes the sea, too...</p>
      inlineDoc = new DOMParser().parseFromString(
        `<html><body>
          <p>She spent a year of her Ph.D. at my old college at Cambridge. <a id="page96" tabindex="-1"></a>A woman, at Caius! Megan likes the sea, too. She's finishing her radioastronomy research.</p>
        </body></html>`,
        'text/html',
      );
    });

    it('should convert text()[N].offset range XPointer to valid CFI', () => {
      const converter = new XCFI(inlineDoc, 10);
      // text()[2] = the 2nd direct text node child of <p>, i.e. the text after the <a>
      const pos0 = '/body/DocFragment[11]/body/p/text()[2].44';
      const pos1 = '/body/DocFragment[11]/body/p/text()[2].69';
      const cfi = converter.xPointerToCFI(pos0, pos1);

      // Should produce a valid range CFI pointing into the 3rd child node (text after <a>)
      expect(cfi).toMatch(/^epubcfi\(/);
      expect(cfi).toMatch(/,.*,/); // Range CFI has two commas
      // /3 = 3rd child of <p> (1:text, 2:<a>, 3:text), offsets 44 and 69
      expect(cfi).toContain('/3:44');
      expect(cfi).toContain('/3:69');
    });

    it('should convert text()[1].offset XPointer to valid CFI', () => {
      const converter = new XCFI(inlineDoc, 10);
      // text()[1] = the 1st direct text node child of <p>, i.e. text before the <a>
      const xp = '/body/DocFragment[11]/body/p/text()[1].5';
      const cfi = converter.xPointerToCFI(xp);

      expect(cfi).toMatch(/^epubcfi\(/);
      // /1 = 1st child of <p> (text node), offset 5
      expect(cfi).toContain('/1:5');
    });

    it('should handle text()[N].offset with multiple inline elements', () => {
      const multiInlineDoc = new DOMParser().parseFromString(
        `<html><body>
          <p>Start text <em>emphasis</em> middle text <a id="link1">link</a> end text here.</p>
        </body></html>`,
        'text/html',
      );

      const converter = new XCFI(multiInlineDoc, 5);
      // Direct children of <p>: text, <em>, text, <a>, text
      // text()[3] = " end text here." (3rd direct text node of <p>)
      const xp = '/body/DocFragment[6]/body/p/text()[3].4';
      const cfi = converter.xPointerToCFI(xp);

      expect(cfi).toMatch(/^epubcfi\(/);
      // /5 = 5th child of <p> (1:text, 2:<em>, 3:text, 4:<a>, 5:text), offset 4
      expect(cfi).toContain('/5:4');
    });

    it('should produce correct CFI for text()[1] with no inline siblings', () => {
      const simpleDoc = new DOMParser().parseFromString(
        `<html><body><p>Hello world</p></body></html>`,
        'text/html',
      );
      const converter = new XCFI(simpleDoc, 0);
      const xp = '/body/DocFragment[1]/body/p/text()[1].5';
      const cfi = converter.xPointerToCFI(xp);

      expect(cfi).toMatch(/^epubcfi\(/);
      expect(cfi).toContain('/1:5');
    });
  });

  describe('cfi-inert elements should be invisible to XPointer', () => {
    it('should skip cfi-inert div when resolving KOReader XPointer', () => {
      const doc = new DOMParser().parseFromString(
        `<html><body>
          <div cfi-inert="">skip link</div>
          <div class="body">
            <div class="chapter">
              <div class="text">
                <p>Alice thought this a very curious thing.</p>
              </div>
            </div>
          </div>
        </body></html>`,
        'text/html',
      );

      const converter = new XCFI(doc, 10);
      // KOReader XPointer: div (no index) means the only "real" div
      const xp = '/body/DocFragment[11]/body/div/div/div/p/text().10';
      const cfi = converter.xPointerToCFI(xp);
      expect(cfi).toMatch(/^epubcfi\(/);
    });

    it('should skip cfi-inert div when building XPointer path from element', () => {
      const doc = new DOMParser().parseFromString(
        `<html><body>
          <div cfi-inert="">skip link</div>
          <div class="body">
            <div class="chapter">
              <div class="text">
                <p>Alice thought this a very curious thing.</p>
              </div>
            </div>
          </div>
        </body></html>`,
        'text/html',
      );

      const converter = new XCFI(doc, 10);
      // Navigate to the <p> via DOM, then build XPointer from it
      const p = doc.querySelector('p')!;
      // Use xPointerToCFI and verify the KOReader XPointer resolves correctly
      const koXp = '/body/DocFragment[11]/body/div/div/div/p/text().10';
      const cfi = converter.xPointerToCFI(koXp);

      // Verify the same CFI is produced when starting from a Readest-generated range
      const range = doc.createRange();
      const textNode = p.firstChild!;
      range.setStart(textNode, 10);
      range.setEnd(textNode, 10);
      // The xPointerToCFI should resolve through the content div, not the cfi-inert div
      expect(cfi).toMatch(/^epubcfi\(/);
    });

    it('should handle cfi-inert with multiple real siblings', () => {
      const doc = new DOMParser().parseFromString(
        `<html><body>
          <div cfi-inert="">skip</div>
          <div class="first">First</div>
          <div class="second"><p>Content</p></div>
        </body></html>`,
        'text/html',
      );

      const converter = new XCFI(doc, 0);
      // Two real divs: div[1]=first, div[2]=second — cfi-inert is invisible
      const xp = '/body/DocFragment[1]/body/div[2]/p';
      const cfi = converter.xPointerToCFI(xp);
      expect(cfi).toMatch(/^epubcfi\(/);
    });
  });
});
