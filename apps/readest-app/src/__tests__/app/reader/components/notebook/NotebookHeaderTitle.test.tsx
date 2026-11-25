// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RiQuillPenLine } from 'react-icons/ri';

import NotebookHeader from '@/app/reader/components/notebook/Header';
import NotebookTabNavigation from '@/app/reader/components/notebook/NotebookTabNavigation';
import type { NotebookTab } from '@/store/notebookStore';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { aiSettings: { enabled: true } } }),
}));

afterEach(cleanup);

const renderHeader = (activeTab: NotebookTab) =>
  render(
    <NotebookHeader
      bookKey='book-1'
      activeTab={activeTab}
      isPinned={false}
      handleClose={vi.fn()}
      handleTogglePin={vi.fn()}
    />,
  ).container.querySelector('.notebook-header')!;

const titleOf = (header: Element) => header.querySelector('.notebook-title')?.textContent;
const titleIconOf = (header: Element) =>
  header.querySelector('.notebook-title')?.previousElementSibling?.innerHTML;

it.each([
  ['notes', 'Notebook'],
  ['ai', 'AI Assistant'],
  ['dictionary', 'Dictionary'],
  ['xray', 'X-Ray'],
] as const)('titles the header for the %s tab "%s"', (tab, title) => {
  expect(titleOf(renderHeader(tab))).toBe(title);
});

it.each([
  'ai',
  'dictionary',
  'xray',
] as const)("shows the %s tab's own icon in the header", (tab) => {
  const header = renderHeader(tab);
  const { container } = render(<NotebookTabNavigation activeTab={tab} onTabChange={vi.fn()} />);
  const tabIcon = container.querySelector('[aria-pressed="true"] svg')?.innerHTML;

  expect(tabIcon).toBeTruthy();
  expect(titleIconOf(header)).toBe(tabIcon);
});

it('keeps the quill icon for the Notebook', () => {
  const quill = render(<RiQuillPenLine />).container.querySelector('svg')?.innerHTML;

  expect(titleIconOf(renderHeader('notes'))).toBe(quill);
});
