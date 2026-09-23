import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Tauri embeds every file under `out/` into the app binary, and `public/` is
// copied there wholesale. So a module that is ALSO imported through a path
// alias ships twice: once bundled into a chunk, once as a published file
// nobody fetches. jieba cost 2.7MB that way (#6368).
//
// The rule: an alias used at build time resolves outside `public/`. Only files
// fetched by URL at runtime belong in `public/vendor`.
const appDir = path.resolve(import.meta.dirname, '../..');
const readJson = (file: string) =>
  JSON.parse(readFileSync(path.join(appDir, file), 'utf8').replace(/^\s*\/\/.*$/gm, ''));

describe('vendored build-time modules live outside public/', () => {
  test('no tsconfig path alias resolves into public/', () => {
    const paths: Record<string, string[]> = readJson('tsconfig.json').compilerOptions.paths;
    const inPublic = Object.entries(paths)
      .filter(([, targets]) => targets.some((t) => t.replace(/^\.\//, '').startsWith('public/')))
      .map(([alias]) => alias);

    expect(inPublic).toEqual([]);
  });

  test('pdf.js and simplecc are vendored for the bundler, not published', () => {
    expect(existsSync(path.join(appDir, 'vendor/pdfjs/pdf.min.mjs'))).toBe(true);
    expect(existsSync(path.join(appDir, 'public/vendor/pdfjs/pdf.min.mjs'))).toBe(false);
    expect(existsSync(path.join(appDir, 'vendor/simplecc/simplecc_wasm_bg.wasm'))).toBe(true);
    expect(existsSync(path.join(appDir, 'public/vendor/simplecc'))).toBe(false);
  });

  test('what the reader fetches by URL stays published', () => {
    // foliate-js/pdf.js builds these URLs at runtime, so the bundler never
    // sees a specifier for them and cannot emit a copy.
    for (const f of ['pdf.worker.min.mjs', 'openjpeg.wasm', 'text_layer_builder.css']) {
      expect(existsSync(path.join(appDir, 'public/vendor/pdfjs', f))).toBe(true);
    }
  });
});
