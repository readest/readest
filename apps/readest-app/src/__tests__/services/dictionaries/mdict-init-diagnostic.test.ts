/**
 * Diagnostic + benchmark for js-mdict init on a real bundle.
 *
 * Drop your own large `.mdx` (rename to `mdict-en-en.mdx`) into
 * `src/__tests__/fixtures/data/dicts/` to reproduce the user-side hangs.
 * The test prints a structured report — read it; nothing here is a hard
 * regression guard.
 *
 * What we measure:
 *  - Total `MDX.create(blob)` time
 *  - Number of BlobScanner reads + total bytes read
 *  - Per-read latency (slowest 5)
 *  - Reads attributable to `_readKeyBlocks` (the upstream-flagged "very slow"
 *    eager step) — counted by clustering reads after the key-info read
 *  - Time + reads for a `mdx.lookup(headword)` call afterwards
 */
import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';

import { BlobScanner, MDX } from 'js-mdict';
import { readMdxFile, MDX_FIXTURE_PATH } from './_mdictFixtures';

interface ReadEvent {
  offset: number;
  length: number;
  durationMs: number;
  /** Phase tag set by the test harness (e.g. 'init' or 'lookup'). */
  phase: string;
}

class InstrumentedBlobScanner extends BlobScanner {
  reads: ReadEvent[] = [];
  totalBytesRead = 0;
  phase = 'init';

  override async readBuffer(offset: number | bigint, length: number): Promise<Uint8Array> {
    const start = performance.now();
    const result = await super.readBuffer(offset, length);
    const durationMs = performance.now() - start;
    this.reads.push({
      offset: typeof offset === 'bigint' ? Number(offset) : offset,
      length,
      durationMs,
      phase: this.phase,
    });
    this.totalBytesRead += length;
    return result;
  }
}

describe('mdict init diagnostic', () => {
  it('reports init read pattern + lookup cost on the shared fixture', async () => {
    const file = await readMdxFile();
    const scanner = new InstrumentedBlobScanner(file);

    // --- INIT ---
    const t0 = performance.now();
    const mdx = new MDX(scanner, file.name);
    await mdx.init();
    const initMs = performance.now() - t0;
    const initReads = scanner.reads.length;
    const initBytes = scanner.totalBytesRead;

    // --- LOOKUP ---
    scanner.phase = 'lookup';
    const before = scanner.reads.length;
    const beforeBytes = scanner.totalBytesRead;
    const tLookup = performance.now();
    const result = await mdx.lookup('abandon');
    const lookupMs = performance.now() - tLookup;
    const lookupReads = scanner.reads.length - before;
    const lookupBytes = scanner.totalBytesRead - beforeBytes;

    const slowest = [...scanner.reads]
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 5)
      .map((r) => ({
        offset: r.offset,
        length: r.length,
        durationMs: Math.round(r.durationMs * 100) / 100,
        phase: r.phase,
      }));

    console.log(
      JSON.stringify(
        {
          fixture: MDX_FIXTURE_PATH,
          fileSize: file.size,
          encrypt: mdx.meta.encrypt,
          version: mdx.meta.version,
          keywordCount: mdx.keywordList.length,
          init: {
            ms: Math.round(initMs * 100) / 100,
            reads: initReads,
            bytesRead: initBytes,
          },
          lookup: {
            word: 'abandon',
            found: !!result.definition,
            ms: Math.round(lookupMs * 100) / 100,
            reads: lookupReads,
            bytesRead: lookupBytes,
          },
          slowestReads: slowest,
        },
        null,
        2,
      ),
    );

    expect(initReads).toBeGreaterThan(0);
    expect(result.keyText).toBe('abandon');
  });
});
