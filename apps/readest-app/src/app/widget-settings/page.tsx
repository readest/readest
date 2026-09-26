'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useThemeStore } from '@/store/themeStore';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { popNavigationOrGoToLibrary } from '@/utils/nav';
import { discoverBookshelfFields } from '@/services/bookshelves/fields';
import type { BookshelfDefinition } from '@/types/bookshelf';
import { LibraryGroupByType } from '@/types/settings';
import {
  DEFAULT_BOOKSHELF_WIDGET_GRID,
  MIN_GRID_SIZE,
  MAX_GRID_SIZE,
  checkWidgetShelf,
  refreshBookshelfWidget,
  normalizeWidgetShelf,
  parseWidgetShelf,
} from '@/services/widget/bookshelfWidget';
import {
  getBookshelfWidgetInstances,
  setBookshelfWidgetSettings,
  moveTaskToBack,
} from '@/utils/bridge';
import type { BookshelfWidgetInstance } from '@/utils/bridge';
import { SettingsRow, SettingsInput, SettingsSwitchRow } from '@/components/settings/primitives';
import NumberInput from '@/components/settings/NumberInput';
import Spinner from '@/components/Spinner';
import BookshelfFilterEditor from '@/app/library/components/BookshelfFilterEditor';
import BookshelfExclusivitySection from '@/app/library/components/BookshelfExclusivitySection';
import BookshelfGroupingSection from '@/app/library/components/BookshelfGroupingSection';
import BookshelfSortingSection from '@/app/library/components/BookshelfSortingSection';

/**
 * In-app settings screen for one bookshelf-widget instance, reached via the
 * `readest://widget-settings/{appWidgetId}` deep link sent by the native
 * configure Activity - kept in-app so it has live access to the library.
 * Edits are a draft: Save stores them and answers the launcher's configure
 * request, while Back (or Home) discards them.
 */
const WidgetSettingsContent = () => {
  const _ = useTranslation();
  const router = useAppRouter();
  const searchParams = useSearchParams();
  const { appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const library = useLibraryStore((s) => s.library);
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);

  useTheme({ systemUIVisible: false });

  // Reveals whatever was open before the deep link, once: leaving and the
  // Home-triggered hide can both fire.
  const hasPoppedNavigationRef = useRef(false);
  const popNavigation = () => {
    if (hasPoppedNavigationRef.current) return;
    hasPoppedNavigationRef.current = true;
    popNavigationOrGoToLibrary(router);
  };

  // Backgrounds the app like Home and tells native how to answer the launcher.
  // The Back interception is needed or Back would close the reader's book.
  const leave = (saved: boolean) => {
    moveTaskToBack(saved).catch((err) => console.warn('Failed to answer the launcher', err));
    popNavigation();
  };
  useKeyDownActions({ onCancel: () => leave(false) });

  const appWidgetId = Number(searchParams?.get('appWidgetId') ?? NaN);
  // The draft being edited: the instance's grid settings, plus its shelf
  // parsed out of JSON. The shelf can be invalid mid-edit (a new condition
  // starts blank), which only disables Save.
  const [draft, setDraft] = useState<
    (Omit<BookshelfWidgetInstance, 'shelf'> & { shelf: BookshelfDefinition }) | null
  >(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!Number.isInteger(appWidgetId)) return;
    let cancelled = false;
    const fallback: BookshelfWidgetInstance = {
      appWidgetId,
      ...DEFAULT_BOOKSHELF_WIDGET_GRID,
      shelf: '',
    };
    getBookshelfWidgetInstances()
      .then(({ instances }) => instances.find((i) => i.appWidgetId === appWidgetId))
      .catch(() => undefined)
      .then((instance) => {
        if (cancelled) return;
        const { shelf: shelfJson, ...grid } = instance ?? fallback;
        setDraft({ ...grid, shelf: parseWidgetShelf(shelfJson) });
      });
    return () => {
      cancelled = true;
    };
  }, [appWidgetId]);

  // Home sends no Back event; it discards the draft and the launcher cancels.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') popNavigation();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fields = useMemo(() => discoverBookshelfFields(library), [library]);
  const shelfCheck = useMemo(() => (draft ? checkWidgetShelf(draft.shelf) : null), [draft]);
  const canSave = !!draft && !!shelfCheck?.success && !saving;

  const applyShelf = (patch: Partial<BookshelfDefinition>) =>
    setDraft((prev) => (prev ? { ...prev, shelf: { ...prev.shelf, ...patch } } : prev));
  const applyGrid = (patch: Partial<Omit<BookshelfWidgetInstance, 'shelf'>>) =>
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));

  const save = async () => {
    if (!draft || !canSave) return;
    setSaving(true);
    const { shelf, ...grid } = draft;
    try {
      await setBookshelfWidgetSettings({
        ...grid,
        shelf: JSON.stringify(normalizeWidgetShelf(shelf)),
      });
    } catch (err) {
      console.warn('Failed to save widget settings', err);
      setSaving(false);
      return;
    }
    // Refreshes every widget, since exclusivity means this one's shelf can change
    // what the others show. Best effort: the periodic refresh catches a failed
    // push, and a real TTS session reasserts itself on that refresh.
    if (appService && libraryLoaded) {
      try {
        await refreshBookshelfWidget(appService, _('Your books will appear here'));
      } catch (err) {
        console.warn('Failed to refresh bookshelf widget', err);
      }
    }
    leave(true);
  };

  return (
    <div className='bg-base-100 full-height inset-0 select-none overflow-hidden'>
      <div
        className='flex h-full w-full flex-col items-center overflow-y-auto'
        style={{ paddingTop: `${safeAreaInsets?.top || 0}px` }}
      >
        <div className='w-full min-w-60 max-w-2xl px-6 py-16'>
          <div className='mb-6 flex items-center justify-between gap-x-2'>
            <h1 className='text-xl font-semibold'>{_('Settings')}</h1>
            <div className='flex gap-x-2'>
              <button className='btn btn-ghost btn-sm eink-bordered' onClick={() => leave(false)}>
                {_('Cancel')}
              </button>
              <button className='btn btn-contrast btn-sm' disabled={!canSave} onClick={save}>
                {_('Save')}
              </button>
            </div>
          </div>
          {!draft ? (
            <div className='flex justify-center py-10'>
              <Spinner loading />
            </div>
          ) : (
            <div className='flex flex-col gap-y-6'>
              <fieldset className='eink-bordered border-base-200 min-w-0 rounded-lg border ps-4'>
                <legend className='-ms-1 px-1 text-sm'>{_('Appearance')}</legend>
                <div className='divide-base-200 divide-y'>
                  <SettingsRow label={_('Name')}>
                    <SettingsInput
                      value={draft.shelf.name}
                      placeholder={_('None')}
                      onChange={(e) => applyShelf({ name: e.target.value })}
                    />
                  </SettingsRow>
                  <SettingsSwitchRow
                    label={_('Book title')}
                    checked={draft.showTitles}
                    onChange={() => applyGrid({ showTitles: !draft.showTitles })}
                  />
                  <NumberInput
                    label={_('Rows')}
                    value={draft.gridRows}
                    min={MIN_GRID_SIZE}
                    max={MAX_GRID_SIZE}
                    onChange={(gridRows) => applyGrid({ gridRows })}
                  />
                  <NumberInput
                    label={_('Columns')}
                    value={draft.gridColumns}
                    min={MIN_GRID_SIZE}
                    max={MAX_GRID_SIZE}
                    onChange={(gridColumns) => applyGrid({ gridColumns })}
                  />
                </div>
              </fieldset>

              <BookshelfFilterEditor
                group={draft.shelf.filters}
                fields={fields}
                onChange={(filters) => applyShelf({ filters })}
              />
              {!shelfCheck?.success && (
                <p role='alert' className='text-error text-sm'>
                  {_(shelfCheck?.error.issues[0]?.message || 'Complete every filter condition.')}
                </p>
              )}
              <BookshelfGroupingSection shelf={draft.shelf} onChange={applyShelf}>
                <SettingsSwitchRow
                  label={_('Mosaic covers')}
                  checked={draft.groupMosaic}
                  disabled={draft.shelf.groupBy === LibraryGroupByType.None}
                  onChange={() => applyGrid({ groupMosaic: !draft.groupMosaic })}
                />
              </BookshelfGroupingSection>
              <BookshelfSortingSection shelf={draft.shelf} onChange={applyShelf} />
              <BookshelfExclusivitySection
                shelf={draft.shelf}
                onChange={applyShelf}
                description={_('Matching books belong to the oldest exclusive widget')}
                includeLabel={_('Include books from exclusive widgets')}
                isValid={(candidate) => checkWidgetShelf(candidate).success}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// useSearchParams (used by WidgetSettingsContent) requires a Suspense
// boundary in an ancestor (Next 16), mirrors src/app/s/page.tsx.
const WidgetSettingsPage = () => (
  <Suspense fallback={null}>
    <WidgetSettingsContent />
  </Suspense>
);

export default WidgetSettingsPage;
