interface TextSlice {
  node: Text;
  start: number;
  end: number;
}

interface TextRange {
  start: number;
  end: number;
}

// Plain-text ruby has no semantic markup to distinguish it from prose. Keep
// the opt-in heuristic conservative: the base must end in a Han ideograph and
// the enclosed text may contain only Han or kana-script characters.
const INLINE_READING =
  /([\p{Unified_Ideograph}\u3005\u3006\u3007\u303b])(?:（[\p{Unified_Ideograph}\u3005\u3006\u3007\u303bぁ-ゖ゛-ゟァ-ヿ]+）|\([\p{Unified_Ideograph}\u3005\u3006\u3007\u303bぁ-ゖ゛-ゟァ-ヿ]+\)|《[\p{Unified_Ideograph}\u3005\u3006\u3007\u303bぁ-ゖ゛-ゟァ-ヿ]+》)/gu;

const getAnnotationRanges = (text: string): TextRange[] =>
  Array.from(text.matchAll(INLINE_READING), (match) => ({
    start: match.index + match[1]!.length,
    end: match.index + match[0].length,
  }));

export const stripInlineReadingAnnotations = (text: string): string =>
  text.replace(INLINE_READING, (_match, base: string) => base);

export const stripInlineReadingAnnotationsFromSSML = (ssml: string): string => {
  const doc = new DOMParser().parseFromString(ssml, 'application/xml');
  if (doc.querySelector('parsererror')) return ssml;

  const slices: TextSlice[] = [];
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT);
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? '';
    slices.push({ node: node as Text, start: text.length, end: text.length + value.length });
    text += value;
  }

  const ranges = getAnnotationRanges(text);
  if (ranges.length === 0) return ssml;

  for (const slice of slices) {
    const cuts = ranges
      .filter((range) => range.start < slice.end && range.end > slice.start)
      .map((range) => ({
        start: Math.max(range.start, slice.start) - slice.start,
        end: Math.min(range.end, slice.end) - slice.start,
      }));
    if (cuts.length === 0) continue;

    let cursor = 0;
    let value = '';
    for (const cut of cuts) {
      value += slice.node.data.slice(cursor, cut.start);
      cursor = cut.end;
    }
    slice.node.data = value + slice.node.data.slice(cursor);
  }

  return new XMLSerializer().serializeToString(doc);
};
