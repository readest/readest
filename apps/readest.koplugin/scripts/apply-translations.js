#!/usr/bin/env node
/**
 * One-shot applier: reads /tmp/koplugin-translations/<lang>.json and fills
 * empty msgstrs in locales/<lang>/translation.po. Existing translations are
 * never overwritten (only `msgstr ""` lines are replaced).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LOCALES_DIR = path.resolve(__dirname, '..', 'locales');
const DATA_DIR = '/tmp/koplugin-translations';

function escapePo(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
}

function applyOne(lang, dict) {
  const filePath = path.join(LOCALES_DIR, lang, 'translation.po');
  if (!fs.existsSync(filePath)) {
    console.warn(`  ${lang.padEnd(6)} skipped (no .po file)`);
    return;
  }
  let text = fs.readFileSync(filePath, 'utf-8');
  let filled = 0;
  let already = 0;
  for (const [msgid, msgstr] of Object.entries(dict)) {
    if (!msgstr) continue;
    const idEsc = escapePo(msgid);
    const strEsc = escapePo(msgstr);
    const target = `msgid "${idEsc}"\nmsgstr ""`;
    const replacement = `msgid "${idEsc}"\nmsgstr "${strEsc}"`;
    if (text.includes(target)) {
      text = text.replace(target, replacement);
      filled++;
    } else {
      already++;
    }
  }
  fs.writeFileSync(filePath, text);
  console.log(`  ${lang.padEnd(6)} +${filled}  (${already} already set or absent)`);
}

const files = fs.existsSync(DATA_DIR)
  ? fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
  : [];
if (files.length === 0) {
  console.error(`No translation JSON files in ${DATA_DIR}`);
  process.exit(1);
}
for (const file of files) {
  const lang = file.replace(/\.json$/, '');
  const dict = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
  applyOne(lang, dict);
}
