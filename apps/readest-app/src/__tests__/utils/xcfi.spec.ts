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
      expect(xpointer.pos0).toBe(pos0);
      expect(xpointer.pos1).toBe(pos1);
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
});
