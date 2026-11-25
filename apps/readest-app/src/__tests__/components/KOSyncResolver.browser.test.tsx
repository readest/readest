/**
 * A KOSync conflict found while Sync Info is open must open on top of it. Typing
 * a File Name in Sync Info re-pulls under the new name (#7864), and Sync Info
 * sits in ModalPortal's top layer (HeaderBar), so a prompt left in the reader's
 * own tree opened underneath it. Which dialog takes the pointer is a matter of
 * layout, hence a browser test with the real Dialog, ModalPortal and styles.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { SyncDetails } from '@/app/reader/hooks/useKOSync';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';

vi.mock('@/services/bookMetadataEdit', () => ({ saveKOSyncFilename: vi.fn(async () => {}) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string, vars?: Record<string, string>) =>
    value.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => vars?.[name] ?? ''),
}));
vi.mock('@/hooks/useCloudSyncStatus', () => ({ useCloudSyncStatus: () => ({ providers: [] }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: vi.fn() }, appService: {} }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    systemUIVisible: false,
    statusBarHeight: 0,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@tauri-apps/plugin-haptics', () => ({ impactFeedback: vi.fn() }));

const { default: ModalPortal } = await import('@/components/ModalPortal');
const { default: SyncInfoDialog } = await import('@/app/reader/components/SyncInfoDialog');
const { default: KOSyncConflictResolver } = await import('@/app/reader/components/KOSyncResolver');
await import('@/styles/globals.css');

const book = {
  hash: 'h1',
  format: 'EPUB',
  title: 'Good Omens',
  author: 'Terry Pratchett',
  originalFilename: 'Good Omens.epub',
  metadata: { title: 'Good Omens', author: 'Terry Pratchett', language: 'en' },
  createdAt: 1,
  updatedAt: 1,
} as Book;

const details: SyncDetails = {
  book,
  bookDoc: {} as BookDoc,
  local: { preview: 'Chapter 1 (1.30%)' },
  remote: { device: 'QA-Kindle', percentage: 0.66, preview: 'Approximately 66.00%' },
};

// The reader as it mounts the two: the conflict prompt from FoliateViewer inside
// the book's grid cell, Sync Info from HeaderBar through ModalPortal.
const Reader = ({ conflict }: { conflict: SyncDetails | null }) => (
  <>
    <div className='relative h-full w-full overflow-hidden'>
      <KOSyncConflictResolver
        details={conflict}
        onResolveWithLocal={vi.fn()}
        onResolveWithRemote={vi.fn()}
        onClose={vi.fn()}
      />
    </div>
    <ModalPortal showOverlay={false}>
      <SyncInfoDialog isOpen bookKey='h1-view1' metadata={book.metadata} onClose={vi.fn()} />
    </ModalPortal>
  </>
);

const dialogAt = (el: Element) => {
  const { left, top, width, height } = el.getBoundingClientRect();
  const hit = document.elementFromPoint(left + width / 2, top + height / 2);
  return hit?.closest('dialog')?.getAttribute('aria-label');
};

describe('KOSync conflict prompt over Sync Info', () => {
  afterEach(() => {
    cleanup();
  });

  it('opens above Sync Info and takes the pointer, with Sync Info left open', async () => {
    useSettingsStore.setState({
      settings: { kosync: { enabled: true, checksumMethod: 'filename' } },
    } as never);
    useBookDataStore.setState({
      booksData: {
        h1: { id: 'h1', book, file: null, config: null, bookDoc: null, isFixedLayout: false },
      },
    });
    const { rerender } = render(<Reader conflict={null} />);
    expect(screen.getByRole('textbox', { name: 'File Name' })).toBeTruthy();

    // The pull under the new name comes back with a conflicting position.
    rerender(<Reader conflict={details} />);

    const remote = screen.getByRole('button', { name: /QA-Kindle/ });
    const local = screen.getByRole('button', { name: /This device/ });
    expect(dialogAt(remote)).toBe('Sync Conflict');
    expect(dialogAt(local)).toBe('Sync Conflict');
    expect(screen.getByRole('textbox', { name: 'File Name' })).toBeTruthy();
  });
});
