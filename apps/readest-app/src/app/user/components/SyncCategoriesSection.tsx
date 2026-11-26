'use client';

import clsx from 'clsx';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnsureSettingsLoaded } from '@/hooks/useEnsureSettingsLoaded';
import {
  isReadestCloudEnabled,
  getEnabledFileSyncBackends,
  cloudProviderDisplayName,
  cloudProvidersDisplayName,
  type CloudSyncProviderKind,
} from '@/services/sync/cloudSyncProvider';
import {
  SYNC_CATEGORIES,
  isSyncCategoryLocked,
  type SyncCategory,
} from '@/services/sync/syncCategories';
import type { SystemSettings } from '@/types/settings';

interface CategoryCopy {
  title: string;
  description: string;
}

const LIBRARY_MEDIA_SET: ReadonlySet<SyncCategory> = new Set([
  'book',
  'progress',
  'note',
  'book_data',
  'font',
]);

const PROVIDER_GATED_SET: ReadonlySet<SyncCategory> = new Set(['book', 'progress', 'note', 'font']);

const LIBRARY_MEDIA_CATEGORIES = SYNC_CATEGORIES.filter((c) => LIBRARY_MEDIA_SET.has(c));
const ACCOUNT_PREFERENCE_CATEGORIES = SYNC_CATEGORIES.filter((c) => !LIBRARY_MEDIA_SET.has(c));

const pillBaseClass = 'eink-bordered rounded-full border px-2 py-0.5 text-[11px] font-medium';

const useCategoryCopy = (): Record<SyncCategory, CategoryCopy> => {
  const _ = useTranslation();
  return {
    book: {
      title: _('Books'),
      description: _('Imported book files and library metadata'),
    },
    progress: {
      title: _('Reading progress'),
      description: _('Last-read position, bookmarks, and per-book preferences'),
    },
    note: {
      title: _('Annotations'),
      description: _('Highlights and notes'),
    },
    book_data: {
      title: _('Book Data'),
      description: _('Downloaded read-aloud audio and translations'),
    },
    dictionary: {
      title: _('Dictionaries'),
      description: _('Imported dictionary bundles and settings'),
    },
    font: {
      title: _('Fonts'),
      description: _('Custom font files'),
    },
    texture: {
      title: _('Backgrounds'),
      description: _('Custom background textures'),
    },
    opds_catalog: {
      title: _('OPDS catalogs'),
      description: _('Saved catalog URLs and (encrypted) credentials'),
    },
    abs_server: {
      title: _('Audiobookshelf Servers'),
      description: _('Saved server URLs and (encrypted) credentials'),
    },
    custom_translator: {
      title: _('Translators'),
      description: _('Custom translation providers, prompts, and (encrypted) API keys'),
    },
    custom_tts: {
      title: _('TTS Services'),
      description: _('Custom text-to-speech services and (encrypted) API keys'),
    },
    vocabulary: {
      title: _('Vocabulary'),
      description: _('Looked-up words, their sentences, and Learning / Mastered marks'),
    },
    settings: {
      // Dictionary preferences ride this row too, but they're gated by the
      // Dictionaries toggle above, so they're deliberately not listed here.
      title: _('App settings'),
      description: _('Theme, highlight colours, and integrations (KOSync, Readwise, Hardcover)'),
    },
    credentials: {
      title: _('Credentials'),
      description: _(
        'Tokens, usernames, and passwords for OPDS, KOReader, Hardcover, Readwise, and WebDAV. When disabled, credentials remain on this device only and are never uploaded.',
      ),
    },
    stats: {
      title: _('Reading statistics'),
      description: _('Reading time and pages read, synced across your devices and KOReader.'),
    },
  };
};

interface SyncCategoriesSectionProps {
  thirdPartyPaused?: boolean;
}

export function SyncCategoriesSection({ thirdPartyPaused = false }: SyncCategoriesSectionProps) {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const hydrated = useEnsureSettingsLoaded();
  const copy = useCategoryCopy();
  const readestEnabled = isReadestCloudEnabled(settings);
  const backends = getEnabledFileSyncBackends(settings);
  const activeBackends = thirdPartyPaused ? [] : backends;
  const cloudProviderName = cloudProvidersDisplayName(backends);
  const activeProviderName = cloudProvidersDisplayName(activeBackends);

  // A refreshed /user renders before the store is hydrated, where every
  // category reads its default. Showing that would misreport the user's real
  // choices, and toggling a row would persist the empty object over them.
  if (!settings || !hydrated) return null;

  const enabled = (category: SyncCategory): boolean => {
    const value = settings.syncCategories?.[category];
    // 'credentials' is the only category that defaults OFF — sync of
    // sensitive fields (OPDS / KOSync / Readwise / Hardcover tokens) is
    // explicit opt-in. Every other category defaults ON when unset.
    if (category === 'credentials') return value === true;
    return value !== false;
  };

  const handleToggle = (category: SyncCategory, next: boolean) => {
    const updated: SystemSettings = {
      ...settings,
      syncCategories: {
        ...settings.syncCategories,
        [category]: next,
      },
    };
    setSettings(updated);
    void saveSettings(envConfig, updated);
  };

  const getDestinations = (category: SyncCategory, on: boolean): CloudSyncProviderKind[] => {
    if (PROVIDER_GATED_SET.has(category)) {
      return [...(readestEnabled && on ? (['readest'] as const) : []), ...activeBackends];
    }
    if (category === 'book_data') {
      if (!on) return [];
      return [
        ...(readestEnabled && enabled('book') ? (['readest'] as const) : []),
        ...activeBackends,
      ];
    }
    return [];
  };

  const librarySubtitle =
    readestEnabled && activeBackends.length > 0
      ? _(
          'Synced to Readest Cloud and {{provider}} in parallel — downloads use the first provider with the file',
          { provider: activeProviderName },
        )
      : readestEnabled
        ? _('Synced to Readest Cloud')
        : activeBackends.length > 1
          ? _(
              'Synced to {{provider}} in parallel — downloads use the first provider with the file',
              { provider: activeProviderName },
            )
          : activeBackends.length === 1
            ? _('Synced to {{provider}}', { provider: activeProviderName })
            : thirdPartyPaused && backends.length > 0
              ? _('Paused on {{provider}} — upgrade or enable Readest Cloud to resume', {
                  provider: cloudProviderName,
                })
              : _('Not syncing — enable a cloud sync provider in Settings → Integrations');

  const renderCategoryRow = (category: SyncCategory) => {
    const c = copy[category];
    const on = enabled(category);
    const locked = isSyncCategoryLocked(category);
    const isLibraryMedia = LIBRARY_MEDIA_SET.has(category);
    const isProviderGated = PROVIDER_GATED_SET.has(category);
    const destinations = getDestinations(category, on);

    // While Readest Cloud is switched off and a file backend is on, the
    // book / progress / note / font channels are routed to the file
    // backend at runtime and these toggles have no immediate effect. The
    // description says so in place (same pattern as `locked`), but the
    // toggle stays interactive and persists: it governs the native
    // channel the user returns to when Readest Cloud is re-enabled.
    const managedByProvider = !readestEnabled && activeBackends.length > 0 && isProviderGated;
    const readestOffWithMirror =
      readestEnabled && activeBackends.length > 0 && isProviderGated && !on;

    const description = managedByProvider
      ? _('Managed by {{provider}} while it is your cloud sync provider', {
          provider: activeProviderName,
        })
      : readestOffWithMirror
        ? _('Readest Cloud sync is off; still synced via {{provider}}', {
            provider: activeProviderName,
          })
        : locked
          ? _('Required while Dictionaries sync is enabled')
          : c.description;

    return (
      <li key={category} className='flex min-h-14 items-center justify-between gap-4 px-4 py-3'>
        <div className='flex flex-col gap-0.5'>
          <div className='flex flex-wrap items-center gap-1.5'>
            <span className='text-base-content text-sm font-medium'>{c.title}</span>
            {isLibraryMedia &&
              destinations.map((dest) => (
                <span
                  key={dest}
                  className={clsx(
                    pillBaseClass,
                    'not-eink:bg-base-content/10 text-base-content border-base-content/20',
                  )}
                >
                  {cloudProviderDisplayName(dest)}
                </span>
              ))}
            {isLibraryMedia && destinations.length === 0 && on && (
              <span
                className={clsx(
                  pillBaseClass,
                  'text-base-content/60 border-base-300 border-dashed bg-transparent',
                )}
              >
                {_('Local only')}
              </span>
            )}
          </div>
          <span className='text-base-content/60 text-xs'>{description}</span>
        </div>
        <input
          type='checkbox'
          role='switch'
          aria-label={c.title}
          aria-checked={on}
          aria-disabled={locked}
          checked={on}
          onChange={(e) => {
            // Locked: visually stays ON (the dependency forces it),
            // but the user can't flip it off. We intercept the
            // change instead of using `disabled` so the toggle
            // keeps its blue "on" colour rather than greying out.
            if (locked) return;
            handleToggle(category, e.target.checked);
          }}
          className={clsx('toggle', locked && 'cursor-not-allowed')}
        />
      </li>
    );
  };

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-col gap-2'>
        <h3 className='text-base-content text-lg font-semibold tracking-tight'>
          {_('Manage Sync')}
        </h3>
        <p className='text-base-content/70 text-sm leading-relaxed'>
          {_(
            'Choose what syncs across your devices. Disabling a category stops this device from sending or receiving rows of that kind. Anything already on the server is left alone, re-enabling resumes from where you stopped.',
          )}
        </p>
      </div>

      <div className='flex flex-col gap-2'>
        <div className='flex flex-col gap-0.5'>
          <h4 className='text-base-content text-sm font-semibold'>{_('Library & Media')}</h4>
          <p className='text-base-content/60 text-xs'>{librarySubtitle}</p>
        </div>
        <ul className='bg-base-100 border-base-300 divide-base-200 eink-bordered divide-y rounded-lg border'>
          {LIBRARY_MEDIA_CATEGORIES.map(renderCategoryRow)}
        </ul>
      </div>

      <div className='flex flex-col gap-2'>
        <div className='flex flex-col gap-0.5'>
          <h4 className='text-base-content text-sm font-semibold'>{_('Account & Preferences')}</h4>
          <p className='text-base-content/60 text-xs'>
            {_('Synced via Readest Cloud when enabled; turning a category off keeps it local')}
          </p>
        </div>
        <ul className='bg-base-100 border-base-300 divide-base-200 eink-bordered divide-y rounded-lg border'>
          {ACCOUNT_PREFERENCE_CATEGORIES.map(renderCategoryRow)}
        </ul>
      </div>
    </div>
  );
}
