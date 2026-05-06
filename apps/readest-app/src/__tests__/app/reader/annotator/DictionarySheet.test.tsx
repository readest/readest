/**
 * DictionarySheet tests — the mobile / narrow-viewport bottom sheet that
 * replaces DictionaryPopup for `< sm` viewports.
 *
 * Lookups go through real providers backed by the on-disk dict fixtures in
 * `src/__tests__/fixtures/data/dicts/`. The registry module is mocked per
 * test so we can hand the sheet a controlled provider list (real StarDict /
 * DICT instances + a couple of tiny in-test providers for navigation and
 * abort assertions).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { DictionaryProvider, DictionaryLookupOutcome } from '@/services/dictionaries/types';
import { BUILTIN_WEB_SEARCH_IDS } from '@/services/dictionaries/types';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import type { BaseDir } from '@/types/system';
import { createStarDictProvider } from '@/services/dictionaries/providers/starDictProvider';
import { createDictProvider } from '@/services/dictionaries/providers/dictProvider';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';

import {
  IFO_FIXTURE_NAME,
  IDX_FIXTURE_NAME,
  DICT_FIXTURE_NAME,
  readIfoFile,
  readIdxFile,
  readDictFile as readStarDictFile,
} from '../../../services/dictionaries/_stardictFixtures';
import {
  INDEX_FIXTURE_NAME,
  DICT_FIXTURE_NAME as DICTD_FIXTURE_NAME,
  readIndexFile,
  readDictFile as readDictdFile,
} from '../../../services/dictionaries/_dictFixtures';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Replace Dialog with a thin shell so the sheet's internals are testable
// without dragging in theme/device/responsive/haptics dependencies.
vi.mock('@/components/Dialog', () => ({
  default: ({
    children,
    header,
    isOpen,
    onClose,
  }: {
    children: ReactNode;
    header?: ReactNode;
    isOpen: boolean;
    onClose: () => void;
    snapHeight?: number;
    contentClassName?: string;
    dismissible?: boolean;
  }) =>
    isOpen ? (
      <div role='dialog' data-testid='dialog'>
        <div data-testid='dialog-header'>{header}</div>
        <div data-testid='dialog-body'>{children}</div>
        <button data-testid='dialog-overlay-close' onClick={onClose} aria-label='backdrop' />
      </div>
    ) : null,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

const mockOpenUrl = vi.fn().mockResolvedValue(undefined);
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
}));

vi.mock('@/services/environment', async () => {
  const actual =
    await vi.importActual<typeof import('@/services/environment')>('@/services/environment');
  return {
    ...actual,
    isTauriAppPlatform: () => false,
  };
});

// Mock the registry: every test pushes its own providers onto this list.
const providersForNextRender: DictionaryProvider[] = [];
vi.mock('@/services/dictionaries/registry', () => ({
  getEnabledProviders: () => [...providersForNextRender],
  __resetRegistryForTests: vi.fn(),
  evictProvider: vi.fn(),
}));

// EnvProvider needs an appService; provide one with the file API the
// (unmocked) StarDict provider uses for fixture reads.
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: vi.fn().mockResolvedValue(null) },
    appService: { openFile: vi.fn() },
  }),
}));

// ---------------------------------------------------------------------------
// Fixture-backed real providers
// ---------------------------------------------------------------------------

const realStarDictDict: ImportedDictionary = {
  id: 'stardict:cmudict',
  kind: 'stardict',
  name: 'CMU American English spelling',
  bundleDir: 'cmudict-bundle',
  files: { ifo: IFO_FIXTURE_NAME, idx: IDX_FIXTURE_NAME, dict: DICT_FIXTURE_NAME },
  addedAt: 1,
};

const realDictdDict: ImportedDictionary = {
  id: 'dict:freedict-eng-nld',
  kind: 'dict',
  name: 'FreeDict English-Dutch',
  bundleDir: 'freedict-eng-nld-bundle',
  files: { dict: DICTD_FIXTURE_NAME, index: INDEX_FIXTURE_NAME },
  addedAt: 2,
};

const makeStarDictFs = () => ({
  openFile: async (p: string, _base: BaseDir) => {
    const base = p.split('/').pop()!;
    if (base === IFO_FIXTURE_NAME) return readIfoFile();
    if (base === IDX_FIXTURE_NAME) return readIdxFile();
    if (base === DICT_FIXTURE_NAME) return readStarDictFile();
    throw new Error(`Unknown stardict fixture: ${base}`);
  },
});

const makeDictdFs = () => ({
  openFile: async (p: string, _base: BaseDir) => {
    const base = p.split('/').pop()!;
    if (base === INDEX_FIXTURE_NAME) return readIndexFile();
    if (base === DICTD_FIXTURE_NAME) return readDictdFile();
    throw new Error(`Unknown dictd fixture: ${base}`);
  },
});

const buildRealStarDictProvider = (): DictionaryProvider =>
  createStarDictProvider({ dict: realStarDictDict, fs: makeStarDictFs() });

const buildRealDictdProvider = (): DictionaryProvider =>
  createDictProvider({ dict: realDictdDict, fs: makeDictdFs() });

// ---------------------------------------------------------------------------
// In-test providers — small fakes for behaviors that real fixture data
// can't easily exercise (in-content navigation, slow lookups for abort).
// ---------------------------------------------------------------------------

const buildNavProvider = (nextWord: string): DictionaryProvider => ({
  id: 'nav-test',
  kind: 'stardict',
  label: 'Nav Test',
  async lookup(word, ctx) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = `→ ${nextWord}`;
    a.setAttribute('rel', 'mw:WikiLink');
    a.setAttribute('data-testid', 'nav-link');
    a.addEventListener('click', (e) => {
      e.preventDefault();
      ctx.onNavigate?.(nextWord);
    });
    ctx.container.append(document.createTextNode(`current: ${word} `));
    ctx.container.append(a);
    return { ok: true, headword: word, sourceLabel: 'Nav Test' };
  },
});

const buildSlowProvider = (abortObserver: { aborted: boolean }): DictionaryProvider => ({
  id: 'slow',
  kind: 'stardict',
  label: 'Slow',
  async lookup(_word, ctx): Promise<DictionaryLookupOutcome> {
    return new Promise<DictionaryLookupOutcome>((resolve) => {
      ctx.signal.addEventListener('abort', () => {
        abortObserver.aborted = true;
        resolve({ ok: false, reason: 'error', message: 'aborted' });
      });
    });
  },
});

const buildEmptyProvider = (id: string, label: string): DictionaryProvider => ({
  id,
  kind: 'stardict',
  label,
  async lookup() {
    return { ok: false, reason: 'empty' };
  },
});

// ---------------------------------------------------------------------------
// Sheet harness
// ---------------------------------------------------------------------------

import DictionarySheet from '@/app/reader/components/annotator/DictionarySheet';

const renderSheet = (
  props: Partial<{
    word: string;
    lang: string;
    onDismiss: () => void;
    onManage: () => void;
  }> = {},
) =>
  render(
    <DictionarySheet
      word={props.word ?? 'hello'}
      lang={props.lang}
      onDismiss={props.onDismiss ?? (() => {})}
      onManage={props.onManage}
    />,
  );

const resetStoreToEmpty = () => {
  useCustomDictionaryStore.setState({
    dictionaries: [],
    settings: {
      providerOrder: [],
      providerEnabled: {},
      webSearches: [],
    },
  });
};

beforeEach(() => {
  providersForNextRender.length = 0;
  mockOpenUrl.mockClear();
  resetStoreToEmpty();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DictionarySheet — header', () => {
  it('renders the looked-up word and a manage button; no back button at history length 1', async () => {
    providersForNextRender.push(buildRealStarDictProvider());
    renderSheet({ word: 'hello', onManage: vi.fn() });

    expect((await screen.findByTestId('dict-title')).textContent).toBe('hello');
    expect(screen.getByLabelText('Manage Dictionaries')).toBeTruthy();
    expect(screen.queryByLabelText('Back')).toBeNull();
  });
});

describe('DictionarySheet — concurrent lookup', () => {
  it('fans out lookups across every enabled definition provider', async () => {
    const stardict = buildRealStarDictProvider();
    const dictd = buildRealDictdProvider();
    const stardictSpy = vi.spyOn(stardict, 'lookup');
    const dictdSpy = vi.spyOn(dictd, 'lookup');
    providersForNextRender.push(stardict, dictd);

    renderSheet({ word: 'hello' });

    await waitFor(() => {
      expect(stardictSpy).toHaveBeenCalledWith('hello', expect.any(Object));
      expect(dictdSpy).toHaveBeenCalledWith('hello', expect.any(Object));
    });
  });

  it('renders the cmudict card after the lookup settles', async () => {
    providersForNextRender.push(buildRealStarDictProvider());
    renderSheet({ word: 'hello' });

    await screen.findByText('CMU American English spelling');
  });

  it('hides cards from providers that return empty', async () => {
    providersForNextRender.push(
      buildRealStarDictProvider(),
      buildEmptyProvider('empty:1', 'Empty One'),
      buildEmptyProvider('empty:2', 'Empty Two'),
    );
    renderSheet({ word: 'hello' });

    // The cmudict card eventually appears.
    await screen.findByText('CMU American English spelling');
    // The two empty providers never render a card.
    expect(screen.queryByText('Empty One')).toBeNull();
    expect(screen.queryByText('Empty Two')).toBeNull();
  });
});

describe('DictionarySheet — expand / collapse', () => {
  it('toggles aria-expanded when a card is tapped', async () => {
    providersForNextRender.push(buildRealStarDictProvider());
    renderSheet({ word: 'hello' });

    // Wait for the lookup to finish (source label visible).
    await screen.findByText('CMU American English spelling');
    const card = screen.getByTestId('dict-card');
    // With ≤ 3 results the sheet defaults to expanded.
    await waitFor(() => expect(card.getAttribute('aria-expanded')).toBe('true'));

    fireEvent.click(card);
    expect(card.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(card);
    expect(card.getAttribute('aria-expanded')).toBe('true');
  });

  it('defaults to collapsed when more than 3 providers have results', async () => {
    // Four providers, all with content → > 3 → default-collapsed.
    const providers: DictionaryProvider[] = [];
    for (let i = 0; i < 4; i++) {
      providers.push({
        id: `pseudo:${i}`,
        kind: 'stardict',
        label: `Pseudo ${i}`,
        async lookup(word, ctx) {
          ctx.container.append(document.createTextNode(`def for ${word} #${i}`));
          return { ok: true, headword: word, sourceLabel: `Pseudo ${i}` };
        },
      });
    }
    providersForNextRender.push(...providers);
    renderSheet({ word: 'hello' });

    await screen.findByText('Pseudo 0');
    const cards = screen.getAllByTestId('dict-card');
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.getAttribute('aria-expanded')).toBe('false');
    }
  });
});

describe('DictionarySheet — in-content navigation', () => {
  it('pushes onto the history stack when a provider link triggers onNavigate; back button appears', async () => {
    providersForNextRender.push(buildNavProvider('world'));
    renderSheet({ word: 'hello' });

    expect((await screen.findByTestId('dict-title')).textContent).toBe('hello');
    expect(screen.queryByLabelText('Back')).toBeNull();

    const navLink = await screen.findByTestId('nav-link');
    await act(async () => {
      fireEvent.click(navLink);
    });

    await waitFor(() => {
      expect(screen.getByTestId('dict-title').textContent).toBe('world');
    });
    expect(screen.getByLabelText('Back')).toBeTruthy();
  });

  it('back button pops the history stack and restores the previous word', async () => {
    providersForNextRender.push(buildNavProvider('world'));
    renderSheet({ word: 'hello' });

    const navLink = await screen.findByTestId('nav-link');
    await act(async () => {
      fireEvent.click(navLink);
    });
    await waitFor(() => expect(screen.getByTestId('dict-title').textContent).toBe('world'));

    fireEvent.click(screen.getByLabelText('Back'));
    await waitFor(() => expect(screen.getByTestId('dict-title').textContent).toBe('hello'));
    expect(screen.queryByLabelText('Back')).toBeNull();
  });
});

describe('DictionarySheet — web search row', () => {
  it('renders a link with the resolved URL and target="_blank" on the web build', async () => {
    // Real built-in Google web-search provider, via the registry mock.
    const googleEntry: DictionaryProvider = {
      id: BUILTIN_WEB_SEARCH_IDS.google,
      kind: 'web',
      label: 'Google',
      async lookup() {
        return { ok: true };
      },
    };
    // Enable the google entry in the store so the sheet can resolve its
    // urlTemplate from BUILTIN_WEB_SEARCHES.
    useCustomDictionaryStore.setState({
      dictionaries: [],
      settings: {
        providerOrder: [BUILTIN_WEB_SEARCH_IDS.google],
        providerEnabled: { [BUILTIN_WEB_SEARCH_IDS.google]: true },
        webSearches: [],
      },
    });
    providersForNextRender.push(googleEntry);

    renderSheet({ word: 'hello world' });

    // The test setup mocks `isTauriAppPlatform: () => false`, so we
    // exercise the web-build path: anchor with href + target="_blank",
    // openUrl untouched.
    const link = (await screen.findByRole('link', { name: /Google/i })) as HTMLAnchorElement;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    const url = link.getAttribute('href') ?? '';
    expect(url.startsWith('https://www.google.com/search')).toBe(true);
    expect(url).toContain(encodeURIComponent('hello world'));

    fireEvent.click(link);
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });
});

describe('DictionarySheet — empty state', () => {
  it('renders "No dictionaries enabled" + manage gear when zero providers are configured', async () => {
    // providersForNextRender stays empty.
    const onManage = vi.fn();
    renderSheet({ word: 'hello', onManage });

    expect(await screen.findByText('No dictionaries enabled')).toBeTruthy();
    const gear = screen.getByLabelText('Manage Dictionaries');
    fireEvent.click(gear);
    expect(onManage).toHaveBeenCalledTimes(1);
  });
});

describe('DictionarySheet — abort on unmount', () => {
  it('aborts in-flight provider lookups when the sheet unmounts', async () => {
    const observer = { aborted: false };
    providersForNextRender.push(buildSlowProvider(observer));

    const { unmount } = renderSheet({ word: 'hello' });

    // Wait until the lookup has been kicked off (the provider hasn't
    // resolved yet — it's pending on its abort listener).
    await waitFor(() => {
      // Skeleton card rendered while loading.
      expect(screen.queryByTestId('dict-card-skeleton')).toBeTruthy();
    });

    unmount();

    await waitFor(() => {
      expect(observer.aborted).toBe(true);
    });
  });
});
