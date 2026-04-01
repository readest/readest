import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────
let mockIsWebAppPlatform = false;
let mockHasCli = false;

vi.mock('@/services/environment', () => ({
  isWebAppPlatform: () => mockIsWebAppPlatform,
  hasCli: () => mockHasCli,
}));

const mockGetCurrent = vi.fn<() => Promise<string[] | null>>();
vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent: () => mockGetCurrent(),
}));

const mockGetMatches = vi.fn();
vi.mock('@tauri-apps/plugin-cli', () => ({
  getMatches: () => mockGetMatches(),
}));

import { parseOpenWithFiles } from '@/helpers/openWith';

// Helper type matching the AppService subset used in openWith
interface MockAppService {
  isIOSApp: boolean;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Suppress expected console noise from parseIntentOpenWithFiles.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  mockIsWebAppPlatform = false;
  mockHasCli = false;
  // Reset window globals
  delete window.OPEN_WITH_FILES;
  // Reset location.search
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search: '' },
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseOpenWithFiles', () => {
  // ── Web platform ───────────────────────────────────────────────
  describe('web platform', () => {
    test('returns empty array on web platform', async () => {
      mockIsWebAppPlatform = true;

      const result = await parseOpenWithFiles(null);

      expect(result).toEqual([]);
    });
  });

  // ── Window URL params ──────────────────────────────────────────
  describe('window URL params', () => {
    test('parses file params from URL search', async () => {
      Object.defineProperty(window, 'location', {
        value: { ...window.location, search: '?file=book1.epub&file=book2.epub' },
        writable: true,
      });
      mockGetCurrent.mockResolvedValue(null);

      const result = await parseOpenWithFiles(null);

      expect(result).toEqual(['book1.epub', 'book2.epub']);
    });

    test('uses window.OPEN_WITH_FILES when no URL params', async () => {
      window.OPEN_WITH_FILES = ['/path/to/book.epub'];
      mockGetCurrent.mockResolvedValue(null);

      const result = await parseOpenWithFiles(null);

      expect(result).toEqual(['/path/to/book.epub']);
    });

    test('prefers URL params over OPEN_WITH_FILES', async () => {
      Object.defineProperty(window, 'location', {
        value: { ...window.location, search: '?file=url-book.epub' },
        writable: true,
      });
      window.OPEN_WITH_FILES = ['/path/to/window-book.epub'];
      mockGetCurrent.mockResolvedValue(null);

      const result = await parseOpenWithFiles(null);

      expect(result).toEqual(['url-book.epub']);
    });
  });

  // ── CLI arguments ──────────────────────────────────────────────
  describe('CLI arguments', () => {
    test('parses files from CLI matches', async () => {
      mockHasCli = true;
      mockGetMatches.mockResolvedValue({
        args: {
          file1: { value: '/path/file1.epub', occurrences: 1 },
          file2: { value: '/path/file2.epub', occurrences: 1 },
          file3: { value: '', occurrences: 0 },
          file4: { value: '', occurrences: 0 },
        },
      });
      mockGetCurrent.mockResolvedValue(null);

      const result = await parseOpenWithFiles(null);

      expect(result).toEqual(['/path/file1.epub', '/path/file2.epub']);
    });

    test('returns empty array when CLI has no file args', async () => {
      mockHasCli = true;
      mockGetMatches.mockResolvedValue({
        args: {
          file1: { value: '', occurrences: 0 },
          file2: { value: '', occurrences: 0 },
          file3: { value: '', occurrences: 0 },
          file4: { value: '', occurrences: 0 },
        },
      });
      mockGetCurrent.mockResolvedValue(null);

      const result = await parseOpenWithFiles(null);

      // Falls through to intent, which returns null
      expect(result).toBeNull();
    });

    test('skips CLI parsing when hasCli is false', async () => {
      mockHasCli = false;
      mockGetCurrent.mockResolvedValue(null);

      const result = await parseOpenWithFiles(null);

      expect(mockGetMatches).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    test('handles null args from CLI', async () => {
      mockHasCli = true;
      mockGetMatches.mockResolvedValue({ args: null });
      mockGetCurrent.mockResolvedValue(null);

      const result = await parseOpenWithFiles(null);

      expect(result).toBeNull();
    });
  });

  // ── Intent / Deep Link ────────────────────────────────────────
  describe('intent open with files', () => {
    test('parses file:// URLs', async () => {
      mockGetCurrent.mockResolvedValue(['file:///path/to/book.epub']);

      const result = await parseOpenWithFiles(null);

      expect(result).toEqual(['/path/to/book.epub']);
    });

    test('preserves file:// prefix for iOS', async () => {
      const mockAppService = { isIOSApp: true } as MockAppService;
      mockGetCurrent.mockResolvedValue(['file:///path/to/book.epub']);

      const result = await parseOpenWithFiles(mockAppService as never);

      expect(result).toEqual(['file:///path/to/book.epub']);
    });

    test('handles content:// URLs (Android)', async () => {
      mockGetCurrent.mockResolvedValue(['content://com.example/book.epub']);

      const result = await parseOpenWithFiles(null);

      expect(result).toEqual(['content://com.example/book.epub']);
    });

    test('filters out non-file, non-content URLs', async () => {
      mockGetCurrent.mockResolvedValue([
        'file:///path/book.epub',
        'https://example.com/book.epub',
        'content://com.example/book2.epub',
      ]);

      const result = await parseOpenWithFiles(null);

      expect(result).toEqual(['/path/book.epub', 'content://com.example/book2.epub']);
    });

    test('decodes URI-encoded file paths', async () => {
      mockGetCurrent.mockResolvedValue(['file:///path/to/my%20book.epub']);

      const result = await parseOpenWithFiles(null);

      expect(result).toEqual(['/path/to/my book.epub']);
    });

    test('returns null when no deep link URLs', async () => {
      mockGetCurrent.mockResolvedValue(null);

      const result = await parseOpenWithFiles(null);

      expect(result).toBeNull();
    });

    test('returns null when deep link returns empty array', async () => {
      mockGetCurrent.mockResolvedValue([]);

      const result = await parseOpenWithFiles(null);

      expect(result).toBeNull();
    });
  });

  // ── Priority / fallthrough ─────────────────────────────────────
  describe('fallthrough logic', () => {
    test('uses window params first, skips CLI and intent', async () => {
      Object.defineProperty(window, 'location', {
        value: { ...window.location, search: '?file=from-url.epub' },
        writable: true,
      });
      mockHasCli = true;

      const result = await parseOpenWithFiles(null);

      expect(result).toEqual(['from-url.epub']);
      expect(mockGetMatches).not.toHaveBeenCalled();
      expect(mockGetCurrent).not.toHaveBeenCalled();
    });

    test('falls through from empty window params to CLI', async () => {
      mockHasCli = true;
      mockGetMatches.mockResolvedValue({
        args: {
          file1: { value: '/cli-file.epub', occurrences: 1 },
          file2: { value: '', occurrences: 0 },
          file3: { value: '', occurrences: 0 },
          file4: { value: '', occurrences: 0 },
        },
      });

      const result = await parseOpenWithFiles(null);

      expect(result).toEqual(['/cli-file.epub']);
      expect(mockGetCurrent).not.toHaveBeenCalled();
    });

    test('falls through from empty window params and no CLI to intent', async () => {
      mockHasCli = false;
      mockGetCurrent.mockResolvedValue(['file:///intent-file.epub']);

      const result = await parseOpenWithFiles(null);

      expect(result).toEqual(['/intent-file.epub']);
    });
  });
});
