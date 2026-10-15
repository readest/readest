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

/** Extract the quoted, non-empty entries from a captured list block. */
function quotedStrings(block) {
  // Strip // line comments first: a commented-out entry ("onyx",) must not
  // count as active on one side while still active on the other.
  const active = block.replace(/\/\/.*$/gm, '');
  return [...active.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/** Extract one `NAME: &[&str] = &[...]` whitelist from the Rust source. */
function extractRustList(source, name) {
  // Two layouts: the multi-line form (opening delimiter followed by a
  // newline; entry comments may contain brackets, so the closing bracket is
  // anchored to a line start) and the one-line form `&["a9", "nova"]`.
  // Anchoring the opening delimiter keeps a multi-line match from starting
  // at a completed single-line declaration.
  const multi = source.match(
    new RegExp(`${name}\\s*:\\s*&\\[&str\\]\\s*=\\s*&\\[\\r?\\n([\\s\\S]*?)\\r?\\n\\]`),
  );
  const single =
    multi ? null : source.match(new RegExp(`${name}\\s*:\\s*&\\[&str\\]\\s*=\\s*&\\[([^\\]\\n]*)\\]`));
  const match = multi ?? single;
  if (!match) throw new Error(`list "${name}" not found in ${RUST_PATH}`);
  return quotedStrings(match[1]);
}

/** Extract one `NAME = listOf(...)` whitelist from the Kotlin port. */
function extractKotlinList(source, name) {
  // Same anchoring as the Rust extractor, with parens instead of brackets.
  const multi = source.match(new RegExp(`\\b${name}\\s*=\\s*listOf\\(\\r?\\n([\\s\\S]*?)\\r?\\n\\)`));
  const single = multi ? null : source.match(new RegExp(`\\b${name}\\s*=\\s*listOf\\(([^)\\n]*)\\)`));
  const match = multi ?? single;
  if (!match) throw new Error(`list "${name}" not found in ${KOTLIN_PATH}`);
  return quotedStrings(match[1]);
}

/** Entries present on only one side, labeled `rust-only` / `kotlin-only`. */
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
