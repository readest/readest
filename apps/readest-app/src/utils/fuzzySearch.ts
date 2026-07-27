export interface FuzzySearchOptions {
  matchCase: boolean;
  matchDiacritics: boolean;
}

export interface FuzzyMatch {
  start: number;
  end: number;
  runs: Array<{ start: number; end: number }>;
  typoCount: number;
}

interface Grapheme {
  text: string;
  start: number;
  end: number;
  key: string;
  looseKey: string;
}

interface Candidate extends FuzzyMatch {
  score: number;
}

const segmentGraphemes = (text: string, options: FuzzySearchOptions): Grapheme[] => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), ({ segment, index }) => ({
    text: segment,
    start: index,
    end: index + segment.length,
    key: normalize(segment, options),
    looseKey: normalize(segment, { matchCase: false, matchDiacritics: false }),
  }));
};

const normalize = (value: string, options: FuzzySearchOptions): string => {
  let result = value.normalize('NFC');
  if (!options.matchDiacritics) {
    result = result.normalize('NFD').replace(/\p{Mark}/gu, '');
  }
  return options.matchCase ? result : result.toLocaleLowerCase();
};

const getTypoBudget = (length: number): number => {
  if (length <= 2) return 0;
  if (length <= 5) return 1;
  return 2;
};

const buildLcsTable = (query: Grapheme[], source: Grapheme[]): number[][] => {
  const table = Array.from({ length: query.length + 1 }, () =>
    new Array<number>(source.length + 1).fill(0),
  );
  for (let queryIndex = 1; queryIndex <= query.length; queryIndex++) {
    for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex++) {
      table[queryIndex]![sourceIndex] =
        query[queryIndex - 1]!.key === source[sourceIndex - 1]!.key
          ? table[queryIndex - 1]![sourceIndex - 1]! + 1
          : Math.max(table[queryIndex - 1]![sourceIndex]!, table[queryIndex]![sourceIndex - 1]!);
    }
  }
  return table;
};

const traceAlignment = (
  table: number[][],
  query: Grapheme[],
  source: Grapheme[],
  sourceLength: number,
): number[] => {
  const positions: number[] = [];
  let queryIndex = query.length;
  let sourceIndex = sourceLength;
  while (queryIndex > 0 && sourceIndex > 0) {
    if (
      query[queryIndex - 1]!.key === source[sourceIndex - 1]!.key &&
      table[queryIndex]![sourceIndex] === table[queryIndex - 1]![sourceIndex - 1]! + 1
    ) {
      positions.push(sourceIndex - 1);
      queryIndex--;
      sourceIndex--;
    } else if (table[queryIndex - 1]![sourceIndex]! >= table[queryIndex]![sourceIndex - 1]!) {
      queryIndex--;
    } else {
      sourceIndex--;
    }
  }
  return positions.reverse();
};

const makeRuns = (source: Grapheme[], positions: number[]) => {
  const runs: Array<{ start: number; end: number }> = [];
  for (const position of positions) {
    const grapheme = source[position]!;
    const previous = runs.at(-1);
    if (previous?.end === grapheme.start) previous.end = grapheme.end;
    else runs.push({ start: grapheme.start, end: grapheme.end });
  }
  return runs;
};

const conflictsWithStrictOptions = (
  query: Grapheme[],
  source: Grapheme[],
  start: number,
  end: number,
  options: FuzzySearchOptions,
): boolean => {
  if (!options.matchCase && !options.matchDiacritics) return false;
  const queryLoose = query.map(({ looseKey }) => looseKey).join('');
  const queryKey = query.map(({ key }) => key).join('');
  const firstWindow = Math.max(0, start - getTypoBudget(query.length));
  const lastWindow = Math.min(start, source.length - query.length);
  for (let windowStart = firstWindow; windowStart <= lastWindow; windowStart++) {
    const windowEnd = windowStart + query.length - 1;
    if (windowEnd < end) continue;
    const sourceSlice = source.slice(windowStart, windowEnd + 1);
    if (
      sourceSlice.map(({ looseKey }) => looseKey).join('') === queryLoose &&
      sourceSlice.map(({ key }) => key).join('') !== queryKey
    ) {
      return true;
    }
  }
  return false;
};

export const findFuzzyMatches = (
  text: string,
  rawQuery: string,
  options: FuzzySearchOptions,
): FuzzyMatch[] => {
  const queryText = rawQuery.trim();
  if (!queryText) return [];

  const query = segmentGraphemes(queryText, options);
  const source = segmentGraphemes(text, options);
  const typoBudget = getTypoBudget(query.length);
  const minimumMatches = query.length - typoBudget;
  const maximumSpan = query.length * 3;
  const candidates = new Map<string, Candidate>();

  for (let start = 0; start < source.length; start++) {
    const window = source.slice(start, start + maximumSpan);
    const table = buildLcsTable(query, window);
    for (let length = minimumMatches; length <= window.length; length++) {
      const matchCount = table[query.length]![length]!;
      if (matchCount < minimumMatches) continue;
      const localPositions = traceAlignment(table, query, window, length);
      if (localPositions[0] !== 0) continue;

      const positions = localPositions.map((position) => start + position);
      const last = positions.at(-1)!;
      const span = last - start + 1;
      const typoCount = query.length - positions.length;
      const minimumDensity = typoCount === 0 ? 0.45 : 0.65;
      const gapRuns = makeRuns(source, positions).length - 1;
      const score = positions.length * 12 - typoCount * 6;
      if (
        typoCount > typoBudget ||
        span > maximumSpan ||
        positions.length / span < minimumDensity ||
        gapRuns > Math.max(Math.floor(query.length / 3), 2) ||
        score < query.length * 6 ||
        conflictsWithStrictOptions(query, source, start, last, options)
      ) {
        continue;
      }

      const runs = makeRuns(source, positions);
      const candidate: Candidate = {
        start: source[start]!.start,
        end: source[last]!.end,
        runs,
        typoCount,
        score,
      };
      const key = runs.map(({ start: runStart, end }) => `${runStart}:${end}`).join(',');
      const existing = candidates.get(key);
      if (!existing || candidate.score > existing.score) candidates.set(key, candidate);
    }
  }

  const ranked = [...candidates.values()].sort(
    (a, b) =>
      a.typoCount - b.typoCount ||
      b.score - a.score ||
      a.end - a.start - (b.end - b.start) ||
      a.start - b.start,
  );
  const selected: Candidate[] = [];
  for (const candidate of ranked) {
    if (selected.some(({ start, end }) => candidate.start < end && candidate.end > start)) continue;
    selected.push(candidate);
  }

  return selected
    .sort((a, b) => a.start - b.start)
    .map(({ start, end, runs, typoCount }) => ({ start, end, runs, typoCount }));
};
