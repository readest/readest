import { afterEach, describe, expect, it } from 'vitest';
import { validateNotebookMutation } from '@/app/reader/utils/notebookDocument';
import {
  createNotebookRecoveryEntry,
  writeNotebookRecovery,
} from '@/app/reader/utils/notebookRecovery';

const RECOVERY_KEY = 'readest:notebook-recovery:benchmark:book';

const percentile95 = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
};

const measureMutationPath = (bytes: number) => {
  const base = 'a'.repeat(bytes);
  const samples: number[] = [];
  for (let revision = 1; revision <= 50; revision += 1) {
    const content = `${base.slice(0, -1)}${revision % 10}`;
    const started = performance.now();
    expect(validateNotebookMutation(base, content).accepted).toBe(true);
    const entry = createNotebookRecoveryEntry({
      content,
      baseContent: base,
      baseUpdatedAt: 1,
      revision,
    });
    expect(writeNotebookRecovery(localStorage, RECOVERY_KEY, entry)).toBe(true);
    samples.push(performance.now() - started);
  }
  return samples;
};

afterEach(() => localStorage.removeItem(RECOVERY_KEY));

describe('Notebook synchronous mutation path (browser)', () => {
  it('stays within the approved latency budget at 10 KiB', () => {
    const samples = measureMutationPath(10 * 1024);
    expect(percentile95(samples)).toBeLessThan(16);
    expect(Math.max(...samples)).toBeLessThan(100);
  });

  it('stays within the approved latency budget at 256 KiB', () => {
    const samples = measureMutationPath(256 * 1024);
    expect(percentile95(samples)).toBeLessThan(50);
    expect(Math.max(...samples)).toBeLessThan(100);
  });
});
