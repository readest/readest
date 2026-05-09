'use client';

import clsx from 'clsx';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
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
    settings: {
      title: _('App settings'),
      description: _(
        'Theme, highlight colours, integrations (KOSync, Readwise, Hardcover), and dictionary order',
      ),
    },
    credentials: {
      title: _('Credentials'),
      description: _(
        'Tokens, usernames, and passwords for OPDS, KOReader, Hardcover, and Readwise. When disabled, credentials remain on this device only and are never uploaded.',
      ),
    },
  };
};

export function SyncCategoriesSection() {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const copy = useCategoryCopy();

  if (!settings) return null;

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

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-col gap-2'>
        <h3 className='text-base-content text-lg font-semibold'>{_('Manage Sync')}</h3>
        <p className='text-base-content/70 text-sm'>
          {_(
            'Choose what syncs across your devices. Disabling a category stops this device from sending or receiving rows of that kind. Anything already on the server is left alone, re-enabling resumes from where you stopped.',
          )}
        </p>
      </div>
      <ul className='border-base-300 divide-base-300 divide-y rounded-lg border'>
        {SYNC_CATEGORIES.map((category) => {
          const c = copy[category];
          const on = enabled(category);
          const locked = isSyncCategoryLocked(category);
          return (
            <li key={category} className='flex items-center justify-between gap-4 px-4 py-3'>
              <div className='flex flex-col gap-0.5'>
                <span className='text-base-content text-sm font-medium'>{c.title}</span>
                <span className='text-base-content/60 text-xs'>
                  {locked ? _('Required while Dictionaries sync is enabled') : c.description}
                </span>
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
                className={clsx(
                  'toggle toggle-primary eink-bordered',
                  locked && 'cursor-not-allowed',
                )}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
