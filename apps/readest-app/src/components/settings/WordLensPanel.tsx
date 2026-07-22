import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
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
  WORD_LENS_MIN_LEVEL,
  WORD_LENS_MAX_LEVEL,
  cefrLabel,
} from '@/services/wordlens/difficulty';
import { toWordLensSource } from '@/app/reader/utils/wordlensSection';
import {
  deletePack,
  ensurePack,
  fetchManifest,
  getPackStatus,
  listAvailableTargets,
  type WordLensManifest,
  type WordLensPack,
} from '@/services/wordlens/glossPacks';
import SubPageHeader from './SubPageHeader';
import ColorInput from './color/ColorInput';
import { BoxedList, SettingsRow, SettingsSelect, SettingsSwitchRow } from './primitives';

// Swatch shown for the "default" (muted, theme-adaptive) gloss color, which has
// no fixed hex of its own. Picking any color overrides; "Default" clears back.
const DEFAULT_GLOSS_SWATCH = '#808080';

interface WordLensPanelProps {
  bookKey: string;
  onBack: () => void;
}

const baseCode = (lang?: string | null): string => (lang || '').toLowerCase().split('-')[0] || '';

const WordLensPanel: React.FC<WordLensPanelProps> = ({ bookKey, onBack }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getViewSettings, setViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;
  const bookData = getBookData(bookKey);

  const appLang = baseCode(getLocale());
  const bookSource = toWordLensSource(bookData?.book?.primaryLanguage);

  const [wordLensEnabled, setWordLensEnabled] = useState(viewSettings.wordLensEnabled ?? false);
  const [wordLensLevel, setWordLensLevel] = useState(viewSettings.wordLensLevel ?? 3);
  const [hintLang, setHintLang] = useState(viewSettings.wordLensHintLang || appLang);
  const [glossFontSize, setGlossFontSize] = useState(viewSettings.wordLensGlossFontSize ?? 0.5);
  const [glossColor, setGlossColor] = useState(viewSettings.wordLensGlossColor ?? '');
  // Track the latest gloss color so ColorInput's onCommit (no args) persists the
  // value the user landed on after dragging, without re-injecting CSS per tick.
  const glossColorRef = useRef(glossColor);
  glossColorRef.current = glossColor;
  const [autoDownload, setAutoDownload] = useState(
    settings.globalReadSettings.wordLensAutoDownload ?? true,
  );

  const [manifest, setManifest] = useState<WordLensManifest | null>(null);
  const [packStatus, setPackStatus] = useState<{ pack: WordLensPack; downloaded: boolean } | null>(
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
    if (wordLensEnabled === viewSettings.wordLensEnabled) return;
    saveViewSettings(envConfig, bookKey, 'wordLensEnabled', wordLensEnabled, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordLensEnabled]);

  useEffect(() => {
    if (wordLensLevel === viewSettings.wordLensLevel) return;
    saveViewSettings(envConfig, bookKey, 'wordLensLevel', wordLensLevel, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordLensLevel]);

  // Re-resolve the data-pack row whenever the (source → hint) pair changes.
  useEffect(() => {
    if (!appService || !bookSource) {
      setPackStatus(null);
      return;
    }
    const hint = baseCode(hintLang) || appLang;
    // Same-language pairs (e.g. en-en) are allowed; getPackStatus returns null
    // when the manifest has no pack for the pair, which renders the empty row.
    if (!hint) {
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
    const stored = viewSettings.wordLensHintLang;
    if (!stored) return '';
    if (hintLangOptions.some((o) => o.value === stored)) return stored;
    const byBase = hintLangOptions.find((o) => baseCode(o.value) === baseCode(stored));
    return byBase?.value ?? '';
  })();

  const handleSelectHintLang = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value;
    setHintLang(option || appLang);
    saveViewSettings(envConfig, bookKey, 'wordLensHintLang', option, false, false);
    viewSettings.wordLensHintLang = option;
    setViewSettings(bookKey, { ...viewSettings });
  };

  // Gloss appearance (font size + color) drives the <rt> CSS via getRubyStyles, so
  // saving with applyStyles (default) re-injects the stylesheet and restyles the
  // already-rendered glosses live — no DOM rebuild / re-gloss needed.
  const glossFontSizeOptions = [
    { value: '0.4', label: _('Small') },
    { value: '0.5', label: _('Default') },
    { value: '0.65', label: _('Large') },
    { value: '0.8', label: _('Extra Large') },
  ];

  const handleSelectGlossFontSize = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = Number(event.target.value) || 0.5;
    setGlossFontSize(value);
    saveViewSettings(envConfig, bookKey, 'wordLensGlossFontSize', value);
  };

  const handleGlossColorChange = (hex: string) => setGlossColor(hex);

  const handleGlossColorCommit = () => {
    saveViewSettings(envConfig, bookKey, 'wordLensGlossColor', glossColorRef.current);
  };

  const handleResetGlossColor = () => {
    setGlossColor('');
    saveViewSettings(envConfig, bookKey, 'wordLensGlossColor', '');
  };

  const handleToggleAutoDownload = () => {
    const next = !autoDownload;
    setAutoDownload(next);
    settings.globalReadSettings.wordLensAutoDownload = next;
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
          message: _('Word Lens data downloaded'),
        });
      } else {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Failed to download Word Lens data'),
        });
      }
    } catch {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to download Word Lens data'),
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
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Word Lens data removed') });
  };

  const renderDataPackRow = () => {
    if (!bookSource) {
      return (
        <SettingsRow
          label={_('Data pack')}
          description={_('Open a book to manage its data pack.')}
        />
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
        <SettingsRow
          label={_('Data pack')}
          description={_('No data available for this language pair yet.')}
        />
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
      <SettingsRow label={_('Data pack')} description={size}>
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
            className='btn btn-contrast btn-sm shrink-0'
          >
            {_('Download')}
          </button>
        </div>
      </SettingsRow>
    );
  };

  return (
    <div className={clsx('my-4 w-full space-y-6')}>
      <SubPageHeader
        parentLabel={_('Language')}
        currentLabel={_('Word Lens')}
        description={_(
          'Show a short native-language hint above difficult words. Words above your level get a hint.',
        )}
        onBack={onBack}
      />

      <BoxedList title={_('Word Lens')} data-setting-id='settings.wordlens.main'>
        <SettingsSwitchRow
          label={_('Enable Word Lens')}
          checked={wordLensEnabled}
          onChange={() => setWordLensEnabled(!wordLensEnabled)}
          data-setting-id='settings.wordlens.enabled'
        />
        <SettingsRow label={_('Level')} description={_('CEFR level')} disabled={!wordLensEnabled}>
          <div className='flex items-center gap-2'>
            <input
              type='range'
              className='range range-sm eink-bordered'
              min={WORD_LENS_MIN_LEVEL}
              max={WORD_LENS_MAX_LEVEL}
              step={1}
              value={wordLensLevel}
              disabled={!wordLensEnabled}
              aria-label={_('Vocabulary level')}
              onChange={(e) => setWordLensLevel(Number(e.target.value))}
              data-setting-id='settings.wordlens.level'
            />
            <span className='text-base-content/70 w-6 text-end text-sm tabular-nums'>
              {cefrLabel(wordLensLevel)}
            </span>
          </div>
        </SettingsRow>
        <SettingsRow label={_('Language')}>
          <SettingsSelect
            value={selectedHintValue}
            onChange={handleSelectHintLang}
            ariaLabel={_('Language')}
            options={hintLangOptions}
          />
        </SettingsRow>
        <SettingsRow
          label={_('Hint size')}
          description={_('Gloss text size above the word')}
          disabled={!wordLensEnabled}
        >
          <SettingsSelect
            value={String(glossFontSize)}
            onChange={handleSelectGlossFontSize}
            ariaLabel={_('Hint size')}
            options={glossFontSizeOptions}
            disabled={!wordLensEnabled}
          />
        </SettingsRow>
        <SettingsRow
          label={_('Hint color')}
          description={glossColor ? glossColor : _('Default')}
          disabled={!wordLensEnabled}
        >
          <div className='flex items-center gap-2'>
            {glossColor && (
              <button
                type='button'
                onClick={handleResetGlossColor}
                className='btn btn-ghost btn-xs eink-bordered shrink-0'
              >
                {_('Default')}
              </button>
            )}
            <ColorInput
              label={_('Hint color')}
              value={glossColor || DEFAULT_GLOSS_SWATCH}
              onChange={handleGlossColorChange}
              onCommit={handleGlossColorCommit}
              showPickerIcon
              pickerPosition='right'
            />
          </div>
        </SettingsRow>
      </BoxedList>

      <BoxedList title={_('Data')}>
        {renderDataPackRow()}
        <SettingsSwitchRow
          label={_('Auto-download')}
          checked={autoDownload}
          onChange={handleToggleAutoDownload}
        />
      </BoxedList>
    </div>
  );
};

export default WordLensPanel;
