// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dockerfile = readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');

describe('Docker image build', () => {
  /**
   * @serwist/next only writes the service worker (`public/sw.js`) from a
   * webpack build, and `next build` uses Turbopack by default. Built with plain
   * `pnpm build-web`, the image has no service worker, so the self-hosted web
   * app can't load offline or work as an offline PWA.
   */
  test('builds the web app with webpack so the image has a service worker', () => {
    const buildWeb = dockerfile
      .replace(/\\\n\s*/g, '')
      .split('\n')
      .find((line) => line.startsWith('RUN ') && line.includes('pnpm build-web'));

    expect(buildWeb, 'the Dockerfile builds the web app').toBeDefined();
    expect(buildWeb).toMatch(/^RUN pnpm patch-build-webpack && /);
  });
});
