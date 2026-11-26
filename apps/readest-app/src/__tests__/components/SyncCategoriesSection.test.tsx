// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { UserPlan } from '@/types/quota';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * The Manage Sync panel reads every row from the settings store, so it must
 * not render before that store is hydrated: a cold /user load would show each
 * category's default instead of the user's real choice, and flipping a row
 * would write the empty object back over their settings.
 */

const saveSettings = vi.fn(async () => {});
// useEnsureSettingsLoaded reads through this when the store is unhydrated.
const loadSettings = vi.fn(async () => useSettingsStore.getState().settings);

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ saveSettings, loadSettings }) },
    appService: null,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string>) =>
    key.replace(/\{\{(\w+)\}\}/g, (match, name) => options?.[name] ?? match),
}));

vi.mock('@/utils/settingsSync', () => ({
  broadcastGlobalSettings: vi.fn(),
}));

import { SyncCategoriesSection } from '@/app/user/components/SyncCategoriesSection';

const base = {
  version: 1,
  webdav: { enabled: false },
  googleDrive: { enabled: false },
  s3: { enabled: false },
  onedrive: { enabled: false },
  icloud: { enabled: false },
  syncCategories: {},
} as unknown as SystemSettings;

const row = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

const renderSection = (userPlan: UserPlan = 'plus') =>
  render(<SyncCategoriesSection userPlan={userPlan} customizationPurchased={false} />);

const accountSubtitle =
  'Always synced via Readest Cloud while signed in; turning a category off keeps it on this device';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('SyncCategoriesSection', () => {
  test('renders nothing until the settings store is hydrated', () => {
    // A refreshed /user renders cold: every category would read its default,
    // misreporting the user's choices, and toggling a row would persist that
    // empty object over them.
    useSettingsStore.setState({ settings: {} as SystemSettings } as never);
    renderSection();
    expect(screen.queryByLabelText('Books')).toBeNull();
  });

  test('renders the categories once hydrated', () => {
    useSettingsStore.setState({ settings: base } as never);
    renderSection();
    expect(row('Books').checked).toBe(true);
    expect(row('App settings').checked).toBe(true);
  });

  test('fonts read as managed by the file provider while Readest Cloud is off (#7793)', () => {
    useSettingsStore.setState({
      settings: { ...base, readestCloud: { enabled: false }, webdav: { enabled: true } },
    } as never);
    renderSection();
    const managed = 'Managed by WebDAV while it is your cloud sync provider';
    expect(row('Fonts').closest('li')!.textContent).toContain(managed);
    expect(row('Dictionaries').closest('li')!.textContent).not.toContain(managed);
  });

  test('fonts name only the file providers whose Sync Custom Fonts is on (#7965)', () => {
    useSettingsStore.setState({
      settings: {
        ...base,
        readestCloud: { enabled: false },
        webdav: { enabled: true, syncFonts: false },
        googleDrive: { enabled: true },
      },
    } as never);
    renderSection();
    expect(row('Fonts').closest('li')!.textContent).toContain(
      'Managed by Google Drive while it is your cloud sync provider',
    );
    expect(row('Books').closest('li')!.textContent).toContain(
      'Managed by WebDAV, Google Drive while it is your cloud sync provider',
    );
  });

  test('fonts read as local only when no file provider syncs them (#7965)', () => {
    useSettingsStore.setState({
      settings: {
        ...base,
        readestCloud: { enabled: false },
        webdav: { enabled: true, syncFonts: false },
      },
    } as never);
    renderSection();
    expect(row('Fonts').closest('li')!.textContent).toContain('Local only');
    expect(row('Fonts').closest('li')!.textContent).not.toContain('Managed by');
    expect(row('Books').closest('li')!.textContent).toContain('Managed by WebDAV');
  });

  test('fonts leave out a parallel provider with Sync Custom Fonts off (#7965)', () => {
    useSettingsStore.setState({
      settings: {
        ...base,
        readestCloud: { enabled: true },
        webdav: { enabled: true, syncFonts: false },
      },
    } as never);
    renderSection();
    const fonts = row('Fonts').closest('li')!.textContent;
    expect(fonts).toContain('Readest Cloud');
    expect(fonts).not.toContain('WebDAV');
    expect(row('Books').closest('li')!.textContent).toContain('WebDAV');

    cleanup();
    useSettingsStore.setState({
      settings: {
        ...base,
        readestCloud: { enabled: true },
        webdav: { enabled: true, syncFonts: false },
        syncCategories: { font: false },
      },
    } as never);
    renderSection();
    expect(row('Fonts').closest('li')!.textContent).not.toContain('still synced via');
  });

  test('groups Library & Media separately from Account & Preferences without redundant Account pills', () => {
    useSettingsStore.setState({ settings: base } as never);
    renderSection();

    expect(screen.getByText('Library & Media')).toBeTruthy();
    expect(screen.getByText('Synced to Readest Cloud')).toBeTruthy();
    expect(screen.getByText('Account & Preferences')).toBeTruthy();
    expect(screen.getByText(accountSubtitle)).toBeTruthy();
    expect(row('Books').closest('li')!.textContent).toContain('Readest Cloud');
    expect(row('Dictionaries').closest('li')!.textContent).not.toContain('Readest Cloud');
  });

  test('says Account & Preferences still sync via Readest Cloud with its library switch off', () => {
    // Replica categories never read the Readest Cloud switch: they sync while
    // signed in whatever the Cloud Sync selection is.
    useSettingsStore.setState({
      settings: { ...base, readestCloud: { enabled: false }, googleDrive: { enabled: true } },
    } as never);
    renderSection();
    expect(screen.getByText(accountSubtitle)).toBeTruthy();
  });

  test('shows parallel destination badges when both Readest Cloud and Google Drive are enabled', () => {
    useSettingsStore.setState({
      settings: {
        ...base,
        readestCloud: { enabled: true },
        googleDrive: { enabled: true },
        syncCategories: { book: false, book_data: false },
      },
    } as never);
    renderSection();

    expect(screen.getByText('Synced to Readest Cloud, Google Drive')).toBeTruthy();

    const progressLi = row('Reading progress').closest('li')!.textContent;
    expect(progressLi).toContain('Readest Cloud');
    expect(progressLi).toContain('Google Drive');

    const booksItem = row('Books').closest('li')!;
    const booksHeader = booksItem.querySelector('div > div')!.textContent;
    expect(booksHeader).not.toContain('Readest Cloud');
    expect(booksHeader).toContain('Google Drive');
    expect(booksItem.textContent).toContain(
      'Readest Cloud sync is off; still synced via Google Drive',
    );

    const bookDataLi = row('Book Data').closest('li')!.textContent;
    expect(bookDataLi).not.toContain('Readest Cloud');
    expect(bookDataLi).not.toContain('Google Drive');

    const dictLi = row('Dictionaries').closest('li')!.textContent;
    expect(dictLi).not.toContain('Readest Cloud');
    expect(dictLi).not.toContain('Google Drive');
  });

  test('shows Book Data synced to third-party only when Readest Cloud is off, and supports multiple providers', () => {
    useSettingsStore.setState({
      settings: {
        ...base,
        readestCloud: { enabled: false },
        webdav: { enabled: true },
        syncCategories: { book_data: true },
      },
    } as never);
    renderSection();
    expect(screen.getByText('Synced to WebDAV')).toBeTruthy();

    cleanup();
    useSettingsStore.setState({
      settings: {
        ...base,
        readestCloud: { enabled: false },
        webdav: { enabled: true },
        googleDrive: { enabled: true },
        syncCategories: { book_data: true },
      },
    } as never);
    renderSection();

    expect(screen.getByText('Synced to WebDAV, Google Drive')).toBeTruthy();
    expect(row('Book Data').closest('li')!.textContent).toContain('WebDAV');
    expect(row('Book Data').closest('li')!.textContent).toContain('Google Drive');
    expect(row('Book Data').closest('li')!.textContent).not.toContain('Readest Cloud');
    expect(row('Dictionaries').closest('li')!.textContent).not.toContain('Readest Cloud');
  });

  test('shows Local only when no cloud sync provider is active and paused notice when third-party is paused', () => {
    useSettingsStore.setState({
      settings: { ...base, readestCloud: { enabled: false } },
    } as never);
    renderSection();

    expect(
      screen.getByText('Not syncing — enable a cloud sync provider in Settings → Integrations'),
    ).toBeTruthy();
    expect(row('Books').closest('li')!.textContent).toContain('Local only');
    expect(row('Dictionaries').closest('li')!.textContent).not.toContain('Local only');

    cleanup();
    useSettingsStore.setState({
      settings: {
        ...base,
        readestCloud: { enabled: false },
        googleDrive: { enabled: true },
      },
    } as never);
    renderSection('free');

    expect(
      screen.getByText('Paused on Google Drive — upgrade or enable Readest Cloud to resume'),
    ).toBeTruthy();
    expect(row('Books').closest('li')!.textContent).toContain('Local only');
  });

  test('says the third-party provider is paused while Readest Cloud keeps syncing', () => {
    useSettingsStore.setState({
      settings: { ...base, readestCloud: { enabled: true }, googleDrive: { enabled: true } },
    } as never);
    renderSection('free');

    expect(
      screen.getByText('Synced to Readest Cloud; paused on Google Drive — upgrade to resume'),
    ).toBeTruthy();
    const booksLi = row('Books').closest('li')!.textContent;
    expect(booksLi).toContain('Readest Cloud');
    expect(booksLi).not.toContain('Google Drive');
  });
});
