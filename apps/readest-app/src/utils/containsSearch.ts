interface ContainsSearchOptions {
  matchCase: boolean;
  matchDiacritics: boolean;
}

interface FoldedText {
  value: string;
  starts?: number[];
  ends?: number[];
}

const foldValue = (
  value: string,
  { matchCase, matchDiacritics }: ContainsSearchOptions,
  locale?: string,
): string => {
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
  if (folded.length === value.length) return { value: folded };

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
      yield { start: index, end: index + query.length };
      index = text.indexOf(query, index + 1);
    }
    return;
  }

  const haystack = foldText(text, options, locale);
  const needle = foldText(query, options, locale).value;
  if (!needle) return;
  let index = haystack.value.indexOf(needle);
  while (index >= 0) {
    yield {
      start: haystack.starts?.[index] ?? index,
      end: haystack.ends?.[index + needle.length - 1] ?? index + needle.length,
    };
    index = haystack.value.indexOf(needle, index + 1);
  }
}
