import { describe, expect, it, vi } from 'vitest';

import {
  latexSourcePath,
  loadLatexSource,
  pairLatexImports,
  saveLatexSource,
} from '@/services/latexSource';

const book = { hash: 'book-hash' } as never;

describe('LaTeX source association', () => {
  it('stores the original source as a book sidecar', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const appService = { writeFile } as never;
    const source = new File(['\\section{Result}\nBody'], 'paper.tex', {
      type: 'application/x-tex',
    });

    const saved = await saveLatexSource(appService, book, source);

    expect(saved).toMatchObject({ version: 1, sourceName: 'paper.tex' });
    expect(saved.rawSource).toBe('\\section{Result}\nBody');
    expect(writeFile).toHaveBeenCalledWith(
      'book-hash/latex-source.json',
      'Books',
      JSON.stringify(saved),
    );
  });

  it('loads a valid sidecar and rejects malformed data', async () => {
    const valid = { version: 1, sourceName: 'paper.tex', rawSource: 'source', createdAt: 1 };
    const appService = {
      exists: vi.fn().mockResolvedValue(true),
      readFile: vi
        .fn()
        .mockResolvedValueOnce(JSON.stringify(valid))
        .mockResolvedValueOnce('{bad json'),
    } as never;

    await expect(loadLatexSource(appService, book)).resolves.toEqual(valid);
    await expect(loadLatexSource(appService, book)).resolves.toBeNull();
    expect(latexSourcePath(book)).toBe('book-hash/latex-source.json');
  });

  it('pairs a same-named PDF and TeX without importing TeX as a book', () => {
    const result = pairLatexImports(['Paper.PDF', 'paper.tex', 'notes.epub'], (name) => name);

    expect(result.importableFiles).toEqual(['Paper.PDF', 'notes.epub']);
    expect(result.sources.get('paper')).toBe('paper.tex');
    expect(result.unpairedSources).toEqual([]);
  });

  it('reports a standalone or differently named TeX source', () => {
    const result = pairLatexImports(['paper.pdf', 'proof.tex'], (name) => name);

    expect(result.importableFiles).toEqual(['paper.pdf']);
    expect(result.unpairedSources).toEqual(['proof.tex']);
  });
});
