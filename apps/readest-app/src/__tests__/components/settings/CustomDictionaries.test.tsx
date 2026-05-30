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
import { render, cleanup } from '@testing-library/react';

import CustomDictionaries from '@/components/settings/CustomDictionaries';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';
import type { DictionarySettings } from '@/services/dictionaries/types';

// Per-test platform control. `isSystemDictionaryEnabled` (real, from the
// registry) reads `isSystemDictionarySupported`, so toggling these flips both
// the row visibility and the lock gate the component now relies on.
const platform = vi.hoisted(() => ({ supported: false, available: false }));
vi.mock('@/services/dictionaries/systemDictionary', () => ({
  isSystemDictionarySupported: () => platform.supported,
  isSystemDictionaryAvailable: () => platform.available,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: {}, envConfig: {} }),
}));

vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({ selectFiles: vi.fn() }),
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
    loadCustomDictionaries: async () => {},
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

const getToggles = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));

beforeEach(() => {
  platform.supported = false;
  platform.available = false;
});

afterEach(() => {
  cleanup();
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
