/**
 * CustomDictionaries — system-dictionary exclusivity lock.
 *
 * `settings.providerEnabled` is whole-field synced across devices, so the
 * System Dictionary "enabled" flag can arrive (true) on a device that doesn't
 * support the OS handoff at all (web, Linux, Windows). On those platforms the
 * System Dictionary row is hidden and the feature is a no-op at lookup time —
 * so it must NOT lock the other providers' toggles. On platforms where the
 * handoff is supported, enabling it stays exclusive and locks the rest.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as sortable from '@dnd-kit/sortable';

import CustomDictionaries from '@/components/settings/CustomDictionaries';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';
import type { DictionarySettings, ImportedDictionary } from '@/services/dictionaries/types';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { useCustomTranslatorStore } from '@/store/customTranslatorStore';
import type { CustomTranslator } from '@/types/translation';

// Per-test platform control. `isSystemDictionaryEnabled` (real, from the
// registry) reads `isSystemDictionarySupported`, so toggling these flips both
// the row visibility and the lock gate the component now relies on.
const platform = vi.hoisted(() => ({
  supported: false,
  available: false,
  premium: true,
  ios: false,
  android: false,
}));
const mocks = vi.hoisted(() => ({
  importDictionaries: vi.fn(),
  selectFiles: vi.fn(),
  getAppService: vi.fn(),
  getLookupApps: vi.fn(),
  setLookupApp: vi.fn(),
}));
vi.mock('@/services/dictionaries/systemDictionary', () => ({
  isSystemDictionarySupported: () => platform.supported,
  isSystemDictionaryAvailable: () => platform.available,
  getLookupApps: mocks.getLookupApps,
  setLookupApp: mocks.setLookupApp,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, values?: Record<string, string | number>) =>
    s.replace(/\{\{(\w+)\}\}/gu, (_match, key: string) => String(values?.[key] ?? '')),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: {
      importDictionaries: mocks.importDictionaries,
      isIOSApp: platform.ios,
      isAndroidApp: platform.android,
    },
    envConfig: { getAppService: mocks.getAppService },
  }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: 'token', user: null }),
}));

vi.mock('@/utils/access', () => ({
  isCustomTranslatorAllowed: () => platform.premium,
}));

vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({ selectFiles: mocks.selectFiles }),
}));

vi.mock('@/services/sync/replicaBinaryUpload', () => ({
  queueDictionaryBinaryUpload: vi.fn(),
}));

const LOCKED_TITLE = 'Disable System Dictionary first to change this.';

const seedSettings = (settings: DictionarySettings) => {
  useCustomDictionaryStore.setState({
    dictionaries: [],
    settings,
    // The mount effect calls loadCustomDictionaries; no-op it so it can't
    // clobber the seeded state with on-disk defaults.
    loadCustomDictionaries: async () => true,
    saveCustomDictionaries: async () => {},
  });
};

const enabledSystemSettings: DictionarySettings = {
  providerOrder: [
    BUILTIN_PROVIDER_IDS.systemDictionary,
    BUILTIN_PROVIDER_IDS.wiktionary,
    BUILTIN_PROVIDER_IDS.wikipedia,
  ],
  providerEnabled: {
    // Synced "on" from a device where the OS handoff exists.
    [BUILTIN_PROVIDER_IDS.systemDictionary]: true,
    [BUILTIN_PROVIDER_IDS.wiktionary]: true,
    [BUILTIN_PROVIDER_IDS.wikipedia]: true,
  },
  webSearches: [],
};

// Provider rows use the compact `toggle-sm`; the panel's own preference
// switches (SettingsSwitchRow) use the default size, so this stays scoped to
// the sortable provider list as more switches are added below it.
const getToggles = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"].toggle-sm'));

beforeEach(() => {
  platform.supported = false;
  platform.available = false;
  platform.premium = true;
  platform.ios = false;
  platform.android = false;
  mocks.getLookupApps.mockReset().mockResolvedValue([]);
  mocks.setLookupApp.mockReset().mockResolvedValue(undefined);
  useCustomTranslatorStore.setState({ translators: [], loaded: true });
  mocks.importDictionaries.mockReset();
  mocks.selectFiles.mockReset();
  mocks.getAppService.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('preserves dictionary row dimensions when dragging over a differently sized row', () => {
  seedSettings(enabledSystemSettings);
  const useSortable = sortable.useSortable;
  vi.spyOn(sortable, 'useSortable').mockImplementation((options) => ({
    ...useSortable(options),
    transform: { x: 12, y: 24, scaleX: 0.5, scaleY: 1.5 },
  }));
  render(<CustomDictionaries onBack={() => {}} />);
  const row = screen.getAllByRole('button', { name: 'Drag to reorder' })[0]!.parentElement!;
  expect(row.style.transform).toContain('translate3d(12px, 24px, 0)');
  expect(row.style.transform).not.toContain('scale');
});

describe('CustomDictionaries — system-dictionary lock', () => {
  it('does not lock other toggles when System Dictionary is unsupported on this platform', () => {
    // Web: not supported. System Dictionary row is hidden and the synced flag
    // must not lock Wiktionary / Wikipedia.
    platform.supported = false;
    platform.available = false;
    seedSettings(enabledSystemSettings);

    const { container } = render(<CustomDictionaries onBack={() => {}} />);
    const toggles = getToggles(container);

    // Two visible rows (System Dictionary hidden on this platform).
    expect(toggles).toHaveLength(2);
    expect(toggles.every((t) => !t.disabled)).toBe(true);
    expect(toggles.some((t) => t.title === LOCKED_TITLE)).toBe(false);
  });

  it('locks other toggles when System Dictionary is supported and enabled', () => {
    // macOS: supported. Enabling System Dictionary is exclusive, so the other
    // providers stay read-only while the System row itself remains toggleable.
    platform.supported = true;
    platform.available = true;
    seedSettings(enabledSystemSettings);

    const { container } = render(<CustomDictionaries onBack={() => {}} />);
    const toggles = getToggles(container);

    // All three rows visible (System Dictionary first per providerOrder).
    expect(toggles).toHaveLength(3);
    const [systemToggle, ...otherToggles] = toggles;
    expect(systemToggle!.disabled).toBe(false);
    expect(systemToggle!.title).not.toBe(LOCKED_TITLE);
    expect(otherToggles.every((t) => t.disabled)).toBe(true);
    expect(otherToggles.every((t) => t.title === LOCKED_TITLE)).toBe(true);
  });
});

describe('CustomDictionaries — system dictionary fullscreen', () => {
  it('defaults to compact on iOS and saves the fullscreen choice', async () => {
    platform.ios = true;
    platform.supported = true;
    platform.available = true;
    seedSettings(enabledSystemSettings);
    const save = vi.fn().mockResolvedValue(undefined);
    useCustomDictionaryStore.setState({ saveCustomDictionaries: save });

    render(<CustomDictionaries onBack={() => {}} />);
    const toggle = screen.queryByRole('checkbox', { name: 'Fullscreen' });
    expect(toggle, 'iOS dictionary settings must offer fullscreen').not.toBeNull();
    expect((toggle as HTMLInputElement).checked).toBe(false);
    await waitFor(() => expect((toggle as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(toggle!);

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(useCustomDictionaryStore.getState().settings).toMatchObject({
      systemDictionaryFullscreen: true,
    });
    expect((screen.getByRole('checkbox', { name: 'Fullscreen' }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('prevents saving unhydrated dictionaries while the initial load is pending', async () => {
    platform.ios = true;
    seedSettings(enabledSystemSettings);
    let finishLoading!: (loaded: boolean) => void;
    const save = vi.fn().mockResolvedValue(undefined);
    useCustomDictionaryStore.setState({
      loadCustomDictionaries: () =>
        new Promise<boolean>((resolve) => {
          finishLoading = resolve;
        }),
      saveCustomDictionaries: save,
    });

    render(<CustomDictionaries onBack={() => {}} />);
    const toggle = screen.getByRole('checkbox', { name: 'Fullscreen' }) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    toggle.click();
    expect(save).not.toHaveBeenCalled();

    await act(async () => finishLoading(true));
    expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(useCustomDictionaryStore.getState().settings.systemDictionaryFullscreen).toBe(true);
  });

  it.each([
    'service initialization',
    'file check',
  ])('preserves saved dictionaries when %s fails during initial loading', async (failure) => {
    platform.ios = true;
    const dictionary: ImportedDictionary = {
      id: 'saved-dictionary',
      contentId: 'saved-dictionary',
      kind: 'mdict',
      name: 'Saved Dictionary',
      bundleDir: 'saved-dictionary',
      files: { mdx: 'dictionary.mdx' },
      addedAt: 1,
    };
    const persistedSettings = { ...enabledSystemSettings, fontScale: 1.5 };
    const settingsBefore = useSettingsStore.getState();
    useSettingsStore.setState({
      settings: {
        ...settingsBefore.settings,
        customDictionaries: [dictionary],
        dictionarySettings: persistedSettings,
      },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    });
    useCustomDictionaryStore.setState({
      dictionaries: [],
      settings: useCustomDictionaryStore.getInitialState().settings,
      loadCustomDictionaries: useCustomDictionaryStore.getInitialState().loadCustomDictionaries,
      saveCustomDictionaries: useCustomDictionaryStore.getInitialState().saveCustomDictionaries,
    });
    const error = new Error('Dictionary storage unavailable');
    if (failure === 'service initialization') {
      mocks.getAppService.mockRejectedValue(error);
    } else {
      mocks.getAppService.mockResolvedValue({ exists: vi.fn().mockRejectedValue(error) });
    }
    vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await act(async () => {
        render(<CustomDictionaries onBack={() => {}} />);
      });
      const toggle = screen.getByRole('checkbox', { name: 'Fullscreen' }) as HTMLInputElement;
      await act(async () => toggle.click());
      expect(useSettingsStore.getState().settings.customDictionaries).toEqual([dictionary]);
      expect(useSettingsStore.getState().settings.dictionarySettings).toEqual(persistedSettings);
      expect(toggle.disabled).toBe(true);
    } finally {
      useSettingsStore.setState(settingsBefore);
    }
  });

  it('hides the iOS presentation preference on other platforms', () => {
    seedSettings(enabledSystemSettings);
    render(<CustomDictionaries onBack={() => {}} />);
    expect(screen.queryByRole('checkbox', { name: 'Fullscreen' })).toBeNull();
  });
});

describe('CustomDictionaries — Android lookup app (#4937)', () => {
  const eudic = {
    packageName: 'com.qianyan.eudic',
    className: 'com.eusoft.dict.activity.dict.LightpeekActivity',
    label: 'Eudic',
    selected: false,
  };
  const baidu = {
    packageName: 'com.baidu.searchbox',
    className: 'com.baidu.browser.search.LightSearchProcessTextActivity',
    label: 'Baidu Search',
    selected: false,
  };

  it('sends lookups to the app picked in Settings, or back to asking', async () => {
    platform.android = true;
    mocks.getLookupApps.mockResolvedValue([eudic, baidu]);
    seedSettings(enabledSystemSettings);
    render(<CustomDictionaries onBack={() => {}} />);

    const select = (await screen.findByRole('combobox', {
      name: 'Lookup App',
    })) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(Array.from(select.options).map((o) => o.text)).toEqual([
      'Ask Every Time',
      'Eudic',
      'Baidu Search',
    ]);

    fireEvent.change(select, { target: { value: `${eudic.packageName}/${eudic.className}` } });
    await waitFor(() =>
      expect(mocks.setLookupApp).toHaveBeenCalledWith(
        expect.objectContaining({ packageName: eudic.packageName, className: eudic.className }),
      ),
    );
    expect(select.value).toBe(`${eudic.packageName}/${eudic.className}`);

    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(mocks.setLookupApp).toHaveBeenLastCalledWith(null));
  });

  it('shows the saved app as selected', async () => {
    platform.android = true;
    mocks.getLookupApps.mockResolvedValue([eudic, { ...baidu, selected: true }]);
    seedSettings(enabledSystemSettings);
    render(<CustomDictionaries onBack={() => {}} />);

    const select = (await screen.findByRole('combobox', {
      name: 'Lookup App',
    })) as HTMLSelectElement;
    expect(select.value).toBe(`${baidu.packageName}/${baidu.className}`);
  });

  it('hides the picker when no app can take a lookup, and off Android', async () => {
    platform.android = true;
    seedSettings(enabledSystemSettings);
    render(<CustomDictionaries onBack={() => {}} />);
    await waitFor(() => expect(mocks.getLookupApps).toHaveBeenCalled());
    expect(screen.queryByRole('combobox', { name: 'Lookup App' })).toBeNull();
    cleanup();

    platform.android = false;
    mocks.getLookupApps.mockClear().mockResolvedValue([eudic]);
    render(<CustomDictionaries onBack={() => {}} />);
    expect(screen.queryByRole('combobox', { name: 'Lookup App' })).toBeNull();
    expect(mocks.getLookupApps).not.toHaveBeenCalled();
  });
});

describe('CustomDictionaries — import progress', () => {
  it('shows the Yomitan indexing percentage while a ZIP import is running', async () => {
    seedSettings({ providerOrder: [], providerEnabled: {}, webSearches: [] });
    mocks.selectFiles.mockResolvedValue({
      files: [{ file: new File(['dictionary'], 'jitendex.zip') }],
    });

    let finishImport: ((result: unknown) => void) | undefined;
    mocks.importDictionaries.mockImplementation(
      (
        _files: unknown,
        _existing: unknown,
        onProgress?: (progress: { stage: string; completed: number; total?: number }) => void,
      ) =>
        new Promise((resolve) => {
          finishImport = resolve;
          onProgress?.({ stage: 'indexing', completed: 1, total: 4 });
        }),
    );

    render(<CustomDictionaries onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import Dictionary' }));

    expect(
      (await screen.findByRole('button', { name: 'Indexing… 25%' })) as HTMLButtonElement,
    ).toMatchObject({ disabled: true });

    await act(async () => {
      finishImport?.({ imported: [], replacements: [], orphanFiles: [] });
    });
    expect(
      (await screen.findByRole('button', { name: 'Import Dictionary' })) as HTMLButtonElement,
    ).toMatchObject({ disabled: false });
  });

  it('reports a failed plugin source while retaining successful imports', async () => {
    seedSettings({ providerOrder: [], providerEnabled: {}, webSearches: [] });
    mocks.selectFiles.mockResolvedValue({
      files: [
        { file: new File(['valid'], 'valid.zip') },
        { file: new File(['broken'], 'broken.zip') },
      ],
    });
    mocks.importDictionaries.mockResolvedValue({
      imported: [],
      replacements: [],
      orphanFiles: [],
      importErrors: [{ name: 'broken.zip', message: 'Invalid Yomitan bank' }],
    });
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');

    render(<CustomDictionaries onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import Dictionary' }));

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        'toast',
        expect.objectContaining({
          type: 'error',
          message: 'Failed to import dictionary: broken.zip: Invalid Yomitan bank',
        }),
      ),
    );
  });
});

describe('CustomDictionaries — auto-play pronunciation (#6265)', () => {
  const baseSettings: DictionarySettings = {
    providerOrder: [BUILTIN_PROVIDER_IDS.wiktionary],
    providerEnabled: { [BUILTIN_PROVIDER_IDS.wiktionary]: true },
    webSearches: [],
  };

  it('reflects the stored setting and persists a toggle', async () => {
    const saveCustomDictionaries = vi.fn().mockResolvedValue(undefined);
    seedSettings({ ...baseSettings, autoPlayPronunciation: false });
    useCustomDictionaryStore.setState({ saveCustomDictionaries });

    render(<CustomDictionaries onBack={() => {}} />);
    const toggle = screen.getByRole('checkbox', { name: 'Auto-play Pronunciation' });
    expect((toggle as HTMLInputElement).checked).toBe(false);

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(useCustomDictionaryStore.getState().settings.autoPlayPronunciation).toBe(true);
    expect(saveCustomDictionaries).toHaveBeenCalled();
  });
});

describe('CustomDictionaries — context dictionary (#5544)', () => {
  const llm = (id: string): CustomTranslator => ({
    id,
    type: 'openai-compatible',
    name: `LLM ${id}`,
    addedAt: 1,
    updatedAt: 1,
  });
  const contextSettings: DictionarySettings = {
    providerOrder: [BUILTIN_PROVIDER_IDS.context],
    providerEnabled: { [BUILTIN_PROVIDER_IDS.context]: false },
    webSearches: [],
  };

  it('cannot be enabled until an OpenAI-compatible translator exists', () => {
    seedSettings(contextSettings);
    const { container } = render(<CustomDictionaries onBack={() => {}} />);
    expect(screen.getByText('Context Dictionary')).toBeTruthy();
    expect(screen.queryByText('AI')).toBeNull();
    expect(getToggles(container)[0]!.disabled).toBe(true);
    expect(screen.getByText(/Add an OpenAI-compatible translator/)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'AI Translator' })).toBeNull();
  });

  it('cannot be enabled without premium', () => {
    platform.premium = false;
    useCustomTranslatorStore.setState({ translators: [llm('a')], loaded: true });
    seedSettings(contextSettings);
    const { container } = render(<CustomDictionaries onBack={() => {}} />);
    expect(getToggles(container)[0]!.disabled).toBe(true);
  });

  it('saves custom dictionary instructions and an output limit independently of translation', async () => {
    useCustomTranslatorStore.setState({ translators: [llm('a')], prompts: [], loaded: true });
    seedSettings(contextSettings);
    const saveCustomDictionaries = vi.fn().mockResolvedValue(undefined);
    useCustomDictionaryStore.setState({ saveCustomDictionaries });
    render(<CustomDictionaries onBack={() => {}} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Prompt' }), {
      target: { value: 'custom' },
    });
    const instructions = screen.getByRole('textbox', { name: 'Dictionary Instructions' });
    fireEvent.change(instructions, {
      target: { value: 'Explain the historical slang. Skip synonyms.' },
    });
    fireEvent.blur(instructions);
    const tokens = screen.getByRole('spinbutton', { name: 'Maximum Output Tokens' });
    fireEvent.change(tokens, { target: { value: '4096' } });
    fireEvent.blur(tokens);

    await waitFor(() => expect(saveCustomDictionaries).toHaveBeenCalled());
    expect(useCustomDictionaryStore.getState().settings).toMatchObject({
      contextPromptId: 'custom',
      contextSystemPrompt: 'Explain the historical slang. Skip synonyms.',
      contextMaxOutputTokens: 4096,
    });
    expect(useCustomTranslatorStore.getState().translators[0]).toEqual(llm('a'));
  });

  it.each(['instructions', 'tokens'])('persists %s when dismissed without blurring', (field) => {
    useCustomTranslatorStore.setState({ translators: [llm('a')], prompts: [], loaded: true });
    seedSettings({ ...contextSettings, contextPromptId: 'custom' });
    let persisted: DictionarySettings | undefined;
    useCustomDictionaryStore.setState({
      saveCustomDictionaries: async () => {
        persisted = { ...useCustomDictionaryStore.getState().settings };
      },
    });
    const { unmount } = render(<CustomDictionaries onBack={() => {}} />);
    const input =
      field === 'instructions'
        ? screen.getByRole('textbox', { name: 'Dictionary Instructions' })
        : screen.getByRole('spinbutton', { name: 'Maximum Output Tokens' });
    input.focus();
    fireEvent.change(input, {
      target: { value: field === 'instructions' ? 'Explain the era.' : '4096' },
    });
    unmount();

    expect(persisted).toMatchObject(
      field === 'instructions'
        ? { contextSystemPrompt: 'Explain the era.' }
        : { contextMaxOutputTokens: 4096 },
    );
  });

  it('offers saved prompts and falls back to the built-in prompt after deletion', () => {
    useCustomTranslatorStore.setState({
      translators: [llm('a')],
      prompts: [
        {
          id: 'history',
          name: 'Historical context',
          systemPrompt: 'Explain the era.',
          addedAt: 1,
          updatedAt: 1,
        },
      ],
      loaded: true,
    });
    seedSettings({ ...contextSettings, contextPromptId: 'history' });
    render(<CustomDictionaries onBack={() => {}} />);
    expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLSelectElement).value).toBe(
      'history',
    );
    act(() => useCustomTranslatorStore.setState({ prompts: [] }));
    expect((screen.getByRole('combobox', { name: 'Prompt' }) as HTMLSelectElement).value).toBe(
      'default',
    );
  });

  it('lets the user pick which translator answers', async () => {
    useCustomTranslatorStore.setState({ translators: [llm('a'), llm('b')], loaded: true });
    seedSettings(contextSettings);
    const { container } = render(<CustomDictionaries onBack={() => {}} />);
    expect(getToggles(container)[0]!.disabled).toBe(false);

    const select = screen.getByRole('combobox', { name: 'AI Translator' }) as HTMLSelectElement;
    expect(select.value).toBe('a');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'b' } });
    });
    expect(useCustomDictionaryStore.getState().settings.contextTranslatorId).toBe('b');
  });
});
