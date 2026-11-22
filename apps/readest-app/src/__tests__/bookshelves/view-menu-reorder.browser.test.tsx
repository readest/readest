import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';

let mockSearchParams = new URLSearchParams();
const navigateToLibrary = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, values?: Record<string, unknown>) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));
vi.mock('@/utils/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/access')>()),
  getUserID: async () => null,
}));
vi.mock('@/services/sync/replicaSync', () => ({ getReplicaSync: () => null }));
vi.mock('@/utils/nav', () => ({ navigateToLibrary }));
vi.mock('@/helpers/settings', () => ({
  saveSysSettings: async (_env: unknown, key: string, value: unknown) => {
    await Promise.resolve();
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, [key]: value },
    });
  },
}));

const { default: ViewMenu } = await import('@/app/library/components/ViewMenu');
await import('@/styles/globals.css');

beforeEach(() => {
  localStorage.clear();
  mockSearchParams = new URLSearchParams();
  navigateToLibrary.mockReset();
  useSettingsStore.setState({
    settings: { ...DEFAULT_SYSTEM_SETTINGS, libraryViewMode: 'grid' } as SystemSettings,
    saveSettings: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(cleanup);

describe('ViewMenu priority sort reorder in Chromium', () => {
  it('keeps a criterion dragged from bottom to rank 1 at rank 1 without flashing rank 3 while URL searchParams lag', async () => {
    mockSearchParams = new URLSearchParams('sort=author&order=asc&thenSort=created&thenOrder=desc');
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SYSTEM_SETTINGS,
        libraryViewMode: 'grid',
        librarySortByAuto: false,
        librarySortBy: 'author',
        librarySortAscending: true,
        libraryThenSortBy: 'created',
        libraryThenSortAscending: false,
        librarySortOrder: [
          { by: 'author', ascending: true },
          { by: 'created', ascending: false },
          { by: 'published', ascending: false },
          { by: 'progress', ascending: false },
          { by: 'series', ascending: true },
          { by: 'updated', ascending: false },
          { by: 'format', ascending: true },
          { by: 'title', ascending: true },
          { by: 'pages', ascending: true },
          { by: 'timeRemaining', ascending: true },
        ],
      } as SystemSettings,
    });

    const { container, rerender } = render(<ViewMenu />);
    fireEvent.click(screen.getByText('Sort by...'));

    const getRowOrder = () =>
      Array.from(document.querySelectorAll('[role="listitem"] [role="menuitem"]')).map(
        (el) => el.getAttribute('aria-label')?.split(' (')[0],
      );

    expect(getRowOrder()[0]).toBe('Author');
    expect(getRowOrder()[9]).toBe('Time Remaining');

    const handle = screen
      .getByRole('menuitem', { name: /Time Remaining/i })
      .closest('[role="listitem"]')!
      .querySelector<HTMLButtonElement>('[data-dnd-sortable-handle="true"]')!;
    handle.focus();
    expect(document.activeElement).toBe(handle);

    await userEvent.keyboard(' ');
    for (let i = 0; i < 9; i++) {
      await userEvent.keyboard('{ArrowUp}');
    }

    const observedOrders: (string | undefined)[][] = [];
    const captureOrder = () => {
      observedOrders.push(getRowOrder());
    };
    const observer = new MutationObserver(captureOrder);
    observer.observe(container, { childList: true, subtree: true, attributes: true });
    try {
      await userEvent.keyboard(' ');
      captureOrder();
      await waitFor(() => expect(navigateToLibrary).toHaveBeenCalled());
      captureOrder();
    } finally {
      observer.disconnect();
    }

    expect(observedOrders.length).toBeGreaterThan(0);
    for (const order of observedOrders) {
      expect(order[2]).not.toBe('Time Remaining');
    }
    expect(useSettingsStore.getState().settings.librarySortOrder?.[0]?.by).toBe('timeRemaining');
    expect(getRowOrder().slice(0, 3)).toEqual(['Time Remaining', 'Author', 'Date Added']);
    expect(navigateToLibrary).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('sort=timeRemaining&order=asc&thenSort=author&thenOrder=asc'),
    );

    // router.replace lands, then a later URL change is honored again.
    mockSearchParams = new URLSearchParams(
      'sort=timeRemaining&order=asc&thenSort=author&thenOrder=asc',
    );
    rerender(<ViewMenu />);
    expect(getRowOrder().slice(0, 3)).toEqual(['Time Remaining', 'Author', 'Date Added']);
    mockSearchParams = new URLSearchParams('sort=title&order=asc&thenSort=author&thenOrder=asc');
    rerender(<ViewMenu />);
    await waitFor(() => expect(getRowOrder().slice(0, 2)).toEqual(['Title', 'Author']));
  });
});
