import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  save: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: mocks.writeFile }));

import {
  cancelLocalLatex,
  compileLocalLatex,
  detectLocalLatexEngines,
  saveLocalLatexOutput,
} from '@/services/localLatex';

beforeEach(() => vi.clearAllMocks());

describe('local LaTeX desktop bridge', () => {
  it('uses only the narrow native commands', async () => {
    mocks.invoke.mockResolvedValue([]);
    await detectLocalLatexEngines();
    await compileLocalLatex('job-id', 'pdflatex', 'source');
    await cancelLocalLatex('job-id');

    expect(mocks.invoke.mock.calls).toEqual([
      ['detect_latex_engines'],
      ['compile_latex_source', { jobId: 'job-id', engine: 'pdflatex', source: 'source' }],
      ['cancel_latex_compile', { jobId: 'job-id' }],
    ]);
  });

  it('writes a user-selected generated file without changing the current book', async () => {
    mocks.save.mockResolvedValue('/chosen/paper.pdf');
    await saveLocalLatexOutput('pdf', 'paper.tex', btoa('%PDF'));

    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'paper.pdf' }));
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/chosen/paper.pdf',
      Uint8Array.from([37, 80, 68, 70]),
    );
  });
});
