import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// Import the real exported helpers from the .mjs build script (vitest/vite can
// import ESM .mjs directly), so the test exercises the actual logic.
import {
  stripSourceMappingComment as stripSourceMappingCommentUntyped,
  stripMaps as stripMapsUntyped,
} from '../../../scripts/upload-sourcemaps.mjs';

const stripSourceMappingComment = stripSourceMappingCommentUntyped as (code: string) => string;
const stripMaps = stripMapsUntyped as (dir: string) => number;

describe('stripSourceMappingComment', () => {
  it('drops the trailing sourceMappingURL comment Turbopack appends', () => {
    const code = 'console.log(1);\n\n//# sourceMappingURL=2o75p8sdyycvy.js.map\n';
    expect(stripSourceMappingComment(code)).toBe('console.log(1);\n\n');
  });

  it('keeps the sentry-cli debugId comment', () => {
    const code = 'console.log(1);\n//# sourceMappingURL=a.js.map\n//# debugId=abc-123\n';
    expect(stripSourceMappingComment(code)).toBe('console.log(1);\n//# debugId=abc-123\n');
  });

  it('leaves code without a sourceMappingURL comment untouched', () => {
    const code = 'console.log(1);\n';
    expect(stripSourceMappingComment(code)).toBe(code);
  });
});

describe('stripMaps', () => {
  it('removes .js.map files and the dangling comments, recursively', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'strip-maps-'));
    const chunks = path.join(dir, 'chunks');
    mkdirSync(chunks);
    // Turbopack names the map after a different hash than the chunk, so the
    // comment cannot be matched to a chunk by file name.
    writeFileSync(path.join(chunks, 'aaa.js'), 'a();\n\n//# sourceMappingURL=zzz.js.map\n');
    writeFileSync(path.join(chunks, 'zzz.js.map'), '{"version":3}');
    writeFileSync(path.join(dir, 'bbb.js'), 'b();\n\n//# sourceMappingURL=yyy.js.map\n');
    writeFileSync(path.join(dir, 'yyy.js.map'), '{"version":3}');

    expect(stripMaps(dir)).toBe(2);
    expect(readdirSync(chunks)).toEqual(['aaa.js']);
    expect(readdirSync(dir).sort()).toEqual(['bbb.js', 'chunks']);
    expect(readFileSync(path.join(chunks, 'aaa.js'), 'utf8')).toBe('a();\n\n');
    expect(readFileSync(path.join(dir, 'bbb.js'), 'utf8')).toBe('b();\n\n');
  });

  it('returns 0 for a missing directory', () => {
    expect(stripMaps(path.join(tmpdir(), 'strip-maps-does-not-exist'))).toBe(0);
  });
});
