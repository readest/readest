import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';

/**
 * Regression guard for a build-packaging bug (scanned PDFs rendered blank in
 * CI builds of 0.11.2, but fine locally).
 *
 * pdfjs-dist 5.7.x moved several image decoders (notably JBIG2 — the codec used
 * by virtually every black-and-white *scanned* PDF) from pure JS into
 * WebAssembly modules that the worker fetches at runtime from `wasmUrl`
 * (`/vendor/pdfjs/` — see packages/foliate-js/pdf.js).  The `copy-pdfjs-wasm`
 * npm script only copied an explicit allow-list (`openjpeg.wasm`, `qcms_bg.wasm`)
 * and silently dropped `jbig2.wasm`.  `cpx` does not error when a glob matches
 * nothing, so the missing decoder went unnoticed: the worker loaded, pages
 * turned, but JBIG2 image decoding failed → blank pages.
 *
 * Invariant: every `.wasm` file the *bundled* pdf.js (main + worker) references
 * and that actually exists in pdfjs-dist's `wasm/` directory must be copied into
 * the public vendor folder by `copy-pdfjs-wasm`.
 */

const appRoot = process.cwd();

/** Extract the first double-quoted argument from a cpx-based npm script. */
const sourceGlobOf = (script: string): string => {
  const match = script.match(/"([^"]+)"/);
  if (!match) throw new Error(`No quoted source glob in script: ${script}`);
  return match[1]!;
};

/**
 * Resolve which files a cpx source glob of the form `<dir>/<token>` copies,
 * where `<token>` is `*`, a `{a,b,c}` brace list, or a single filename.
 * Returns the absolute directory and the concrete set of copied basenames.
 */
const resolveCpxGlob = (glob: string): { dir: string; files: Set<string> } => {
  const slash = glob.lastIndexOf('/');
  const dirPart = glob.slice(0, slash);
  const token = glob.slice(slash + 1);
  const dir = isAbsolute(dirPart) ? dirPart : resolve(appRoot, dirPart);

  let names: string[];
  if (token.includes('*')) {
    names = readdirSync(dir);
  } else if (token.startsWith('{') && token.endsWith('}')) {
    names = token.slice(1, -1).split(',');
  } else {
    names = [token];
  }
  return { dir, files: new Set(names) };
};

describe('pdfjs vendor wasm assets', () => {
  const pkg = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('copies every wasm decoder the bundled pdf.js references', () => {
    // Files the worker/main bundle are copied from (source of truth for CI).
    const jsGlob = sourceGlobOf(pkg.scripts['copy-pdfjs-js']!);
    const { dir: jsDir, files: jsFiles } = resolveCpxGlob(jsGlob);

    // The wasm modules available in pdfjs-dist and what the copy script ships.
    const wasmGlob = sourceGlobOf(pkg.scripts['copy-pdfjs-wasm']!);
    const { dir: wasmDir, files: copiedWasm } = resolveCpxGlob(wasmGlob);

    const availableWasm = new Set(readdirSync(wasmDir).filter((f) => f.endsWith('.wasm')));

    // Scan the bundled JS for `*.wasm` references, keeping only ones that map to
    // a real file (drops minified false positives like `e.wasm`/`t.wasm`).
    const referenced = new Set<string>();
    for (const file of jsFiles) {
      const full = resolve(jsDir, file);
      if (!existsSync(full)) continue;
      const text = readFileSync(full, 'utf8');
      for (const m of text.matchAll(/[A-Za-z0-9_-]+\.wasm/g)) {
        if (availableWasm.has(m[0])) referenced.add(m[0]);
      }
    }

    // Sanity: the bump that caused the bug must still ship jbig2 as wasm.
    expect(referenced.has('jbig2.wasm'), 'expected pdf.js to reference jbig2.wasm').toBe(true);

    const missing = [...referenced].filter((w) => !copiedWasm.has(w));
    expect(missing, `copy-pdfjs-wasm must copy these referenced wasm files: ${missing}`).toEqual(
      [],
    );
  });
});
