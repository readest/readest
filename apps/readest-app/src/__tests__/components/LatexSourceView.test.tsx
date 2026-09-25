import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sidecar = {
  version: 1 as const,
  title: '紧致性笔记',
  sourceFile: 'compactness.tex',
  rawSource: '\\begin{theorem}紧致性定理\\end{theorem}',
  pdf: { name: 'compactness.pdf', contentHash: 'pdf-hash' },
  source: { name: 'compactness.tex', contentHash: 'tex-hash' },
  mapping: { quality: 'page' as const, reason: '未提供 SyncTeX 映射文件' },
  createdAt: 1,
  blocks: [
    {
      id: 'theorem-1',
      kind: 'theorem' as const,
      label: '定理',
      semanticText: '紧致性定理',
      sourceText: '\\begin{theorem}紧致性定理\\end{theorem}',
      sourceFile: 'compactness.tex',
      startLine: 1,
      endLine: 1,
      locationQuality: 'page' as const,
    },
  ],
};

const appService = {
  exists: vi.fn(async () => true),
  readFile: vi.fn(async () => JSON.stringify(sidecar)),
};

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (state: object) => unknown) =>
    selector({ getBookData: () => ({ book: { hash: 'book-hash', format: 'PDF' } }) }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { aiSettings: { enabled: false } } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/app/reader/utils/mobileLayout', () => ({
  isForcedMobileLayout: () => false,
}));

import LatexSourceView from '@/app/reader/components/sidebar/LatexSourceView';
import TabNavigation from '@/app/reader/components/sidebar/TabNavigation';

describe('LaTeX source sidebar', () => {
  afterEach(cleanup);

  it('shows the source tab only for a paired PDF', () => {
    const { rerender } = render(
      <TabNavigation activeTab='toc' onTabChange={vi.fn()} hasLatexSource />,
    );
    expect(screen.getByRole('button', { name: '原文' })).not.toBeNull();

    rerender(<TabNavigation activeTab='toc' onTabChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '原文' })).toBeNull();
  });

  it('loads paired source and expands the original TeX', async () => {
    render(<LatexSourceView bookKey='book-hash' />);

    expect(await screen.findByText('紧致性笔记')).not.toBeNull();
    expect(screen.getByText(/当前为页级关联/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看原文' }));
    expect(screen.getByText('\\begin{theorem}紧致性定理\\end{theorem}')).not.toBeNull();
  });
});
