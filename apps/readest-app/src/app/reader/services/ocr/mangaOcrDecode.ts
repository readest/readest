const VOCABULARY_SIZE = 6144;
const BEAMS = 4;
const EOS = 3;

interface Beam {
  tokens: number[];
  score: number;
}

// MangaOCR's generation config: four beams, length penalty 2, no repeated
// trigrams, early stopping, and at most 300 tokens including the start token.
export const decodeMangaText = async (
  nextLogits: (sequences: number[][]) => Promise<Float32Array>,
  signal?: AbortSignal,
): Promise<{ tokens: number[]; confidence: number }> => {
  let active: Beam[] = [{ tokens: [2], score: 0 }];
  const finished: Array<Beam & { rank: number; length: number }> = [];
  const finish = (beam: Beam, length: number) => {
    finished.push({ ...beam, length, rank: beam.score / length ** 2 });
    finished.sort((a, b) => b.rank - a.rank);
    if (finished.length > BEAMS) finished.pop();
  };
  for (let length = 1; length < 300; length++) {
    signal?.throwIfAborted();
    const logits = await nextLogits(active.map((beam) => beam.tokens));
    signal?.throwIfAborted();
    if (logits.length !== active.length * VOCABULARY_SIZE) {
      throw new Error('MangaOCR returned invalid decoder logits');
    }
    const candidates: Array<{ beam: Beam; token: number; score: number }> = [];
    for (const [index, beam] of active.entries()) {
      const offset = index * VOCABULARY_SIZE;
      let maximum = -Infinity;
      for (let token = 0; token < VOCABULARY_SIZE; token++) {
        maximum = Math.max(maximum, logits[offset + token]!);
      }
      let sum = 0;
      for (let token = 0; token < VOCABULARY_SIZE; token++) {
        sum += Math.exp(logits[offset + token]! - maximum);
      }
      const normalizer = maximum + Math.log(sum);
      const banned = new Set<number>();
      const ids = beam.tokens;
      for (let i = 0; i + 2 < ids.length; i++) {
        if (ids[i] === ids.at(-2) && ids[i + 1] === ids.at(-1)) banned.add(ids[i + 2]!);
      }
      // Keep only eight candidates, rather than sorting the entire vocabulary.
      for (let token = 0; token < VOCABULARY_SIZE; token++) {
        if (banned.has(token)) continue;
        const score = beam.score + logits[offset + token]! - normalizer;
        if (!Number.isFinite(score)) continue;
        if (candidates.length === BEAMS * 2 && score <= candidates.at(-1)!.score) continue;
        const candidate = { beam, token, score };
        const position = candidates.findIndex((entry) => score > entry.score);
        if (position < 0) candidates.push(candidate);
        else candidates.splice(position, 0, candidate);
        if (candidates.length > BEAMS * 2) candidates.pop();
      }
    }
    const next: Beam[] = [];
    for (const [rank, candidate] of candidates.entries()) {
      const { beam, token, score } = candidate;
      if (token === EOS) {
        if (rank < BEAMS) finish({ tokens: beam.tokens, score }, length);
      } else {
        next.push({ tokens: [...beam.tokens, token], score });
        if (next.length === BEAMS) break;
      }
    }
    if (finished.length === BEAMS || !next.length) break;
    active = next;
    if (length === 299) for (const beam of active) finish(beam, length);
  }
  const best = finished[0];
  if (!best) throw new Error('MangaOCR could not decode the text crop');
  return {
    tokens: best.tokens.slice(1),
    // Mean token likelihood, not a calibrated probability of correct OCR.
    confidence: Math.exp(best.score / best.length) * 100,
  };
};
