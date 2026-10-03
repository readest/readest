/**
 * The reader's own stylesheet hides inline footnote bodies
 * (`.duokan-footnote-content`, `.epubtype-footnote`, `aside[epub|type~=...]`),
 * so a link that points at one leads nowhere the reader can see. The footnote
 * popup's jump button must be gated on the target actually being rendered.
 */
import { describe, it, expect } from 'vitest';
import { isLinkTargetVisible } from '@/app/reader/utils/footnoteHeuristics';
import type { FoliateView } from '@/types/view';

// Section documents are iframe documents in the reader; a DOMParser document
// has no `defaultView`, so it cannot report computed styles.
const makeView = (html: string, { rendered = true, index = 2 } = {}) => {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.body.innerHTML = html;
  return {
    resolveNavigation: () => ({
      index,
      anchor: (d: Document) => d.getElementById('target'),
    }),
    renderer: {
      getContents: () => (rendered ? [{ doc, index }] : []),
    },
  } as unknown as FoliateView;
};

describe('isLinkTargetVisible', () => {
  it('rejects a target hidden by an ancestor', () => {
    const view = makeView(
      `<div class='duokan-footnote-content' style='display: none'>
         <p><a id='target'></a>the note body</p>
       </div>`,
    );
    expect(isLinkTargetVisible(view, 'ch1.xhtml#B_1')).toBe(false);
  });

  it('rejects a target hidden on the element itself', () => {
    const view = makeView(`<aside id='target' style='display: none'>note</aside>`);
    expect(isLinkTargetVisible(view, 'ch1.xhtml#n1')).toBe(false);
  });

  it('rejects a target made invisible rather than unrendered', () => {
    const view = makeView(`<aside id='target' style='visibility: hidden'>note</aside>`);
    expect(isLinkTargetVisible(view, 'ch1.xhtml#n1')).toBe(false);
  });

  it('accepts a target that is laid out', () => {
    const view = makeView(`<h2 id='target'>Appendix C</h2><p>body</p>`);
    expect(isLinkTargetVisible(view, 'appendix.xhtml#app-c')).toBe(true);
  });

  // An inline footnote body always lives beside its reference, so it is always
  // in a rendered section. A target in a section that is not rendered yet is a
  // real destination, and loading it just to check would stall the popup.
  it('accepts a target whose section is not rendered yet', () => {
    const view = makeView(`<aside id='target' style='display: none'>note</aside>`, {
      rendered: false,
    });
    expect(isLinkTargetVisible(view, 'notes.xhtml#n1')).toBe(true);
  });

  it('accepts when navigation cannot be resolved', () => {
    const view = {
      resolveNavigation: () => {
        throw new Error('unresolvable');
      },
      renderer: { getContents: () => [] },
    } as unknown as FoliateView;
    expect(isLinkTargetVisible(view, 'nope.xhtml#x')).toBe(true);
  });
});
