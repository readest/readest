import { describe, expect, it } from 'vitest';

import {
  createLatexSourceSidecar,
  pairLatexImports,
  parseLatexSource,
} from '@/services/foundation/latexSource';

const SOURCE = String.raw`\documentclass{article}
\title{紧致性笔记}
\begin{document}
\section{极值定理}
连续函数在紧致集上取得最大值。
\begin{theorem}\label{thm:max}
若 $K$ 紧致且 $f$ 连续，则 $f$ 在 $K$ 上取得最大值。
\end{theorem}
\begin{proof}
取极大化序列并抽取收敛子列。
\end{proof}
\[
  f(x_*) = \max_{x \in K} f(x).
\]
\end{document}`;

describe('LaTeX source sidecar', () => {
  it('extracts ordinary reading structures without compiling TeX', () => {
    const parsed = parseLatexSource('compactness.tex', SOURCE);

    expect(parsed.title).toBe('紧致性笔记');
    expect(parsed.blocks.map((block) => block.kind)).toEqual(
      expect.arrayContaining(['section', 'paragraph', 'theorem', 'proof', 'formula']),
    );
    expect(parsed.blocks.find((block) => block.kind === 'theorem')).toMatchObject({
      label: '定理',
      sourceFile: 'compactness.tex',
      locationQuality: 'page',
    });
    expect(parsed.blocks.find((block) => block.kind === 'formula')?.semanticText).toContain('max');
  });

  it('stores PDF and source hashes separately and never claims precise mapping', async () => {
    const pdf = new File(['%PDF-test'], 'compactness.pdf', { type: 'application/pdf' });
    const tex = new File([SOURCE], 'compactness.tex', { type: 'application/x-tex' });
    const sidecar = await createLatexSourceSidecar(pdf, tex);

    expect(sidecar.pdf.name).toBe('compactness.pdf');
    expect(sidecar.source.name).toBe('compactness.tex');
    expect(sidecar.pdf.contentHash).not.toBe(sidecar.source.contentHash);
    expect(sidecar.mapping).toEqual({ quality: 'page', reason: '未提供 SyncTeX 映射文件' });
  });

  it('pairs same-named PDF and TeX files while leaving the PDF importable', () => {
    const files = ['Compactness.PDF', 'compactness.tex', 'notes.epub'];
    const result = pairLatexImports(files, (filename) => filename);

    expect(result.importableFiles).toEqual(['Compactness.PDF', 'notes.epub']);
    expect(result.latexSources.get('compactness')).toBe('compactness.tex');
    expect(result.unpairedLatexSources).toEqual([]);
  });

  it('reports standalone or differently named TeX files as unpaired', () => {
    const files = ['compactness.pdf', 'proof.tex', 'standalone.tex'];
    const result = pairLatexImports(files, (filename) => filename);

    expect(result.importableFiles).toEqual(['compactness.pdf']);
    expect(result.unpairedLatexSources).toEqual(['proof.tex', 'standalone.tex']);
  });
});
