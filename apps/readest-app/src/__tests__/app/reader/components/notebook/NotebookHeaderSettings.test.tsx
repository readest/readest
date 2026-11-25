// @vitest-environment happy-dom
/**
 * A Notebook tab's settings gear sits in the sidebar header, not inside the
 * tab's content.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import NotebookHeader from '@/app/reader/components/notebook/Header';
import { useSettingsStore } from '@/store/settingsStore';
import type { NotebookTab } from '@/store/notebookStore';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));

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
  );

it('opens Manage Dictionaries from the Dictionary tab header', () => {
  renderHeader('dictionary');

  fireEvent.click(screen.getByRole('button', { name: 'Manage Dictionaries' }));

  expect(useSettingsStore.getState()).toMatchObject({
    isSettingsDialogOpen: true,
    settingsDialogBookKey: 'book-1',
    activeSettingsItemId: 'settings.language.dictionaries.manage',
  });
});

it.each(['notes', 'ai', 'xray'] as const)('has no gear in the %s tab header', (tab) => {
  renderHeader(tab);
  expect(screen.queryByRole('button', { name: 'Manage Dictionaries' })).toBeNull();
  expect(screen.getAllByRole('button').map((b) => b.title)).toEqual(['Pin Notebook', 'Close']);
});
