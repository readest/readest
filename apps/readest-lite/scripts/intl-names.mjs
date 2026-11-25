// Writes the English names in crates/tauri-runtime-blitz/src/intl.js (between its `intl-names`
// markers) from this Node's ICU data, the CLDR names Chromium's Intl.DisplayNames gives: every
// language, region and script, the dialect names that replace a "Language (Region)" form, and each
// language's own name where ICU has its locale. Then checks intl.js's DisplayNames against ICU for
// every Edge TTS voice locale readest-app lists. Run: node scripts/intl-names.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(new URL(import.meta.url).pathname);
const file = path.join(here, '../crates/tauri-runtime-blitz/src/intl.js');
const A = 'abcdefghijklmnopqrstuvwxyz';
const names = (type, opts = {}) =>
  new Intl.DisplayNames(['en'], { type, fallback: 'none', ...opts });
const lang = names('language', { languageDisplay: 'standard' });
const dialect = names('language');
const region = names('region');
const script = names('script');

const langs = {};
const regions = {};
const scripts = {};
for (const a of A)
  for (const b of A) {
    if (lang.of(a + b)) langs[a + b] = lang.of(a + b);
    if (region.of((a + b).toUpperCase())) regions[(a + b).toUpperCase()] = region.of((a + b).toUpperCase());
    for (const c of A) {
      if (lang.of(a + b + c)) langs[a + b + c] = lang.of(a + b + c);
      for (const d of A) {
        const s = a.toUpperCase() + b + c + d;
        if (script.of(s)) scripts[s] = script.of(s);
      }
    }
  }
for (let i = 0; i < 1000; i++) {
  const r = String(i).padStart(3, '0');
  if (region.of(r)) regions[r] = region.of(r);
}
const dialects = {};
for (const l of Object.keys(langs))
  for (const sub of [...Object.keys(scripts), ...Object.keys(regions)]) {
    const tag = `${l}-${sub}`;
    const d = dialect.of(tag);
    if (d && d !== lang.of(tag)) dialects[tag] = d;
  }
const own = {};
for (const l of Object.keys(langs)) {
  const d = new Intl.DisplayNames([l], { type: 'language', fallback: 'none' });
  if (d.resolvedOptions().locale.split('-')[0] !== l) continue; // no locale data: ICU's default
  const n = d.of(l);
  if (n && n !== langs[l]) own[l] = n;
}

const pack = (o) => {
  const s = Object.entries(o).map(([k, v]) => `${k}:${v}`).join('|');
  if (/[|\\]/.test(Object.values(o).join(''))) throw new Error('a name has a | or \\');
  return s.includes("'") ? JSON.stringify(s) : `'${s}'`; // as the repo's formatter quotes it
};
const block = [
  '  // intl-names: written by scripts/intl-names.mjs (CLDR, from Node ' + process.version + "'s ICU)",
  `  const LANGUAGE_NAMES =\n    ${pack(langs)};`,
  `  const REGION_NAMES =\n    ${pack(regions)};`,
  `  const SCRIPT_NAMES =\n    ${pack(scripts)};`,
  `  const DIALECT_NAMES =\n    ${pack(dialects)};`,
  `  const OWN_NAMES =\n    ${pack(own)};`,
  '  // end intl-names',
].join('\n');
const src = fs.readFileSync(file, 'utf8');
const out = src.replace(/  \/\/ intl-names:[^]*?  \/\/ end intl-names/, block);
if (out === src && !src.includes(block)) throw new Error('no intl-names markers in intl.js');
fs.writeFileSync(file, out);
console.log(`intl.js: ${Object.keys(langs).length} languages, ${Object.keys(regions).length} regions, ` +
  `${Object.keys(scripts).length} scripts, ${Object.keys(dialects).length} dialects, ` +
  `${Object.keys(own).length} own names, ${Buffer.byteLength(block)} bytes`);

// intl.js's DisplayNames against ICU's, for the voice locales readest-app lists.
const voices = fs.readFileSync(path.join(here, '../../readest-app/src/libs/edgeTTS.ts'), 'utf8');
const tags = [...new Set(voices.match(/'[a-z]{2,3}(-[A-Z][a-z]{3})?-[A-Z]{2}'/g).map((t) => t.slice(1, -1)))];
const sandbox = { console };
vm.runInNewContext(`delete globalThis.Intl;\n${out}`, sandbox); // as in QuickJS, which has none
const bad = [];
for (const tag of [...tags, ...tags.map((t) => t.split('-')[0])])
  for (const languageDisplay of ['standard', 'dialect']) {
    const want = new Intl.DisplayNames(['en'], { type: 'language', languageDisplay }).of(tag);
    const got = new sandbox.Intl.DisplayNames(['en'], { type: 'language', languageDisplay }).of(tag);
    if (got !== want) bad.push(`${tag} (${languageDisplay}): ${got}, ICU ${want}`);
  }
for (const l of Object.keys(own))
  if (new sandbox.Intl.DisplayNames([l], { type: 'language' }).of(l) !== own[l]) bad.push(`own ${l}`);
if (bad.length) throw new Error(`differs from ICU:\n${bad.join('\n')}`);
console.log(`same as ICU for ${tags.length} voice locales, their languages and ${Object.keys(own).length} own names`);
