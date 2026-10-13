interface ContainsSearchOptions {
  matchCase: boolean;
  matchDiacritics: boolean;
}

interface FoldedText {
  value: string;
  starts?: number[];
  ends?: number[];
}

const endsBeforeCombiningMark = (text: string, end: number) => /^\p{M}/u.test(text.slice(end));

export const foldValue = (
  value: string,
  { matchCase, matchDiacritics }: ContainsSearchOptions,
  locale?: string,
): string => {
  // Soft hyphens are invisible break hints; never let them split a match.
  value = value.replace(/\u00AD/g, '');
  if (!matchCase) {
    try {
      value = value.toLocaleLowerCase(locale);
    } catch {
      value = value.toLowerCase();
    }
  }
  return matchDiacritics ? value : value.normalize('NFD').replace(/\p{M}/gu, '');
};

const foldText = (value: string, options: ContainsSearchOptions, locale?: string): FoldedText => {
  const folded = foldValue(value, options, locale);
  // Equal lengths mean aligned offsets only if nothing was dropped: a removed
  // soft hyphen can cancel out a fold that lengthens (İ -> i + U+0307).
  if (folded.length === value.length && !value.includes('\u00AD')) return { value: folded };

  const starts: number[] = [];
  const ends: number[] = [];
  let sourceOffset = 0;
  for (const source of value) {
    const start = sourceOffset;
    sourceOffset += source.length;
    const transformed = foldValue(source, options, locale);
    for (let index = 0; index < transformed.length; index++) {
      starts.push(start);
      ends.push(sourceOffset);
    }
    if (!transformed && ends.length) {
      for (let index = ends.length - 1; index >= 0 && ends[index] === start; index--) {
        ends[index] = sourceOffset;
      }
    }
  }
  return { value: folded, starts, ends };
};

export function* findContainsMatches(
  text: string,
  query: string,
  options: ContainsSearchOptions,
  locale?: string,
) {
  if (!query) return;
  if (options.matchCase && options.matchDiacritics) {
    let index = text.indexOf(query);
    while (index >= 0) {
      const end = index + query.length;
      if (!endsBeforeCombiningMark(text, end)) yield { start: index, end };
      index = text.indexOf(query, index + 1);
    }
    return;
  }

  const haystack = foldText(text, options, locale);
  const needle = foldText(query, options, locale).value;
  if (!needle) return;
  let index = haystack.value.indexOf(needle);
  while (index >= 0) {
    const end = haystack.ends?.[index + needle.length - 1] ?? index + needle.length;
    if (!options.matchDiacritics || !endsBeforeCombiningMark(text, end)) {
      yield { start: haystack.starts?.[index] ?? index, end };
    }
    index = haystack.value.indexOf(needle, index + 1);
  }
}
