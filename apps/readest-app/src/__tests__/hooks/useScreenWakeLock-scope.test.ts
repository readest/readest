import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { relative, resolve } from 'path';

/**
 * Regression guard for issue #5104 ("Keep Screen Awake" outside the reader).
 *
 * The setting is meant to hold the screen awake while reading. The library page
 * used to acquire the wake lock too, so a device parked on the home screen — or
 * on any library menu — never slept.
 *
 * Invariant: the reader is the only place that acquires the wake lock. Any new
 * call site outside `src/app/reader/` re-opens the bug.
 */
const SRC = resolve(process.cwd(), 'src');

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

describe('screen wake lock scope', () => {
  const callSites = walk(SRC)
    .filter((path) => !path.endsWith('hooks/useScreenWakeLock.ts'))
    .filter((path) => /useScreenWakeLock\(/.test(readFileSync(path, 'utf8')))
    .map((path) => relative(SRC, path));

  it('is acquired while reading', () => {
    expect(callSites).toContain('app/reader/components/Reader.tsx');
  });

  it('is not acquired outside the reader', () => {
    expect(callSites.filter((path) => !path.startsWith('app/reader/'))).toEqual([]);
  });
});
