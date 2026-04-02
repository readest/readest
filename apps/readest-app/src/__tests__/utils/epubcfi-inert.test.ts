import { describe, it, expect } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';

const XHTML = (str: string) => new DOMParser().parseFromString(str, 'application/xhtml+xml');

// A standard page without any inert elements
const basePage = () =>
  XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body id="body01">
    <p>First paragraph</p>
    <p>Second paragraph</p>
    <p>Third paragraph</p>
    <p>Fourth paragraph</p>
    <p id="para05">xxx<em>yyy</em>0123456789</p>
    <p>Sixth paragraph</p>
    <p>Seventh paragraph</p>
    <img id="svgimg" src="foo.svg" alt="an image"/>
    <p>Ninth paragraph</p>
    <p>Tenth paragraph</p>
  </body>
</html>`);

// The same page with a cfi-inert element prepended to body
const pageWithInertAtStart = () =>
  XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body id="body01">
    <div cfi-inert="" aria-hidden="true" id="skip-link" tabindex="0">Skip to reading position</div>
    <p>First paragraph</p>
    <p>Second paragraph</p>
    <p>Third paragraph</p>
    <p>Fourth paragraph</p>
    <p id="para05">xxx<em>yyy</em>0123456789</p>
    <p>Sixth paragraph</p>
    <p>Seventh paragraph</p>
    <img id="svgimg" src="foo.svg" alt="an image"/>
    <p>Ninth paragraph</p>
    <p>Tenth paragraph</p>
  </body>
</html>`);

// Page with multiple inert elements scattered throughout
const pageWithMultipleInerts = () =>
  XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body id="body01">
    <div cfi-inert="" aria-hidden="true">Skip link 1</div>
    <p>First paragraph</p>
    <p>Second paragraph</p>
    <span cfi-inert="" aria-hidden="true">Another skip</span>
    <p>Third paragraph</p>
    <p>Fourth paragraph</p>
    <p id="para05">xxx<em>yyy</em>0123456789</p>
    <p>Sixth paragraph</p>
    <p>Seventh paragraph</p>
    <div cfi-inert="" aria-hidden="true">Yet another skip</div>
    <img id="svgimg" src="foo.svg" alt="an image"/>
    <p>Ninth paragraph</p>
    <p>Tenth paragraph</p>
  </body>
</html>`);

// Page with inert element at the end
const pageWithInertAtEnd = () =>
  XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body id="body01">
    <p>First paragraph</p>
    <p>Second paragraph</p>
    <p>Third paragraph</p>
    <p>Fourth paragraph</p>
    <p id="para05">xxx<em>yyy</em>0123456789</p>
    <p>Sixth paragraph</p>
    <p>Seventh paragraph</p>
    <img id="svgimg" src="foo.svg" alt="an image"/>
    <p>Ninth paragraph</p>
    <p>Tenth paragraph</p>
    <div cfi-inert="" aria-hidden="true">Inert at end</div>
  </body>
</html>`);

// Page with inert element containing nested content
const pageWithNestedInert = () =>
  XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body id="body01">
    <div cfi-inert="" aria-hidden="true">
      <span>Nested span</span>
      <p>Nested paragraph</p>
      <div>Deeply <strong>nested</strong> content</div>
    </div>
    <p>First paragraph</p>
    <p>Second paragraph</p>
    <p>Third paragraph</p>
    <p>Fourth paragraph</p>
    <p id="para05">xxx<em>yyy</em>0123456789</p>
    <p>Sixth paragraph</p>
    <p>Seventh paragraph</p>
    <img id="svgimg" src="foo.svg" alt="an image"/>
    <p>Ninth paragraph</p>
    <p>Tenth paragraph</p>
  </body>
</html>`);

// Page with inert element that also has classes
const pageWithInertAndClasses = () =>
  XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body id="body01">
    <div class="some-class another-class" cfi-inert="" aria-hidden="true">Skip link</div>
    <p>First paragraph</p>
    <p>Second paragraph</p>
    <p>Third paragraph</p>
    <p>Fourth paragraph</p>
    <p id="para05">xxx<em>yyy</em>0123456789</p>
    <p>Sixth paragraph</p>
    <p>Seventh paragraph</p>
    <img id="svgimg" src="foo.svg" alt="an image"/>
    <p>Ninth paragraph</p>
    <p>Tenth paragraph</p>
  </body>
</html>`);

// Standard CFI paths for the base page structure
const standardCFIs = [
  '/4[body01]/10[para05]/3:10',
  '/4[body01]/16[svgimg]',
  '/4[body01]/10[para05]/1:0',
  '/4[body01]/10[para05]/2/1:0',
  '/4[body01]/10[para05]/2/1:3',
];

/**
 * Helper: run round-trip test for a list of CFIs on a given document.
 * fromRange(toRange(cfi)) should yield the same CFI.
 */
function assertRoundTrip(doc: Document, cfis: string[], filter?: (node: Node) => number) {
  for (const cfi of cfis) {
    const range = CFI.toRange(doc, CFI.parse(cfi), filter);
    expect(range).not.toBeNull();
    const result = CFI.fromRange(range!, filter);
    expect(result).toBe(`epubcfi(${cfi})`);
  }
}

/**
 * Helper: verify that range CFIs resolve to the expected text content.
 */
function assertRangeContent(doc: Document, filter?: (node: Node) => number) {
  for (let i = 0; i < 10; i++) {
    const cfi = `/4/10,/3:${i},/3:${i + 1}`;
    const range = CFI.toRange(doc, CFI.parse(cfi), filter);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe(`${i}`);
  }
}

describe('epubcfi cfi-inert element filtering', () => {
  describe('basic round-trip without inert elements (baseline)', () => {
    it('should produce correct CFIs from the base page', () => {
      assertRoundTrip(basePage(), standardCFIs);
    });

    it('should resolve range CFIs to correct text content', () => {
      assertRangeContent(basePage());
    });
  });

  describe('cfi-inert element at start of body', () => {
    it('should produce the same CFIs as the base page', () => {
      assertRoundTrip(pageWithInertAtStart(), standardCFIs);
    });

    it('should resolve range CFIs to correct text content', () => {
      assertRangeContent(pageWithInertAtStart());
    });

    it('should resolve CFI generated from base page', () => {
      // Generate CFI from base page, resolve in page with inert element
      const base = basePage();
      const withInert = pageWithInertAtStart();

      for (const cfi of standardCFIs) {
        const baseRange = CFI.toRange(base, CFI.parse(cfi));
        const inertRange = CFI.toRange(withInert, CFI.parse(cfi));
        expect(baseRange).not.toBeNull();
        expect(inertRange).not.toBeNull();
        // Both should resolve to the same text content
        expect(inertRange!.toString()).toBe(baseRange!.toString());
      }
    });

    it('should generate the same CFI from equivalent ranges', () => {
      const base = basePage();
      const withInert = pageWithInertAtStart();

      // Create a range on paragraph text in both documents
      const basePara = base.getElementById('para05')!;
      const inertPara = withInert.getElementById('para05')!;

      const baseRange = base.createRange();
      baseRange.setStart(basePara.firstChild!, 0);
      baseRange.setEnd(basePara.firstChild!, 3);

      const inertRange = withInert.createRange();
      inertRange.setStart(inertPara.firstChild!, 0);
      inertRange.setEnd(inertPara.firstChild!, 3);

      const baseCFI = CFI.fromRange(baseRange);
      const inertCFI = CFI.fromRange(inertRange);
      expect(baseCFI).toBe(inertCFI);
    });
  });

  describe('multiple inert elements', () => {
    it('should produce the same CFIs as the base page', () => {
      assertRoundTrip(pageWithMultipleInerts(), standardCFIs);
    });

    it('should resolve range CFIs to correct text content', () => {
      assertRangeContent(pageWithMultipleInerts());
    });

    it('should be cross-compatible with base page CFIs', () => {
      const base = basePage();
      const multi = pageWithMultipleInerts();

      for (const cfi of standardCFIs) {
        const baseRange = CFI.toRange(base, CFI.parse(cfi));
        const multiRange = CFI.toRange(multi, CFI.parse(cfi));
        expect(multiRange).not.toBeNull();
        expect(multiRange!.toString()).toBe(baseRange!.toString());
      }
    });
  });

  describe('cfi-inert element at end of body', () => {
    it('should produce the same CFIs as the base page', () => {
      assertRoundTrip(pageWithInertAtEnd(), standardCFIs);
    });

    it('should resolve range CFIs to correct text content', () => {
      assertRangeContent(pageWithInertAtEnd());
    });
  });

  describe('cfi-inert element with nested content', () => {
    it('should produce the same CFIs as the base page', () => {
      assertRoundTrip(pageWithNestedInert(), standardCFIs);
    });

    it('should resolve range CFIs to correct text content', () => {
      assertRangeContent(pageWithNestedInert());
    });

    it('should completely ignore nested content within inert elements', () => {
      const base = basePage();
      const nested = pageWithNestedInert();

      // Generate CFI from base and resolve in nested - content should match
      for (const cfi of standardCFIs) {
        const baseRange = CFI.toRange(base, CFI.parse(cfi));
        const nestedRange = CFI.toRange(nested, CFI.parse(cfi));
        expect(nestedRange).not.toBeNull();
        expect(nestedRange!.toString()).toBe(baseRange!.toString());
      }
    });
  });

  describe('cfi-inert element with additional classes', () => {
    it('should still be filtered when element has cfi-inert attribute and classes', () => {
      assertRoundTrip(pageWithInertAndClasses(), standardCFIs);
    });

    it('should resolve range CFIs to correct text content', () => {
      assertRangeContent(pageWithInertAndClasses());
    });
  });

  describe('cross-document CFI compatibility', () => {
    it('CFIs from base page should resolve correctly in all inert variants', () => {
      const base = basePage();
      const variants = [
        pageWithInertAtStart(),
        pageWithMultipleInerts(),
        pageWithInertAtEnd(),
        pageWithNestedInert(),
        pageWithInertAndClasses(),
      ];

      for (const cfi of standardCFIs) {
        const baseRange = CFI.toRange(base, CFI.parse(cfi));
        expect(baseRange).not.toBeNull();

        for (const variant of variants) {
          const variantRange = CFI.toRange(variant, CFI.parse(cfi));
          expect(variantRange).not.toBeNull();
          expect(variantRange!.toString()).toBe(baseRange!.toString());
        }
      }
    });

    it('CFIs generated from inert variants should resolve in base page', () => {
      const base = basePage();
      const withInert = pageWithInertAtStart();

      for (const cfi of standardCFIs) {
        // Generate from inert page
        const inertRange = CFI.toRange(withInert, CFI.parse(cfi));
        const inertCFI = CFI.fromRange(inertRange!);

        // Resolve in base page
        const baseRange = CFI.toRange(base, CFI.parse(inertCFI));
        expect(baseRange).not.toBeNull();
        expect(baseRange!.toString()).toBe(inertRange!.toString());
      }
    });

    it('CFIs generated from any variant should resolve in any other variant', () => {
      const variants = [
        basePage(),
        pageWithInertAtStart(),
        pageWithMultipleInerts(),
        pageWithInertAtEnd(),
        pageWithNestedInert(),
      ];

      // Use a point CFI to test
      const cfi = '/4[body01]/10[para05]/3:5';
      for (const source of variants) {
        const sourceRange = CFI.toRange(source, CFI.parse(cfi));
        const generatedCFI = CFI.fromRange(sourceRange!);

        for (const target of variants) {
          const targetRange = CFI.toRange(target, CFI.parse(generatedCFI));
          expect(targetRange).not.toBeNull();
          expect(targetRange!.toString()).toBe(sourceRange!.toString());
        }
      }
    });
  });

  describe('CFI compare with inert elements', () => {
    it('should compare identically to base page CFIs', () => {
      const cfiPairs: [string, string, number][] = [
        ['/4[body01]/10[para05]/3:10', '/4[body01]/10[para05]/3:10', 0],
        ['/4[body01]/10[para05]/1:0', '/4[body01]/10[para05]/3:10', -1],
        ['/4[body01]/16[svgimg]', '/4[body01]/10[para05]/3:10', 1],
        ['/4[body01]/10[para05]/2/1:0', '/4[body01]/10[para05]/2/1:3', -1],
        ['/4[body01]/10[para05]/2/1:3', '/4[body01]/10[para05]/2/1:0', 1],
      ];

      for (const [a, b, expected] of cfiPairs) {
        const result = CFI.compare(`epubcfi(${a})`, `epubcfi(${b})`);
        expect(result).toBe(expected);
      }
    });
  });

  describe('fromRange for collapsed ranges', () => {
    it('should produce the same collapsed CFI with and without inert elements', () => {
      const base = basePage();
      const withInert = pageWithInertAtStart();

      const basePara = base.getElementById('para05')!;
      const inertPara = withInert.getElementById('para05')!;

      // Collapsed range at position 5 in the text node after <em>
      const baseRange = base.createRange();
      const baseTextNode = basePara.childNodes[2]!; // "0123456789"
      baseRange.setStart(baseTextNode, 5);
      baseRange.collapse(true);

      const inertRange = withInert.createRange();
      const inertTextNode = inertPara.childNodes[2]!; // "0123456789"
      inertRange.setStart(inertTextNode, 5);
      inertRange.collapse(true);

      expect(CFI.fromRange(baseRange)).toBe(CFI.fromRange(inertRange));
    });
  });

  describe('fromRange for selection ranges', () => {
    it('should produce the same range CFI with and without inert elements', () => {
      const base = basePage();
      const withInert = pageWithInertAtStart();

      const basePara = base.getElementById('para05')!;
      const inertPara = withInert.getElementById('para05')!;

      // Range spanning from "xxx" to within "0123456789"
      const baseRange = base.createRange();
      baseRange.setStart(basePara.firstChild!, 1); // "xxx" at offset 1
      baseRange.setEnd(basePara.childNodes[2]!, 3); // "0123456789" at offset 3

      const inertRange = withInert.createRange();
      inertRange.setStart(inertPara.firstChild!, 1);
      inertRange.setEnd(inertPara.childNodes[2]!, 3);

      expect(CFI.fromRange(baseRange)).toBe(CFI.fromRange(inertRange));
    });

    it('should produce same range CFI spanning across elements', () => {
      const base = basePage();
      const withInert = pageWithInertAtStart();

      const body = base.querySelector('body')!;
      const inertBody = withInert.querySelector('body')!;

      // Get the first and third <p> elements (skip whitespace text nodes)
      const basePs = Array.from(body.querySelectorAll('p'));
      const inertPs = Array.from(inertBody.querySelectorAll('p'));

      const baseRange = base.createRange();
      baseRange.setStart(basePs[0]!.firstChild!, 0);
      baseRange.setEnd(basePs[2]!.firstChild!, 5);

      const inertRange = withInert.createRange();
      inertRange.setStart(inertPs[0]!.firstChild!, 0);
      inertRange.setEnd(inertPs[2]!.firstChild!, 5);

      expect(CFI.fromRange(baseRange)).toBe(CFI.fromRange(inertRange));
    });
  });

  describe('toElement with inert elements', () => {
    it('should resolve to the same element with and without inert elements', () => {
      const base = basePage();
      const withInert = pageWithInertAtStart();

      const parts = CFI.parse('/4[body01]/10[para05]');
      const baseEl = CFI.toElement(base, parts[0]);
      const inertEl = CFI.toElement(withInert, parts[0]);

      expect(baseEl.id).toBe('para05');
      expect(inertEl.id).toBe('para05');
      expect(baseEl.textContent).toBe(inertEl.textContent);
    });

    it('should resolve img element correctly with inert elements', () => {
      const base = basePage();
      const withInert = pageWithInertAtStart();

      const parts = CFI.parse('/4[body01]/16[svgimg]');
      const baseEl = CFI.toElement(base, parts[0]);
      const inertEl = CFI.toElement(withInert, parts[0]);

      expect(baseEl.id).toBe('svgimg');
      expect(inertEl.id).toBe('svgimg');
    });
  });

  describe('interaction with filter callback', () => {
    const filter = (node: Node) => {
      if (node.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
      if ((node as Element).matches('.reject')) return NodeFilter.FILTER_REJECT;
      if ((node as Element).matches('.skip')) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    };

    // Page with both cfi-inert elements AND filter-targeted elements
    const pageWithInertAndFilter = () =>
      XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
      <head><title>Test</title></head>
      <body id="body01">
        <div cfi-inert="" aria-hidden="true">Skip link</div>
        <h1 class="reject">This is ignored!</h1>
        <section class="skip">
          <p class="reject">Also ignored</p>
          <p>First paragraph</p>
          <p>Second paragraph</p>
          <p>Third paragraph</p>
          <p>Fourth paragraph</p>
          <p id="para05">xxx<em>yyy</em><span class="reject">Note</span><span class="skip">0<span class="skip"><span class="reject"></span>123</span></span>45<span class="reject"><img src="icon.svg"/></span>6789</p>
          <p>Sixth paragraph</p>
          <p>Seventh paragraph</p>
          <img id="svgimg" src="foo.svg" alt="an image"/>
          <p>Ninth paragraph</p>
          <p>Tenth paragraph</p>
        </section>
      </body>
    </html>`);

    // Same page with filter targets but NO inert element
    const pageWithFilterOnly = () =>
      XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
      <head><title>Test</title></head>
      <body id="body01">
        <h1 class="reject">This is ignored!</h1>
        <section class="skip">
          <p class="reject">Also ignored</p>
          <p>First paragraph</p>
          <p>Second paragraph</p>
          <p>Third paragraph</p>
          <p>Fourth paragraph</p>
          <p id="para05">xxx<em>yyy</em><span class="reject">Note</span><span class="skip">0<span class="skip"><span class="reject"></span>123</span></span>45<span class="reject"><img src="icon.svg"/></span>6789</p>
          <p>Sixth paragraph</p>
          <p>Seventh paragraph</p>
          <img id="svgimg" src="foo.svg" alt="an image"/>
          <p>Ninth paragraph</p>
          <p>Tenth paragraph</p>
        </section>
      </body>
    </html>`);

    it('should produce same CFIs with filter + inert elements as filter alone', () => {
      const withBoth = pageWithInertAndFilter();
      const filterOnly = pageWithFilterOnly();

      for (const cfi of standardCFIs) {
        const bothRange = CFI.toRange(withBoth, CFI.parse(cfi), filter);
        const filterRange = CFI.toRange(filterOnly, CFI.parse(cfi), filter);
        expect(bothRange).not.toBeNull();
        expect(filterRange).not.toBeNull();

        const bothCFI = CFI.fromRange(bothRange!, filter);
        const filterCFI = CFI.fromRange(filterRange!, filter);
        expect(bothCFI).toBe(filterCFI);
      }
    });

    it('should resolve range content correctly with filter + inert elements', () => {
      const withBoth = pageWithInertAndFilter();

      for (let i = 0; i < 10; i++) {
        const cfi = `/4/10,/3:${i},/3:${i + 1}`;
        const range = CFI.toRange(withBoth, CFI.parse(cfi), filter);
        expect(range).not.toBeNull();
        expect(range!.toString()).toBe(`${i}`);
      }
    });

    it('round-trip should work with filter + inert elements', () => {
      assertRoundTrip(pageWithInertAndFilter(), standardCFIs, filter);
    });
  });

  describe('elements that should NOT be skipped', () => {
    it('should not skip elements without the cfi-inert attribute', () => {
      const page = XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>Test</title></head>
        <body>
          <div class="some-other-class">Not skipped</div>
          <p>Content</p>
        </body>
      </html>`);

      // The div should be counted - /4/2 is the div, /4/4 is the p
      const parts = CFI.parse('/4/2');
      const el = CFI.toElement(page, parts[0]);
      expect(el.textContent).toBe('Not skipped');
    });

    it('should not skip elements with similar but different attribute names', () => {
      const page = XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>Test</title></head>
        <body>
          <div data-cfi-inert="">Prefixed attr - not skipped</div>
          <div cfi-inert-all="">Different attr - not skipped</div>
          <p>Content</p>
        </body>
      </html>`);

      // Both divs should be counted
      const parts = CFI.parse('/4/2');
      const el = CFI.toElement(page, parts[0]);
      expect(el.textContent).toBe('Prefixed attr - not skipped');

      const parts2 = CFI.parse('/4/4');
      const el2 = CFI.toElement(page, parts2[0]);
      expect(el2.textContent).toBe('Different attr - not skipped');
    });
  });

  describe('fromElements with inert elements', () => {
    it('should produce same CFIs for sorted elements with and without inert', () => {
      const base = basePage();
      const withInert = pageWithInertAtStart();

      const baseImgs = Array.from(base.querySelectorAll('img'));
      const inertImgs = Array.from(withInert.querySelectorAll('img'));

      const baseCFIs = CFI.fromElements(baseImgs);
      const inertCFIs = CFI.fromElements(inertImgs);

      expect(baseCFIs).toEqual(inertCFIs);
    });

    it('should produce same CFIs for multiple sorted elements', () => {
      const base = basePage();
      const withInert = pageWithInertAtStart();

      // Get p elements with IDs
      const baseParas = Array.from(base.querySelectorAll('p[id]'));
      const inertParas = Array.from(withInert.querySelectorAll('p[id]'));

      const baseCFIs = CFI.fromElements(baseParas);
      const inertCFIs = CFI.fromElements(inertParas);

      expect(baseCFIs).toEqual(inertCFIs);
    });
  });

  describe('edge case: inert element as only child', () => {
    it('should handle body containing only an inert element and one real element', () => {
      const page = XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>Test</title></head>
        <body>
          <div cfi-inert="" aria-hidden="true">Skip</div>
          <p id="only">Only real content</p>
        </body>
      </html>`);

      const parts = CFI.parse('/4/2[only]');
      const el = CFI.toElement(page, parts[0]);
      expect(el.id).toBe('only');
      expect(el.textContent).toBe('Only real content');
    });
  });

  describe('edge case: adjacent inert elements', () => {
    it('should handle multiple adjacent inert elements', () => {
      const page = XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>Test</title></head>
        <body>
          <div cfi-inert="">Skip 1</div>
          <div cfi-inert="">Skip 2</div>
          <div cfi-inert="">Skip 3</div>
          <p id="first">First</p>
          <p id="second">Second</p>
        </body>
      </html>`);

      // Despite 3 inert elements, /4/2 should be the first <p>
      const parts1 = CFI.parse('/4/2[first]');
      const el1 = CFI.toElement(page, parts1[0]);
      expect(el1.id).toBe('first');

      const parts2 = CFI.parse('/4/4[second]');
      const el2 = CFI.toElement(page, parts2[0]);
      expect(el2.id).toBe('second');
    });
  });

  describe('edge case: inert element between text nodes', () => {
    it('should handle inert element between text content', () => {
      const page = XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>Test</title></head>
        <body>
          <p id="test">Hello<span cfi-inert="">SKIP</span> World</p>
        </body>
      </html>`);

      // The inert element between text nodes should be invisible
      // "Hello" and " World" should be treated as a single text chunk
      const cfi = '/4/2[test]/1:5';
      const range = CFI.toRange(page, CFI.parse(cfi));
      expect(range).not.toBeNull();

      const generatedCFI = CFI.fromRange(range!);
      expect(generatedCFI).toBe(`epubcfi(${cfi})`);
    });

    it('text offset should span across the invisible inert element', () => {
      const withInert = XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>Test</title></head>
        <body>
          <p id="test">Hello<span cfi-inert="">SKIP</span> World</p>
        </body>
      </html>`);

      const withoutInert = XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>Test</title></head>
        <body>
          <p id="test">Hello World</p>
        </body>
      </html>`);

      // offset 5 in "Hello World" should work in both documents
      const cfi = '/4/2[test]/1:5';
      const rangeWith = CFI.toRange(withInert, CFI.parse(cfi));
      const rangeWithout = CFI.toRange(withoutInert, CFI.parse(cfi));
      expect(rangeWith).not.toBeNull();
      expect(rangeWithout).not.toBeNull();
    });
  });

  describe('buildRange with inert elements', () => {
    it('should create valid range CFIs with inert elements present', () => {
      const base = basePage();
      const withInert = pageWithInertAtStart();

      for (let i = 0; i < 10; i++) {
        const cfi = `/4/10,/3:${i},/3:${i + 1}`;
        const baseRange = CFI.toRange(base, CFI.parse(cfi));
        const inertRange = CFI.toRange(withInert, CFI.parse(cfi));

        expect(baseRange!.toString()).toBe(inertRange!.toString());
        expect(baseRange!.toString()).toBe(`${i}`);
      }
    });

    it('should create range CFI from ranges in documents with inert elements', () => {
      const withInert = pageWithInertAtStart();
      const para = withInert.getElementById('para05')!;

      const range = withInert.createRange();
      range.setStart(para.firstChild!, 0); // "xxx"
      range.setEnd(para.childNodes[2]!, 5); // "0123456789" at offset 5

      const cfi = CFI.fromRange(range);
      // Verify it resolves back correctly
      const resolved = CFI.toRange(withInert, CFI.parse(cfi));
      expect(resolved).not.toBeNull();
      expect(resolved!.toString()).toBe(range.toString());
    });
  });

  describe('parse and toString symmetry', () => {
    it('should maintain CFI string representation with inert elements', () => {
      const cfis = [
        'epubcfi(/4[body01]/10[para05]/3:10)',
        'epubcfi(/4[body01]/16[svgimg])',
        'epubcfi(/4/10,/3:0,/3:5)',
      ];

      for (const cfi of cfis) {
        const parsed = CFI.parse(cfi);
        // parse → collapse → resolve → fromRange should produce valid CFI
        const withInert = pageWithInertAtStart();
        const range = CFI.toRange(withInert, parsed);
        if (range) {
          const generated = CFI.fromRange(range);
          // The generated CFI should be parseable
          const reparsed = CFI.parse(generated);
          expect(reparsed).toBeDefined();
        }
      }
    });
  });
});
