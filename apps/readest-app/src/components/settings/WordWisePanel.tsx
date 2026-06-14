import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '@/helpers/settings';
import { getLocale } from '@/utils/misc';
import { formatBytes } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';
import { TRANSLATED_LANGS } from '@/services/constants';
import {
  WORD_WISE_MIN_LEVEL,
  WORD_WISE_MAX_LEVEL,
  cefrLabel,
} from '@/services/wordwise/difficulty';
import { toWordWiseSource } from '@/app/reader/utils/wordwiseSection';
import {
  deletePack,
  ensurePack,
  fetchManifest,
  getPackStatus,
  listAvailableTargets,
  type WordWiseManifest,
  type WordWisePack,
} from '@/services/wordwise/glossPacks';
import SubPageHeader from './SubPageHeader';
import { BoxedList, SettingsRow, SettingsSelect, SettingsSwitchRow } from './primitives';

interface WordWisePanelProps {
  bookKey: string;
  onBack: () => void;
}

const baseCode = (lang?: string | null): string => (lang || '').toLowerCase().split('-')[0] || '';

const WordWisePanel: React.FC<WordWisePanelProps> = ({ bookKey, onBack }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getViewSettings, setViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;
  const bookData = getBookData(bookKey);

  const appLang = baseCode(getLocale());
  const bookSource = toWordWiseSource(bookData?.book?.primaryLanguage);

  const [wordWiseEnabled, setWordWiseEnabled] = useState(viewSettings.wordWiseEnabled ?? false);
  const [wordWiseLevel, setWordWiseLevel] = useState(viewSettings.wordWiseLevel ?? 3);
  const [hintLang, setHintLang] = useState(viewSettings.wordWiseHintLang || appLang);
  const [autoDownload, setAutoDownload] = useState(
    settings.globalReadSettings.wordWiseAutoDownload ?? true,
  );

  const [manifest, setManifest] = useState<WordWiseManifest | null>(null);
  const [packStatus, setPackStatus] = useState<{ pack: WordWisePack; downloaded: boolean } | null>(
    null,
  );
  const [resolving, setResolving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  // Fetch the manifest once on mount to filter the hint-language selector and
  // resolve the data-pack row. If it fails, the selector falls back to the full
  // TRANSLATED_LANGS list (see availableTargets below).
  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    void fetchManifest(appService).then((m) => {
      if (!cancelled) setManifest(m);
    });
    return () => {
      cancelled = true;
    };
  }, [appService]);

  useEffect(() => {
    if (wordWiseEnabled === viewSettings.wordWiseEnabled) return;
    saveViewSettings(envConfig, bookKey, 'wordWiseEnabled', wordWiseEnabled, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordWiseEnabled]);

  useEffect(() => {
    if (wordWiseLevel === viewSettings.wordWiseLevel) return;
    saveViewSettings(envConfig, bookKey, 'wordWiseLevel', wordWiseLevel, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordWiseLevel]);

  // Re-resolve the data-pack row whenever the (source → hint) pair changes.
  useEffect(() => {
    if (!appService || !bookSource) {
      setPackStatus(null);
      return;
    }
    const hint = baseCode(hintLang) || appLang;
    if (!hint || hint === bookSource) {
      setPackStatus(null);
      return;
    }
    let cancelled = false;
    setResolving(true);
    void getPackStatus(appService, bookSource, hint)
      .then((status) => {
        if (!cancelled) setPackStatus(status);
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, bookSource, hintLang, appLang, manifest]);

  // The manifest's `target` codes are 2-letter base codes (en, zh, fr…), while
  // TRANSLATED_LANGS keys can be regional (zh-CN, pt-BR). Match by base code so
  // e.g. an en→zh pack surfaces the "简体中文"/"正體中文" options.
  const availableTargets = manifest && bookSource ? listAvailableTargets(manifest, bookSource) : [];

  const getHintLangOptions = () => {
    const entries = Object.entries(TRANSLATED_LANGS).map(([value, label]) => ({ value, label }));
    // When the manifest is available, restrict to the targets it offers for the
    // book's source language (matching the resolvable packs). Without a manifest
    // we show the full list so the selector stays usable offline.
    const filtered =
      availableTargets.length > 0
        ? entries.filter((o) => availableTargets.includes(baseCode(o.value)))
        : entries;
    filtered.sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: '', label: _('Auto') }, ...filtered];
  };

  const hintLangOptions = getHintLangOptions();

  // Map the stored hint (possibly '' = auto, or a base code like 'zh') to the
  // option that should appear selected. '' shows Auto; a base code resolves to
  // the first option whose base code matches (e.g. 'zh' → 'zh-CN').
  const selectedHintValue = (() => {
    const stored = viewSettings.wordWiseHintLang;
    if (!stored) return '';
    if (hintLangOptions.some((o) => o.value === stored)) return stored;
    const byBase = hintLangOptions.find((o) => baseCode(o.value) === baseCode(stored));
    return byBase?.value ?? '';
  })();

  const handleSelectHintLang = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value;
    setHintLang(option || appLang);
    saveViewSettings(envConfig, bookKey, 'wordWiseHintLang', option, false, false);
    viewSettings.wordWiseHintLang = option;
    setViewSettings(bookKey, { ...viewSettings });
  };

  const handleToggleAutoDownload = () => {
    const next = !autoDownload;
    setAutoDownload(next);
    settings.globalReadSettings.wordWiseAutoDownload = next;
    setSettings(settings);
    saveSettings(envConfig, settings);
  };

  const handleDownload = async () => {
    if (!appService || !packStatus || downloading) return;
    setDownloading(true);
    setProgress(0);
    try {
      const path = await ensurePack(appService, packStatus.pack, {
        allowDownload: true,
        onProgress: ({ progress: done, total }) => {
          if (total > 0) setProgress(Math.floor((done / total) * 100));
        },
      });
      if (path) {
        setPackStatus({ ...packStatus, downloaded: true });
        eventDispatcher.dispatch('toast', {
          type: 'success',
          message: _('Word Wise data downloaded'),
        });
      } else {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Failed to download Word Wise data'),
        });
      }
    } catch {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to download Word Wise data'),
      });
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  const handleDelete = async () => {
    if (!appService || !packStatus) return;
    await deletePack(appService, packStatus.pack);
    setPackStatus({ ...packStatus, downloaded: false });
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Word Wise data removed') });
  };

  const renderDataPackRow = () => {
    if (!bookSource) {
      return (
        <SettingsRow label={_('Data pack')}>
          <span className='text-base-content/60 settings-content text-end'>
            {_('Open a book to manage its data pack.')}
          </span>
        </SettingsRow>
      );
    }
    if (resolving) {
      return (
        <SettingsRow label={_('Data pack')}>
          <span className='loading loading-spinner loading-sm' />
        </SettingsRow>
      );
    }
    if (!packStatus) {
      return (
        <SettingsRow label={_('Data pack')}>
          <span className='text-base-content/60 settings-content text-end'>
            {_('No data available for this language pair yet.')}
          </span>
        </SettingsRow>
      );
    }
    const size = formatBytes(packStatus.pack.bytes);
    if (packStatus.downloaded) {
      return (
        <SettingsRow label={_('Data pack')} description={`${_('Downloaded')} · ${size}`}>
          <button
            type='button'
            onClick={handleDelete}
            className='btn btn-ghost btn-sm eink-bordered shrink-0'
          >
            {_('Delete')}
          </button>
        </SettingsRow>
      );
    }
    return (
      <SettingsRow label={_('Data pack')}>
        <div className='flex items-center gap-2'>
          {downloading && progress !== null && progress > 0 && (
            <div
              className='radial-progress flex items-center justify-center'
              style={
                {
                  '--value': progress,
                  '--size': '2.25rem',
                  fontSize: '0.6rem',
                  lineHeight: '0.8rem',
                } as React.CSSProperties
              }
              aria-valuenow={progress}
              role='progressbar'
            >
              {progress}%
            </div>
          )}
          <button
            type='button'
            onClick={handleDownload}
            disabled={downloading}
            className='btn btn-primary btn-sm shrink-0'
          >
            {_('Download {{size}}', { size })}
          </button>
        </div>
      </SettingsRow>
    );
  };

  return (
    <div className={clsx('my-4 w-full space-y-6')}>
      <SubPageHeader
        parentLabel={_('Language')}
        currentLabel={_('Word Wise')}
        description={_('Show a short native-language hint above difficult words.')}
        onBack={onBack}
      />

      <BoxedList title={_('Word Wise')} data-setting-id='settings.wordwise.main'>
        <SettingsSwitchRow
          label={_('Enable Word Wise')}
          checked={wordWiseEnabled}
          onChange={() => setWordWiseEnabled(!wordWiseEnabled)}
          data-setting-id='settings.wordwise.enabled'
        />
        <SettingsRow
          label={_('Vocabulary level')}
          description={_('Words above your level get a hint')}
          disabled={!wordWiseEnabled}
        >
          <div className='flex items-center gap-2'>
            <input
              type='range'
              className='range range-sm eink-bordered'
              min={WORD_WISE_MIN_LEVEL}
              max={WORD_WISE_MAX_LEVEL}
              step={1}
              value={wordWiseLevel}
              disabled={!wordWiseEnabled}
              aria-label={_('Vocabulary level')}
              onChange={(e) => setWordWiseLevel(Number(e.target.value))}
              data-setting-id='settings.wordwise.level'
            />
            <span className='text-base-content/70 w-6 text-end text-sm tabular-nums'>
              {cefrLabel(wordWiseLevel)}
            </span>
          </div>
        </SettingsRow>
        <SettingsRow label={_('Hint Language')}>
          <SettingsSelect
            value={selectedHintValue}
            onChange={handleSelectHintLang}
            ariaLabel={_('Hint Language')}
            options={hintLangOptions}
          />
        </SettingsRow>
      </BoxedList>

      <BoxedList title={_('Data')}>
        {renderDataPackRow()}
        <SettingsSwitchRow
          label={_('Auto-download')}
          description={_('Download data packs automatically when needed.')}
          checked={autoDownload}
          onChange={handleToggleAutoDownload}
        />
      </BoxedList>
    </div>
  );
};

export default WordWisePanel;
