import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import type { AppService } from '@/types/system';

/**
 * A mixed drop — some items inside the SUPPORTED_BOOK_EXTS whitelist, some
 * outside — used to import the supported part and swallow the rest without a
 * trace: the exact gap the file-picker path fixed for #5959. The hook has to
 * name what it dropped, on both drop surfaces (tauri drag-drop events carrying
 * host paths, and the web DOM drop carrying File objects).
 */

const isTauriAppPlatform = vi.hoisted(() => vi.fn(() => true));

let tauriDropHandler: ((event: { payload: unknown }) => void) | undefined;

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string, params?: Record<string, string>) =>
    params
      ? Object.entries(params).reduce(
          (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
          text,
        )
      : text,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => isTauriAppPlatform(),
}));

vi.mock('@tauri-apps/plugin-haptics', () => ({ impactFeedback: vi.fn() }));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { libraryGroupBy: 'none' } }),
}));

const isDirectory = vi.hoisted(() =>
  vi.fn<(path: string, kind: string) => Promise<boolean>>(async () => false),
);

const appService = {
  isDirectory,
  isMobile: false,
  hasHaptics: false,
} as unknown as AppService;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService }),
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(async (handler: (event: { payload: unknown }) => void) => {
      tauriDropHandler = handler;
      return () => {};
    }),
  }),
}));

const { useDragDropImport } = await import('@/app/library/hooks/useDragDropImport');
const { eventDispatcher } = await import('@/utils/event');

type ToastPayload = { type?: string; message?: string };

const dropTauriPaths = async (paths: string[]) => {
  await act(async () => {
    tauriDropHandler?.({ payload: { type: 'drop', paths } });
  });
};

const dropWebFiles = async (files: File[]) => {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  await act(async () => {
    document.querySelector('.library-page')!.dispatchEvent(event);
  });
};

const toastPayloads = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((call) => call[0] === 'toast').map((call) => call[1] as ToastPayload);

describe('useDragDropImport skipped-file toast', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="library-page"></div>';
    isTauriAppPlatform.mockReturnValue(true);
    isDirectory.mockReset();
    isDirectory.mockImplementation(async () => false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    tauriDropHandler = undefined;
  });

  it('names the skipped files of a mixed drop and imports the rest', async () => {
    const spy = vi.spyOn(eventDispatcher, 'dispatch');
    renderHook(() => useDragDropImport());
    // .doc stays unsupported; .docx converts to EPUB on import and is accepted.
    await dropTauriPaths(['C:\\Library\\a.epub', 'C:\\Library\\b.exe', 'C:\\Library\\c.doc']);

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        'import-book-files',
        expect.objectContaining({ groupId: '' }),
      ),
    );

    const toasts = toastPayloads(spy);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.type).toBe('error');
    expect(toasts[0]!.message).toBe('Failed to import book(s): b.exe, c.doc');

    const importPayload = spy.mock.calls.find((call) => call[0] === 'import-book-files')?.[1] as {
      files: { file?: File; path?: string }[];
    };
    expect(importPayload.files).toEqual([{ file: undefined, path: 'C:\\Library\\a.epub' }]);
  });

  it('keeps the supported-formats hint when nothing in the drop is supported', async () => {
    const spy = vi.spyOn(eventDispatcher, 'dispatch');
    renderHook(() => useDragDropImport());
    await dropTauriPaths(['C:\\Library\\b.exe']);

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'error' })),
    );

    const toasts = toastPayloads(spy);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toContain('No supported files found');
    expect(spy.mock.calls.some((call) => call[0] === 'import-book-files')).toBe(false);
  });

  it('imports a fully supported drop without complaining', async () => {
    const spy = vi.spyOn(eventDispatcher, 'dispatch');
    renderHook(() => useDragDropImport());
    await dropTauriPaths(['C:\\Library\\a.epub']);

    await waitFor(() => expect(spy).toHaveBeenCalledWith('import-book-files', expect.anything()));
    expect(toastPayloads(spy)).toHaveLength(0);
  });

  it('names the skipped file when a drop mixes a folder and an unsupported file', async () => {
    isDirectory.mockImplementation(async (path: string) => path === 'C:\\Library');
    const spy = vi.spyOn(eventDispatcher, 'dispatch');
    renderHook(() => useDragDropImport());
    await dropTauriPaths(['C:\\Library', 'C:\\Library\\b.prc']);

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        'import-book-directory',
        expect.objectContaining({ path: 'C:\\Library' }),
      ),
    );

    const toasts = toastPayloads(spy);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toBe('Failed to import book(s): b.prc');
    expect(spy.mock.calls.some((call) => call[0] === 'import-book-files')).toBe(false);
  });

  it('names the skipped files of a mixed web drop', async () => {
    isTauriAppPlatform.mockReturnValue(false);
    const spy = vi.spyOn(eventDispatcher, 'dispatch');
    renderHook(() => useDragDropImport());
    await dropWebFiles([new File([], 'a.epub'), new File([], 'b.exe')]);

    await waitFor(() => expect(spy).toHaveBeenCalledWith('import-book-files', expect.anything()));

    const toasts = toastPayloads(spy);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toBe('Failed to import book(s): b.exe');

    const importPayload = spy.mock.calls.find((call) => call[0] === 'import-book-files')?.[1] as {
      files: { file?: File; path?: string }[];
    };
    expect(importPayload.files).toEqual([{ file: expect.any(File), path: undefined }]);
  });
});
