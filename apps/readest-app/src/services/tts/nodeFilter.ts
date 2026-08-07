import { createRejectFilter } from '@/utils/node';
import { isMutedRubyNode } from '@/utils/ruby';

// Node filter shared by the live TTS instance and the timeline enumeration —
// the two MUST segment identically or timeline sentences drift from marks.
export const createTTSNodeFilter = () => {
  const reject = createRejectFilter({
    tags: ['canvas', 'br'],
    // Footnotes/endnotes are hidden in the rendered page (see the
    // `.epubtype-footnote`/`aside[epub|type]` rules in getPageLayoutStyles);
    // skip them in TTS too, including for background sections whose
    // documents are loaded without those styles.
    classes: [
      'annotationLayer',
      'epubtype-footnote',
      'duokan-footnote-content',
      'duokan-footnote-item',
    ],
    attributeTokens: [
      {
        tag: 'aside',
        attribute: 'epub:type',
        tokens: ['footnote', 'endnote', 'note', 'rearnote'],
      },
    ],
    contents: [{ tag: 'a', content: /^[\[\(]?[\*\d]+[\)\]]?$/ }],
  });
  // Ruby is decided per base-run/reading pair rather than by tag name: a kana
  // <rt> is spoken in place of the kanji it annotates, anything else keeps the
  // pre-#5539 behaviour of speaking the base and dropping the annotation.
  return (node: Node): number => (isMutedRubyNode(node) ? NodeFilter.FILTER_REJECT : reject(node));
};
