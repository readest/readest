#!/usr/bin/env node
/**
 * Extract translatable strings from readest.koplugin Lua sources and update
 * locales/<lang>/translation.po for every language listed in the readest-app
 * i18next-scanner config.
 *
 * Mirrors the role of `pnpm i18n:extract` (i18next-scanner) on the JS side:
 * new msgids are appended with empty msgstr, obsolete msgids are dropped, and
 * existing translations are preserved.
 *
 * Run with: node scripts/extract-i18n.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PLUGIN_DIR = path.resolve(__dirname, '..');
const SCANNER_CONFIG = path.resolve(PLUGIN_DIR, '../readest-app/i18next-scanner.config.cjs');
const LOCALES_DIR = path.join(PLUGIN_DIR, 'locales');
const PO_FILENAME = 'translation.po';

// Per-language metadata for .po headers. Plural-Forms follow CLDR conventions.
const LANG_META = {
  de: { label: 'German', plural: 'nplurals=2; plural=(n != 1);' },
  ja: { label: 'Japanese', plural: 'nplurals=1; plural=0;' },
  es: { label: 'Spanish', plural: 'nplurals=2; plural=(n != 1);' },
  fa: { label: 'Persian', plural: 'nplurals=2; plural=(n > 1);' },
  fr: { label: 'French', plural: 'nplurals=2; plural=(n > 1);' },
  it: { label: 'Italian', plural: 'nplurals=2; plural=(n != 1);' },
  el: { label: 'Greek', plural: 'nplurals=2; plural=(n != 1);' },
  ko: { label: 'Korean', plural: 'nplurals=1; plural=0;' },
  uk: {
    label: 'Ukrainian',
    plural:
      'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
  },
  nl: { label: 'Dutch', plural: 'nplurals=2; plural=(n != 1);' },
  sl: {
    label: 'Slovenian',
    plural: 'nplurals=4; plural=(n%100==1 ? 0 : n%100==2 ? 1 : n%100==3 || n%100==4 ? 2 : 3);',
  },
  sv: { label: 'Swedish', plural: 'nplurals=2; plural=(n != 1);' },
  pl: {
    label: 'Polish',
    plural:
      'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
  },
  pt: { label: 'Portuguese', plural: 'nplurals=2; plural=(n != 1);' },
  'pt-BR': { label: 'Portuguese (Brazil)', plural: 'nplurals=2; plural=(n != 1);' },
  ru: {
    label: 'Russian',
    plural:
      'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
  },
  tr: { label: 'Turkish', plural: 'nplurals=2; plural=(n > 1);' },
  hi: { label: 'Hindi', plural: 'nplurals=2; plural=(n != 1);' },
  id: { label: 'Indonesian', plural: 'nplurals=1; plural=0;' },
  vi: { label: 'Vietnamese', plural: 'nplurals=1; plural=0;' },
  ms: { label: 'Malay', plural: 'nplurals=1; plural=0;' },
  he: { label: 'Hebrew', plural: 'nplurals=2; plural=(n != 1);' },
  ar: {
    label: 'Arabic',
    plural:
      'nplurals=6; plural=(n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : n%100>=11 ? 4 : 5);',
  },
  th: { label: 'Thai', plural: 'nplurals=1; plural=0;' },
  bo: { label: 'Tibetan', plural: 'nplurals=1; plural=0;' },
  bn: { label: 'Bengali', plural: 'nplurals=2; plural=(n != 1);' },
  ta: { label: 'Tamil', plural: 'nplurals=2; plural=(n != 1);' },
  si: { label: 'Sinhala', plural: 'nplurals=2; plural=(n != 1);' },
  'zh-CN': { label: 'Chinese (Simplified)', plural: 'nplurals=1; plural=0;' },
  'zh-TW': { label: 'Chinese (Traditional)', plural: 'nplurals=1; plural=0;' },
  ro: {
    label: 'Romanian',
    plural: 'nplurals=3; plural=(n==1 ? 0 : (n==0 || (n%100 > 0 && n%100 < 20)) ? 1 : 2);',
  },
  hu: { label: 'Hungarian', plural: 'nplurals=2; plural=(n != 1);' },
  uz: { label: 'Uzbek', plural: 'nplurals=2; plural=(n != 1);' },
  ka: { label: 'Georgian', plural: 'nplurals=2; plural=(n != 1);' },
};

// ---------------------------------------------------------------------------
// Lua source extraction
// ---------------------------------------------------------------------------

const LUA_ESCAPES = {
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  '"': '"',
  "'": "'",
};

function luaUnescape(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      if (LUA_ESCAPES[next] !== undefined) {
        out += LUA_ESCAPES[next];
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}

// _("..."), allowing escaped quotes inside.
const STRING_CALL_RE = /_\(\s*"((?:[^"\\]|\\.)*)"\s*[\),]/g;
// _([[ ... ]]) for long-bracket strings (no escapes - Lua treats them literally).
const BRACKET_CALL_RE = /_\(\s*\[\[([\s\S]*?)\]\]\s*\)/g;

// Recursively collect all *.lua files under PLUGIN_DIR. Skips dotfiles/dirs
// (e.g. .busted) and the spec/ tree so test-only msgids don't pollute the
// shipped catalog.
function collectLuaFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'spec') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectLuaFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.lua')) {
      out.push(full);
    }
  }
  return out;
}

function extractMsgids() {
  const files = collectLuaFiles(PLUGIN_DIR).sort();
  const seen = new Map(); // preserves first-seen order
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const m of text.matchAll(STRING_CALL_RE)) {
      const id = luaUnescape(m[1]);
      if (id && !seen.has(id)) seen.set(id, true);
    }
    for (const m of text.matchAll(BRACKET_CALL_RE)) {
      // Long brackets ignore one immediately-following newline.
      let id = m[1];
      if (id.startsWith('\n')) id = id.slice(1);
      else if (id.startsWith('\r\n')) id = id.slice(2);
      if (id && !seen.has(id)) seen.set(id, true);
    }
  }
  return [...seen.keys()];
}

// ---------------------------------------------------------------------------
// .po parser - returns msgid -> msgstr (single-form entries only).
// ---------------------------------------------------------------------------

function unescapePo(s) {
  return s.replace(/\\([\\nrt"])/g, (_, c) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c,
  );
}

function parsePo(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const text = fs.readFileSync(filePath, 'utf-8');
  const out = new Map();
  let msgid = null;
  let msgstr = null;
  let current = null;

  const flush = () => {
    if (msgid !== null && msgstr !== null && msgid !== '' && msgstr !== '') {
      out.set(msgid, msgstr);
    }
    msgid = null;
    msgstr = null;
    current = null;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('#')) continue;

    let m = /^\s*msgid\s+"(.*)"\s*$/.exec(line);
    if (m) {
      flush();
      msgid = unescapePo(m[1]);
      msgstr = null;
      current = 'msgid';
      continue;
    }
    m = /^\s*msgstr\s+"(.*)"\s*$/.exec(line);
    if (m) {
      msgstr = unescapePo(m[1]);
      current = 'msgstr';
      continue;
    }
    m = /^\s*"(.*)"\s*$/.exec(line);
    if (m && current) {
      const piece = unescapePo(m[1]);
      if (current === 'msgid') msgid = (msgid ?? '') + piece;
      else if (current === 'msgstr') msgstr = (msgstr ?? '') + piece;
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// .po writer
// ---------------------------------------------------------------------------

function escapePo(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
}

function writePo(filePath, lang, msgids, translations) {
  const meta = LANG_META[lang];
  if (!meta) throw new Error(`No metadata for language: ${lang}`);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const lines = [];
  lines.push(`# ${meta.label} translation for readest.koplugin`);
  lines.push('#');
  lines.push('msgid ""');
  lines.push('msgstr ""');
  lines.push('"Project-Id-Version: readest.koplugin\\n"');
  lines.push('"Last-Translator: Readest contributors\\n"');
  lines.push(`"Language-Team: ${meta.label}\\n"`);
  lines.push(`"Language: ${lang}\\n"`);
  lines.push('"MIME-Version: 1.0\\n"');
  lines.push('"Content-Type: text/plain; charset=UTF-8\\n"');
  lines.push('"Content-Transfer-Encoding: 8bit\\n"');
  lines.push(`"Plural-Forms: ${meta.plural}\\n"`);
  lines.push('');

  for (const msgid of msgids) {
    const msgstr = translations.get(msgid) ?? '';
    lines.push(`msgid "${escapePo(msgid)}"`);
    lines.push(`msgstr "${escapePo(msgstr)}"`);
    lines.push('');
  }

  fs.writeFileSync(filePath, lines.join('\n'));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const scannerConfig = require(SCANNER_CONFIG);
  const languages = scannerConfig?.options?.lngs;
  if (!Array.isArray(languages) || languages.length === 0) {
    throw new Error(`Could not read 'options.lngs' from ${SCANNER_CONFIG}`);
  }

  const msgids = extractMsgids();
  console.log(`Extracted ${msgids.length} unique msgids from ${PLUGIN_DIR}`);

  for (const lang of languages) {
    if (!LANG_META[lang]) {
      console.warn(`  ${lang.padEnd(6)} skipped (no metadata in extract-i18n.js)`);
      continue;
    }
    const filePath = path.join(LOCALES_DIR, lang, PO_FILENAME);
    const existing = parsePo(filePath);
    const translations = new Map();
    let kept = 0;
    for (const msgid of msgids) {
      const prev = existing.get(msgid);
      if (prev !== undefined) {
        translations.set(msgid, prev);
        kept++;
      } else {
        translations.set(msgid, '');
      }
    }
    const dropped = [...existing.keys()].filter((m) => !translations.has(m)).length;
    writePo(filePath, lang, msgids, translations);
    console.log(
      `  ${lang.padEnd(6)} ${String(kept).padStart(3)}/${msgids.length}` +
        (dropped > 0 ? `  (-${dropped} obsolete)` : ''),
    );
  }
}

main();
