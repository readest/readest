import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ViewSettings } from '@/types/book';
import type { AppService } from '@/types/system';

// Mock the pack loader: it's the boundary we assert the gate reaches. Resolving
// null lets refreshSectionGlosses bail right after the await (no DOM work).
vi.mock('@/services/wordlens/glossPacks', () => ({
  loadGlossIndex: vi.fn().mockResolvedValue(null),
}));

import { refreshSectionGlosses } from '@/app/reader/utils/wordlensSection';
import { loadGlossIndex } from '@/services/wordlens/glossPacks';

const mockedLoad = vi.mocked(loadGlossIndex);

const viewSettings = (overrides: Partial<ViewSettings> = {}): ViewSettings =>
  ({
    wordLensEnabled: true,
    wordLensLevel: 3,
    wordLensHintLang: '',
    ...overrides,
  }) as unknown as ViewSettings;

const ctx = (overrides: Record<string, unknown> = {}) => ({
  appService: {} as unknown as AppService,
  bookLang: 'en',
  appLang: 'en',
  allowDownload: false,
  ...overrides,
});

beforeEach(() => {
  mockedLoad.mockClear();
  mockedLoad.mockResolvedValue(null);
});

describe('refreshSectionGlosses gating', () => {
  it('loads an en-en index when book and hint are both English (same-language allowed)', async () => {
    const doc = document.implementation.createHTMLDocument('t');
    await refreshSectionGlosses(doc, viewSettings({ wordLensHintLang: 'en' }), ctx());
    expect(mockedLoad).toHaveBeenCalledWith(
      expect.anything(),
      'en',
      'en',
      expect.objectContaining({ allowDownload: false }),
    );
  });

  it('resolves a same-language hint from the app locale when no hint is set', async () => {
    const doc = document.implementation.createHTMLDocument('t');
    // hint falls back to appLang ('en'); source is also 'en' → still allowed.
    await refreshSectionGlosses(doc, viewSettings(), ctx({ appLang: 'en' }));
    expect(mockedLoad).toHaveBeenCalledWith(expect.anything(), 'en', 'en', expect.anything());
  });

  it('does not load when no hint can be resolved (no app locale, no selection)', async () => {
    const doc = document.implementation.createHTMLDocument('t');
    await refreshSectionGlosses(doc, viewSettings(), ctx({ appLang: '' }));
    expect(mockedLoad).not.toHaveBeenCalled();
  });
});
