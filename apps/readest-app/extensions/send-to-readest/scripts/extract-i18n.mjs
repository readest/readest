#!/usr/bin/env node
/**
 * Extract runtime i18n source strings from the extension and merge them
 * into each locale bundle under `src/i18n/`. Mirrors the readest-app's
 * `i18n:extract` flow and shares its `_(...)` call convention:
 *
 *   - `_('English source', { ...vars })` — key-as-content
 *   - `data-i18n="English source"` HTML attributes
 *   - `data-i18n-title="English source"` HTML attributes
 *
 * en.json stays `{}` by design — the runtime helper falls through to
 * the key when no translation exists. For every other locale we:
 *   - add missing keys with `__STRING_NOT_TRANSLATED__` (matches the
 *     readest-app sentinel)
 *   - keep existing translations
 *   - log (don't delete) orphan keys so a translator can decide
 *
 * Flags:
 *   --check   exit non-zero when any locale has untranslated entries
 *             (used by the CI build to keep the bundle complete)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const APP_ROOT = join(ROOT, '..', '..');
const LOCALES_DIR = join(ROOT, 'src', 'locales');
const LANGS_FILE = join(APP_ROOT, 'i18n-langs.json');
const INDEX_FILE = join(LOCALES_DIR, 'index.ts');
const CHROME_LOCALES_DIR = join(ROOT, '_locales');
const SENTINEL = '__STRING_NOT_TRANSLATED__';

/** Locale codes the extension ships — same canonical list as readest-app. */
function loadLangs() {
  if (!existsSync(LANGS_FILE)) return ['en'];
  const langs = JSON.parse(readFileSync(LANGS_FILE, 'utf8'));
  // en isn't in the upstream list (it's the source language); add it
  // so we still touch / preserve `src/i18n/en.json`.
  return ['en', ...langs];
}

/** Recursively walk a directory and yield every file matching `match`. */
function* walk(dir, match) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      yield* walk(path, match);
    } else if (entry.isFile() && match(path)) {
      yield path;
    }
  }
}

/** Pull every `_('source', ...)` call, captures quoted literal arg only.
 *  The leading `\b` won't match here because `_` is a word character on
 *  both sides of the boundary, so we use a non-word lookbehind via
 *  `(?:^|[^\w])` and capture group 1 just to anchor without consuming
 *  surrounding context. */
const RE_T_CALL = /(?:^|[^\w])_\(\s*(["'`])((?:\\.|(?!\1).)*?)\1\s*[,)]/g;
/** Pull every `data-i18n="source"` and `data-i18n-title="source"` attr. */
const RE_DATA_I18N = /\bdata-i18n(?:-title)?=("|')((?:\\.|(?!\1).)*?)\1/g;

function unescapeLiteral(s) {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\(['"`\\])/g, '$1');
}

function extract() {
  const keys = new Set();
  // TypeScript source — skip *.test.ts (assertion text isn't user-facing).
  const tsFiles = [...walk(join(ROOT, 'src'), (p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))];
  for (const file of tsFiles) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(RE_T_CALL)) keys.add(unescapeLiteral(m[2]));
  }
  // HTML files at the extension root — popup.html / offscreen.html — and
  // any nested HTML the build picks up.
  const htmlFiles = [
    ...walk(ROOT, (p) => /\.html$/.test(p) && !p.includes('/dist/') && !p.includes('/node_modules/')),
  ];
  for (const file of htmlFiles) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(RE_DATA_I18N)) keys.add(unescapeLiteral(m[2]));
  }
  return [...keys].sort();
}

function loadBundle(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeBundle(path, bundle) {
  // Sort keys for deterministic diffs across runs.
  const sorted = Object.fromEntries(Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n');
}

function localeFiles() {
  // Source of truth is `apps/readest-app/i18n-langs.json` — make sure a
  // bundle file exists for every locale the main app ships. Create
  // missing ones as empty objects so the extractor's merge step
  // populates them on this run.
  if (!existsSync(LOCALES_DIR)) mkdirSync(LOCALES_DIR, { recursive: true });
  const codes = loadLangs();
  for (const code of codes) {
    const path = join(LOCALES_DIR, `${code}.json`);
    if (!existsSync(path)) writeFileSync(path, '{}\n');
  }
  return codes.map((code) => ({ code, path: join(LOCALES_DIR, `${code}.json`) }));
}

function chromeLocaleCode(code) {
  // Chrome's native i18n directories use underscore region separators
  // (`pt_BR`, `zh_CN`, `zh_TW`) while the app locale list uses BCP-47
  // (`pt-BR`, `zh-CN`, `zh-TW`).
  return code.replace(/-/g, '_');
}

/**
 * Mirror the locale list into Chrome's native `_locales/<lang>/messages.json`
 * so each locale carries the manifest-side translations (extension name,
 * description, action tooltip). Stubs use `__STRING_NOT_TRANSLATED__` —
 * Chrome falls back to `default_locale` on missing keys, so an unfilled
 * stub is harmless; the sentinel just makes the next translator's job
 * obvious. The en bundle is the canonical template for the schema (which
 * `description` annotations to keep).
 */
function seedChromeLocales() {
  const enPath = join(CHROME_LOCALES_DIR, 'en', 'messages.json');
  if (!existsSync(enPath)) return;
  const enBundle = JSON.parse(readFileSync(enPath, 'utf8'));
  const codes = loadLangs();
  for (const code of codes) {
    if (code === 'en') continue;
    const path = join(CHROME_LOCALES_DIR, chromeLocaleCode(code), 'messages.json');
    if (existsSync(path)) continue; // never overwrite a translated bundle
    const stub = {};
    for (const [key, entry] of Object.entries(enBundle)) {
      stub[key] = { ...entry, message: SENTINEL };
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(stub, null, 2) + '\n');
  }
}

/**
 * Regenerate the static-imports index so every bundle in `i18n-langs.json`
 * is reachable at runtime. The runtime helper imports from this file —
 * keeping the imports static means both webpack and vitest resolve them
 * without any glob / require.context plumbing.
 */
function writeIndex(codes) {
  const sorted = [...codes].sort();
  const importLines = sorted.map((c) => `import ${jsIdent(c)}Messages from './${c}.json';`);
  const mapEntries = sorted.map((c) => `  ${jsObjectKey(c)}: ${jsIdent(c)}Messages as Messages,`);
  const out = `// AUTO-GENERATED by \`pnpm i18n:extract\`. Do not edit by hand —
// re-run the extractor whenever a locale is added or removed in
// \`apps/readest-app/i18n-langs.json\`. The runtime in
// \`src/lib/i18n.ts\` reads the bundle map exported from this file.

type Messages = Record<string, string>;

${importLines.join('\n')}

export const bundles: Record<string, Messages> = {
${mapEntries.join('\n')}
};
`;
  writeFileSync(INDEX_FILE, out);
}

/** Turn `zh-CN` into `zhCN` — a valid JS identifier we can name imports
 *  after. Any non-alphanumeric becomes capitalised on the next letter. */
function jsIdent(code) {
  return code.replace(/[-_](\w)/g, (_m, c) => c.toUpperCase());
}

function jsObjectKey(code) {
  return /^[A-Za-z_$][\w$]*$/.test(code) ? code : `'${code}'`;
}

function main() {
  const check = process.argv.includes('--check');
  const keys = extract();
  console.log(`[i18n] extracted ${keys.length} unique source strings`);

  let untranslatedTotal = 0;
  let orphansTotal = 0;
  const localeList = localeFiles();

  // Regenerate the static-imports map so the runtime sees every locale
  // listed in i18n-langs.json, not just the ones a developer happened
  // to hand-add.
  writeIndex(localeList.map((l) => l.code));

  // Seed `_locales/<lang>/messages.json` stubs (Chrome native, manifest
  // fields). Existing translated bundles are never overwritten.
  seedChromeLocales();

  for (const { code, path } of localeList) {
    const bundle = loadBundle(path);
    const next = { ...bundle };

    // Add missing keys. en.json is intentionally `{}` — skip.
    if (code !== 'en') {
      for (const key of keys) {
        if (!(key in next)) next[key] = SENTINEL;
      }
    }

    // Report orphans (keys in the bundle that no longer appear in code).
    // We don't auto-delete — a translator may still want to fix them
    // before they vanish on the next pass.
    const codeKeys = new Set(keys);
    const orphans = Object.keys(next).filter((k) => !codeKeys.has(k));
    const untranslated = Object.entries(next).filter(([, v]) => v === SENTINEL).length;

    if (code !== 'en') {
      writeBundle(path, next);
    }
    untranslatedTotal += untranslated;
    orphansTotal += orphans.length;
    console.log(
      `[i18n] ${code}: ${Object.keys(next).length} keys, ` +
        `${untranslated} untranslated, ${orphans.length} orphan` +
        (orphans.length ? ` (${orphans.slice(0, 3).join(', ')}${orphans.length > 3 ? ', …' : ''})` : ''),
    );
  }

  if (check && untranslatedTotal > 0) {
    console.error(`[i18n] ${untranslatedTotal} untranslated entries — failing --check`);
    process.exit(1);
  }
  if (check && orphansTotal > 0) {
    console.error(`[i18n] ${orphansTotal} orphan entries — failing --check`);
    process.exit(1);
  }
}

main();
