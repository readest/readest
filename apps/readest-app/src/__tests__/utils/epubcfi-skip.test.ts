import { describe, it, expect } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';

const XHTML = (str: string) => new DOMParser().parseFromString(str, 'application/xhtml+xml');

// cfi-skip marks a layout-only wrapper as invisible to CFI: unlike cfi-inert (which
// removes the node AND its subtree), cfi-skip hoists the node's children into its
// parent, so the wrapped content keeps the exact CFI it had before being wrapped.
// This mirrors what applyScrollableStyle does when it wraps a wide <table>/<math>.

const TABLE = `<table id="tbl"><tbody><tr><td><p id="cell">xxx<em>yyy</em>0123456789</p></td></tr></tbody></table>`;

const body = (tableMarkup: string) =>
  XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body id="body01">
    <p id="p1">First paragraph</p>
    <p>Second paragraph</p>
    ${tableMarkup}
    <p>Fourth paragraph</p>
    <img id="svgimg" src="foo.svg" alt="an image"/>
  </body>
</html>`);

// Baseline: a table sitting directly in body, no wrapper.
const basePage = () => body(TABLE);
// The same table wrapped in a cfi-skip layout div (as applyScrollableStyle does).
const pageWithSkipWrapper = () => body(`<div class="scroll-wrapper" cfi-skip="">${TABLE}</div>`);
// Wrapper nested two deep, to prove the hoisting recurses.
const pageWithNestedSkipWrappers = () =>
  body(`<div cfi-skip=""><div cfi-skip="">${TABLE}</div></div>`);

// Build a representative set of ranges (inside the table and around it) in a doc,
// keyed by label so the same logical range can be built in every variant.
const ranges = (doc: Document): Record<string, Range> => {
  const cell = doc.getElementById('cell')!;
  const xxx = cell.firstChild!; // "xxx"
  const em = cell.childNodes[1]!.firstChild!; // "yyy" inside <em>
  const digits = cell.childNodes[2]!; // "0123456789"
  const r = (build: (range: Range) => void) => {
    const range = doc.createRange();
    build(range);
    return range;
  };
  const point = (node: Node, offset: number) =>
    r((g) => {
      g.setStart(node, offset);
      g.collapse(true);
    });
  return {
    beforeTable: point(doc.getElementById('p1')!.firstChild!, 0),
    tableElement: point(doc.getElementById('tbl')!, 0), // collapsed at element → element CFI
    cellStart: r((g) => {
      g.setStart(xxx, 0);
      g.setEnd(xxx, 3);
    }),
    cellEm: point(em, 0),
    cellDigits: r((g) => {
      g.setStart(digits, 1);
      g.setEnd(digits, 5);
    }),
    spanningCell: r((g) => {
      g.setStart(xxx, 1);
      g.setEnd(digits, 4);
    }),
    afterTable: point(doc.getElementById('svgimg')!, 0),
  };
};

const variants = () => [
  ['skip wrapper', pageWithSkipWrapper()] as const,
  ['nested skip wrappers', pageWithNestedSkipWrappers()] as const,
];

describe('epubcfi cfi-skip wrapper transparency', () => {
  it('every base-page range round-trips unchanged (fromRange → toRange → fromRange)', () => {
    const doc = basePage();
    for (const [label, range] of Object.entries(ranges(doc))) {
      const cfi = CFI.fromRange(range);
      const resolved = CFI.toRange(doc, CFI.parse(cfi));
      expect(resolved, label).not.toBeNull();
      expect(CFI.fromRange(resolved!), label).toBe(cfi);
    }
  });

  it('produces the SAME CFI for an equivalent range with and without the skip wrapper', () => {
    const baseCFIs = Object.fromEntries(
      Object.entries(ranges(basePage())).map(([k, range]) => [k, CFI.fromRange(range)]),
    );
    for (const [variantLabel, doc] of variants()) {
      for (const [key, range] of Object.entries(ranges(doc))) {
        expect(CFI.fromRange(range), `${variantLabel}: ${key}`).toBe(baseCFIs[key]);
      }
    }
  });

  it('resolves a base-page CFI to the same content inside the wrapped table', () => {
    const base = basePage();
    const baseCFIs = Object.entries(ranges(base)).map(
      ([key, range]) => [key, CFI.fromRange(range), range.toString()] as const,
    );
    for (const [variantLabel, doc] of variants()) {
      for (const [key, cfi, text] of baseCFIs) {
        const resolved = CFI.toRange(doc, CFI.parse(cfi));
        expect(resolved, `${variantLabel}: ${key}`).not.toBeNull();
        expect(resolved!.toString(), `${variantLabel}: ${key}`).toBe(text);
      }
    }
  });

  it('keeps the wrapper div out of the generated CFI (table stays at the same step)', () => {
    const baseCFI = CFI.fromRange(ranges(basePage())['tableElement']);
    for (const [variantLabel, doc] of variants()) {
      const wrappedCFI = CFI.fromRange(ranges(doc)['tableElement']);
      expect(wrappedCFI, variantLabel).toBe(baseCFI);
      expect(wrappedCFI, variantLabel).toContain('[tbl]');
    }
  });

  it('resolves the table element across the wrapper via toElement', () => {
    const tblParts = CFI.parse(CFI.fromRange(ranges(basePage())['tableElement']));
    for (const [variantLabel, doc] of variants()) {
      const el = CFI.toElement(doc, tblParts[0]);
      expect(el.id, variantLabel).toBe('tbl');
    }
  });

  it('does NOT hoist a plain wrapper that lacks cfi-skip (it stays a CFI level)', () => {
    const plain = body(`<div class="scroll-wrapper">${TABLE}</div>`);
    const wrappedCFI = CFI.fromRange(ranges(plain)['tableElement']);
    const baseCFI = CFI.fromRange(ranges(basePage())['tableElement']);
    // The table now sits one element step deeper (inside the counted div), so the
    // CFI differs from the unwrapped baseline — proving cfi-skip is what makes the
    // wrapper transparent, not merely the presence of a wrapper div.
    expect(wrappedCFI).not.toBe(baseCFI);
    // It still resolves to the table, just at a deeper path.
    expect(CFI.toElement(plain, CFI.parse(wrappedCFI)[0]).id).toBe('tbl');
  });
});
