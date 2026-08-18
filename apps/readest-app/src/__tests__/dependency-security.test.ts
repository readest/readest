import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { satisfies } from 'semver';
import { describe, expect, it } from 'vitest';

const lockfile = readFileSync(
  resolve(import.meta.dirname, '../../../..', 'pnpm-lock.yaml'),
  'utf8',
);

const resolvedVersions = (packageName: string) => {
  const prefix = `${packageName}@`;
  const versions = lockfile
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith(':'))
    .map((line) => line.replace(/^'/, '').replace(/':$/, '').replace(/:$/, ''))
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => entry.slice(prefix.length).split('(')[0]!);

  return [...new Set(versions)];
};

describe('dependency security constraints', () => {
  it.each([
    ['deepmerge-ts', '>=8.0.1'],
    ['nanoid', '>=3.3.18 <4 || >=5.1.16'],
    ['dompurify', '>=3.4.13'],
    ['pdfjs-dist', '>=6.2.108'],
    ['js-yaml', '>=4.3.1'],
    ['mermaid', '>=11.16.1 <12'],
    ['@ai-sdk/provider-utils', '>=4'],
  ])('resolves %s outside its vulnerable range', (packageName, safeRange) => {
    const versions = resolvedVersions(packageName);

    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every((version) => satisfies(version, safeRange))).toBe(true);
  });

  it('does not install unpatched extract-zip releases', () => {
    expect(resolvedVersions('extract-zip')).toEqual([]);
  });
});
