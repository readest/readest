// Preview sample entries from the generated Word Lens gloss packs, to eyeball gloss
// quality per language pair. Read-only; does not modify any pack.
//
//   node scripts/preview-wordlens.mjs                 # a sample from every pack
//   node scripts/preview-wordlens.mjs en-en           # a larger sample from one pair
//   node scripts/preview-wordlens.mjs en-en happy commence thickly   # specific words
//
// (pnpm wordlens:preview [pair] [...words])
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../data/wordlens');

// Pick `count` entries spread evenly across the frequency-rank range (commonest
// first, rarest last) so a preview shows both easy and hard words. Deterministic.
export function sampleEntries(entries, count = 12) {
  const sorted = Object.entries(entries).sort((a, b) => a[1].r - b[1].r);
  if (sorted.length <= count) return sorted;
  const step = (sorted.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => sorted[Math.round(i * step)]);
}

function previewPack(pair, words, count) {
  const path = resolve(DATA_DIR, `${pair}.json`);
  if (!existsSync(path)) {
    console.log(`\n${pair}: (no pack file)`);
    return;
  }
  const { meta, entries, inflections } = JSON.parse(readFileSync(path, 'utf8'));
  const n = Object.keys(entries).length;
  console.log(`\n${pair}  —  ${meta.source}→${meta.target}, ${n} entries, metric=${meta.metric}`);
  const rows = words.length
    ? words.map((w) => {
        const key = w.toLowerCase();
        const lemma = inflections[key];
        const entry = entries[key] ?? (lemma ? entries[lemma] : null);
        return [lemma ? `${key} → ${lemma}` : key, entry];
      })
    : sampleEntries(entries, count);
  for (const [word, entry] of rows) {
    if (!entry) console.log(`  ${'—'.padStart(6)}  ${String(word).padEnd(22)}  (no entry)`);
    else console.log(`  ${String(entry.r).padStart(6)}  ${String(word).padEnd(22)}  ${entry.g}`);
  }
  if (!words.length) {
    const infl = Object.entries(inflections)
      .slice(0, 6)
      .map(([f, l]) => `${f}→${l}`);
    if (infl.length) console.log(`  inflections: ${infl.join(', ')}`);
  }
}

function listPairs() {
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

function main() {
  const [pair, ...words] = process.argv.slice(2);
  if (pair) previewPack(pair, words, words.length ? words.length : 25);
  else for (const p of listPairs()) previewPack(p, [], 12);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
