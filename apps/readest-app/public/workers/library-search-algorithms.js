const normalize = (value, options) => {
  let result = value.normalize('NFC');
  if (!options.matchDiacritics) {
    result = result.normalize('NFD').replace(/\p{Mark}/gu, '');
  }
  return options.matchCase ? result : result.toLocaleLowerCase();
};

export const MAX_FUZZY_QUERY_LENGTH = 256;

const segmentGraphemes = (text, options) => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), ({ segment, index }) => ({
    text: segment,
    start: index,
    end: index + segment.length,
    key: normalize(segment, options),
    looseKey: normalize(segment, { matchCase: false, matchDiacritics: false }),
  }));
};

const getTypoBudget = (length) => {
  if (length <= 2) return 0;
  if (length <= 5) return 1;
  return 2;
};

const buildLcsTable = (query, source, sourceStart, sourceLength, table, width) => {
  table.fill(0);
  for (let queryIndex = 1; queryIndex <= query.length; queryIndex++) {
    const row = queryIndex * width;
    const previousRow = row - width;
    for (let sourceIndex = 1; sourceIndex <= sourceLength; sourceIndex++) {
      table[row + sourceIndex] =
        query[queryIndex - 1].key === source[sourceStart + sourceIndex - 1].key
          ? table[previousRow + sourceIndex - 1] + 1
          : Math.max(table[previousRow + sourceIndex], table[row + sourceIndex - 1]);
    }
  }
};

const traceAlignment = (table, query, source, sourceStart, sourceLength, width) => {
  const positions = [];
  let queryIndex = query.length;
  let sourceIndex = sourceLength;
  while (queryIndex > 0 && sourceIndex > 0) {
    const row = queryIndex * width;
    const previousRow = row - width;
    if (
      query[queryIndex - 1].key === source[sourceStart + sourceIndex - 1].key &&
      table[row + sourceIndex] === table[previousRow + sourceIndex - 1] + 1
    ) {
      positions.push(sourceIndex - 1);
      queryIndex--;
      sourceIndex--;
    } else if (table[previousRow + sourceIndex] >= table[row + sourceIndex - 1]) {
      queryIndex--;
    } else {
      sourceIndex--;
    }
  }
  return positions.reverse();
};

const makeRuns = (source, positions) => {
  const runs = [];
  for (const position of positions) {
    const grapheme = source[position];
    const previous = runs.at(-1);
    if (previous?.end === grapheme.start) previous.end = grapheme.end;
    else runs.push({ start: grapheme.start, end: grapheme.end });
  }
  return runs;
};

const conflictsWithStrictOptions = (query, source, start, end, options) => {
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

export const findFuzzyMatches = (text, rawQuery, options, limit = Infinity, state) => {
  const queryText = rawQuery.trim();
  if (!queryText) return [];

  const query = segmentGraphemes(queryText, options);
  if (query.length > MAX_FUZZY_QUERY_LENGTH) {
    const error = new Error(
      `Fuzzy search query cannot exceed ${MAX_FUZZY_QUERY_LENGTH} characters`,
    );
    Object.assign(error, { code: 'FUZZY_QUERY_TOO_LONG' });
    throw error;
  }
  if (limit <= 0) return [];
  const source = segmentGraphemes(text, options);
  const typoBudget = getTypoBudget(query.length);
  const minimumMatches = query.length - typoBudget;
  const maximumSpan = query.length * 3;
  const tableWidth = maximumSpan + 1;
  const lcsTable = new Uint16Array((query.length + 1) * tableWidth);
  const candidates = new Map();
  const candidateLimit = Number.isFinite(limit)
    ? Math.min(16_000, Math.max(1, Math.floor(limit)) * Math.min(maximumSpan, 32))
    : Infinity;
  const possibleStartKeys = new Set(query.slice(0, typoBudget + 1).map(({ key }) => key));
  const queryCounts = new Map();
  for (const { key } of query) queryCounts.set(key, (queryCounts.get(key) ?? 0) + 1);
  const windowCounts = new Map();
  let availableMatches = 0;
  const adjustWindowCount = (key, delta) => {
    const required = queryCounts.get(key);
    if (!required) return;
    const previous = windowCounts.get(key) ?? 0;
    const next = previous + delta;
    availableMatches += Math.min(next, required) - Math.min(previous, required);
    if (next) windowCounts.set(key, next);
    else windowCounts.delete(key);
  };
  for (let index = 0; index < Math.min(maximumSpan, source.length); index++) {
    adjustWindowCount(source[index].key, 1);
  }

  candidateStarts: for (let start = 0; start < source.length; start++) {
    const windowLength = Math.min(maximumSpan, source.length - start);
    const isCandidate =
      possibleStartKeys.has(source[start].key) && availableMatches >= minimumMatches;
    if (isCandidate) {
      buildLcsTable(query, source, start, windowLength, lcsTable, tableWidth);
      for (let length = minimumMatches; length <= windowLength; length++) {
        const matchCount = lcsTable[query.length * tableWidth + length];
        if (matchCount < minimumMatches) continue;
        const localPositions = traceAlignment(lcsTable, query, source, start, length, tableWidth);
        if (localPositions[0] !== 0) continue;

        const positions = localPositions.map((position) => start + position);
        const last = positions.at(-1);
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
        const candidate = {
          start: source[start].start,
          end: source[last].end,
          runs,
          typoCount,
          score,
        };
        const key = runs.map(({ start: runStart, end }) => `${runStart}:${end}`).join(',');
        const existing = candidates.get(key);
        if (!existing || candidate.score > existing.score) candidates.set(key, candidate);
        if (candidates.size >= candidateLimit) {
          if (state) state.truncated = true;
          break candidateStarts;
        }
      }
    }

    adjustWindowCount(source[start].key, -1);
    const nextIndex = start + maximumSpan;
    if (nextIndex < source.length) adjustWindowCount(source[nextIndex].key, 1);
  }

  const ranked = [...candidates.values()].sort(
    (a, b) =>
      a.typoCount - b.typoCount ||
      b.score - a.score ||
      a.end - a.start - (b.end - b.start) ||
      a.start - b.start,
  );
  const selected = [];
  for (const candidate of ranked) {
    if (selected.some(({ start, end }) => candidate.start < end && candidate.end > start)) continue;
    selected.push(candidate);
    if (selected.length >= limit) {
      if (state) state.truncated = true;
      break;
    }
  }

  return selected
    .sort((a, b) => a.start - b.start)
    .map(({ start, end, runs, typoCount }) => ({ start, end, runs, typoCount }));
};

const getSensitivity = ({ matchCase, matchDiacritics }) =>
  matchDiacritics && matchCase
    ? 'variant'
    : matchDiacritics
      ? 'accent'
      : matchCase
        ? 'case'
        : 'base';

const createSegmenter = (locale) => {
  try {
    return new Intl.Segmenter(locale, { granularity: 'word' });
  } catch {
    return new Intl.Segmenter('en', { granularity: 'word' });
  }
};

const createCollator = (locale, sensitivity) => {
  try {
    return new Intl.Collator(locale, { sensitivity });
  } catch {
    return new Intl.Collator('en', { sensitivity });
  }
};

const CJK_SEGMENT_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export const segmentNearbyWords = (text, locale) => {
  const words = [];
  let unitIndex = 0;
  for (const segment of createSegmenter(locale).segment(text)) {
    if (!segment.isWordLike) continue;
    words.push({
      text: segment.segment,
      wordIndex: unitIndex,
      start: segment.index,
      end: segment.index + segment.segment.length,
    });
    // CJK tokenization is dictionary-dependent and mostly per-character, so
    // token-counted distance is erratic. Count CJK segments by grapheme
    // cluster instead: nearbyWords reads as characters for CJK text and
    // stays one-per-word for other scripts.
    unitIndex += CJK_SEGMENT_RE.test(segment.segment) ? Array.from(segment.segment).length : 1;
  }
  return words;
};

export const findNearbyMatches = (
  text,
  rawQuery,
  options,
  words = segmentNearbyWords(text, options.locale),
  limit = Infinity,
  state,
) => {
  const collator = createCollator(options.locale, getSensitivity(options));
  const queryWords = [];
  for (const word of rawQuery.split(/\s+/).filter(Boolean)) {
    if (!queryWords.some((existing) => collator.compare(existing, word) === 0)) {
      queryWords.push(word);
    }
  }
  if (queryWords.length < 2) {
    const error = new Error('Nearby words search needs at least two words');
    Object.assign(error, { code: 'NEARBY_NEEDS_TWO_WORDS' });
    throw error;
  }
  if (limit <= 0) return [];

  const occurrences = [];
  const termHasWordMatch = new Uint8Array(queryWords.length);
  for (const word of words) {
    const queryIndex = queryWords.findIndex(
      (queryWord) => collator.compare(queryWord, word.text) === 0,
    );
    if (queryIndex >= 0) {
      termHasWordMatch[queryIndex] = 1;
      occurrences.push({ ...word, queryIndex });
    }
  }
  // Word segmenters split names and compounds (CJK especially: 黄仁勋 ->
  // 黄/仁/勋, 训练芯片 -> ... 芯/片), so collator equality against segmented
  // words can miss a term entirely. For terms with zero word-equality
  // occurrences, fall back to substring positions mapped onto word indices,
  // keeping the word-distance semantics of the sliding window.
  if (words.length && termHasWordMatch.includes(0)) {
    const fold = (value) =>
      options.matchCase ? value : value.toLocaleLowerCase(options.locale ?? undefined);
    const haystack = fold(text);
    const wordIndexAt = (position) => {
      let low = 0;
      let high = words.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (words[middle].start <= position) low = middle;
        else high = middle - 1;
      }
      return low;
    };
    for (const [queryIndex, queryWord] of queryWords.entries()) {
      if (termHasWordMatch[queryIndex]) continue;
      const needle = fold(queryWord);
      if (!needle) continue;
      let index = haystack.indexOf(needle);
      while (index >= 0) {
        occurrences.push({
          text: queryWord,
          wordIndex: words[wordIndexAt(index)].wordIndex,
          start: index,
          end: index + queryWord.length,
          queryIndex,
        });
        index = haystack.indexOf(needle, index + 1);
      }
    }
    occurrences.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  const counts = new Uint32Array(queryWords.length);
  const matches = [];
  let distinct = 0;
  let low = 0;
  let lastHigh = -1;
  for (let high = 0; high < occurrences.length; high++) {
    const highQueryIndex = occurrences[high].queryIndex;
    if (counts[highQueryIndex] === 0) distinct++;
    counts[highQueryIndex] = counts[highQueryIndex] + 1;
    let window = null;
    while (distinct === queryWords.length) {
      window = { low, high };
      const lowQueryIndex = occurrences[low].queryIndex;
      counts[lowQueryIndex] = counts[lowQueryIndex] - 1;
      if (counts[lowQueryIndex] === 0) distinct--;
      low++;
    }
    if (
      !window ||
      window.low <= lastHigh ||
      occurrences[window.high].wordIndex - occurrences[window.low].wordIndex > options.nearbyWords
    ) {
      continue;
    }

    lastHigh = window.high;
    const selected = occurrences.slice(window.low, window.high + 1);
    matches.push({
      start: selected[0].start,
      end: selected.at(-1).end,
      runs: selected.map(({ start, end }) => ({ start, end })),
    });
    if (matches.length >= limit) {
      if (state) state.truncated = true;
      break;
    }
  }
  return matches;
};
