import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ViewSettings } from '@/types/book';
import type { AppService } from '@/types/system';

// Mock the pack loader: it's the boundary we assert the gate reaches. Resolving
// null lets refreshSectionGlosses bail right after the await (no DOM work).
vi.mock('@/services/wordlens/glossPacks', () => ({
  loadGlossIndex: vi.fn().mockResolvedValue(null),
}));

// The en-zh pack is Simplified; a Traditional hint converts glosses through the
// bundled OpenCC tables. Stub the WASM so the variant chosen is observable.
vi.mock('@/utils/simplecc', () => ({
  initSimpleCC: vi.fn().mockResolvedValue(undefined),
  runSimpleCC: vi.fn((text: string, variant: string) => `${variant}:${text}`),
}));

import { refreshSectionGlosses } from '@/app/reader/utils/wordlensSection';
import { loadGlossIndex } from '@/services/wordlens/glossPacks';
import type { GlossIndex } from '@/services/wordlens/glossIndex';
import { runSimpleCC } from '@/utils/simplecc';

const mockedLoad = vi.mocked(loadGlossIndex);
const mockedConvert = vi.mocked(runSimpleCC);

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
  mockedConvert.mockClear();
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

describe('refreshSectionGlosses Traditional Chinese hints', () => {
  // A fake en-zh index: one difficult word with a Simplified gloss.
  const enZh = {
    lookup: (word: string) =>
      word.toLowerCase() === 'computer' ? { rank: 99999, gloss: '电脑' } : null,
  } as unknown as GlossIndex;

  const glossOf = async (hintLang: string, appLang = 'en') => {
    mockedLoad.mockResolvedValue(enZh);
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = '<p>The computer</p>';
    await refreshSectionGlosses(
      doc,
      viewSettings({ wordLensHintLang: hintLang }),
      ctx({ appLang }),
    );
    return doc.querySelector('ruby.wl-gloss > rt')?.textContent ?? null;
  };

  it('keeps the Simplified gloss for zh-CN', async () => {
    expect(await glossOf('zh-CN')).toBe('电脑');
    expect(mockedConvert).not.toHaveBeenCalled();
  });

  it('converts with the Taiwan phrase table for zh-TW (same en-zh pack)', async () => {
    expect(await glossOf('zh-TW')).toBe('s2twp:电脑');
    expect(mockedLoad).toHaveBeenCalledWith(expect.anything(), 'en', 'zh', expect.anything());
  });

  it('converts with the Hong Kong table for zh-HK and plain s2t for zh-Hant', async () => {
    expect(await glossOf('zh-HK')).toBe('s2hk:电脑');
    expect(await glossOf('zh-Hant')).toBe('s2t:电脑');
  });

  it('honours the Traditional app locale when the hint is Auto', async () => {
    expect(await glossOf('', 'zh-TW')).toBe('s2twp:电脑');
    expect(await glossOf('', 'zh-Hant-TW')).toBe('s2twp:电脑'); // Android / iOS locale shape
    expect(await glossOf('', 'zh-Hans-CN')).toBe('电脑');
  });
});
