// Guards the e-ink device identity whitelist against cross-repo drift.
//
// The whitelist lives twice: as the Rust source of truth in
// src-tauri/src/eink_identity.rs (driving the host app's e-ink device
// paths) and as the Kotlin port inside the tauri-plugin-webview-upgrade
// submodule (driving the plugin's night-mode pin, readest/
// tauri-plugin-webview-upgrade#4). The two must classify devices
// identically; this script fails CI whenever one side changes without the
// other.
import { readFileSync } from 'node:fs';

const RUST_PATH = 'apps/readest-app/src-tauri/src/eink_identity.rs';
const KOTLIN_PATH =
  'apps/readest-app/src-tauri/plugins/tauri-plugin-webview-upgrade/android/src/main/java/com/readest/webview_upgrade/EinkIdentity.kt';

const LISTS = ['EINK_MANUFACTURERS', 'EINK_MODELS', 'EINK_AMBIGUOUS_MODELS'];

function quotedStrings(block) {
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function extractRustList(source, name) {
  const match = source.match(new RegExp(`${name}\\s*:\\s*&\\[&str\\]\\s*=\\s*&\\[([\\s\\S]*?)\\]`));
  if (!match) throw new Error(`list "${name}" not found in ${RUST_PATH}`);
  return quotedStrings(match[1]);
}

function extractKotlinList(source, name) {
  // Two layouts exist: the multi-line form whose entry comments may contain
  // parens (so the closing paren is anchored to a line start — a non-greedy
  // match to the next ")" would truncate at a comment), and the one-line
  // form `listOf("a9", "nova")`.
  const multi = source.match(new RegExp(`\\b${name}\\s*=\\s*listOf\\(([\\s\\S]*?\\n)\\)`));
  const single = multi ? null : source.match(new RegExp(`\\b${name}\\s*=\\s*listOf\\(([^)\\n]*)\\)`));
  const match = multi ?? single;
  if (!match) throw new Error(`list "${name}" not found in ${KOTLIN_PATH}`);
  return quotedStrings(match[1]);
}

function drift(rust, kotlin) {
  return [
    ...rust.filter((entry) => !kotlin.includes(entry)).map((entry) => `rust-only: "${entry}"`),
    ...kotlin.filter((entry) => !rust.includes(entry)).map((entry) => `kotlin-only: "${entry}"`),
  ];
}

let failed = false;
const rust = readFileSync(RUST_PATH, 'utf8');
const kotlin = readFileSync(KOTLIN_PATH, 'utf8');

for (const name of LISTS) {
  const rustList = extractRustList(rust, name);
  const kotlinList = extractKotlinList(kotlin, name);
  const differences = drift(rustList, kotlinList);
  if (differences.length > 0) {
    failed = true;
    console.error(`${name} drifted between Rust and Kotlin:`);
    for (const difference of differences) console.error(`  ${difference}`);
  } else {
    console.log(`${name}: ${rustList.length} entries in sync`);
  }
}

if (failed) {
  console.error(`\nSync ${KOTLIN_PATH} with ${RUST_PATH} (or open the PRs in both repos).`);
  process.exit(1);
}
