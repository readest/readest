import { useState } from 'react';
import { MdAdd, MdClose, MdLanguage } from 'react-icons/md';
import { SiDuckduckgo, SiGoogle } from 'react-icons/si';
import { TbBrandBing } from 'react-icons/tb';
import BoxedList from '@/components/settings/primitives/BoxedList';
import Dialog from '@/components/Dialog';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import {
  BUILTIN_COVER_SEARCH_ENGINES,
  getCoverSearchUrl,
  isValidCoverSearchTemplate,
  type CoverSearchEngine,
} from '@/services/metadata/coverSearch';
import { openWebBrowser } from '@/services/webBrowser/webBrowser';
import { getWebBrowserOptions } from '@/services/webBrowser/webBrowserOptions';
import { openExternalUrl } from '@/utils/open';

const NO_ENGINES: CoverSearchEngine[] = [];
const ENGINE_ICONS = [SiGoogle, TbBrandBing, SiDuckduckgo];
const ENGINE_TILE =
  'group eink-bordered border-base-200 bg-base-100 focus-visible:ring-base-content/15 flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-lg border px-3 py-4 text-center focus-visible:outline-hidden focus-visible:ring-2 disabled:opacity-50';

interface CoverSearchDialogProps {
  title: string;
  author: string;
  onSelect: (url: string, pageUrl?: string) => Promise<void> | void;
  onClose: () => void;
}

export default function CoverSearchDialog({
  title,
  author,
  onSelect,
  onClose,
}: CoverSearchDialogProps) {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const customEngines = useSettingsStore(
    (state) => state.settings.coverSearchEngines ?? NO_ENGINES,
  );
  const query = [title, author].filter(Boolean).join(' ');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingImage, setPendingImage] = useState<{ url: string; pageUrl: string } | null>(null);

  const persist = async (engines: CoverSearchEngine[]) => {
    const { settings, setSettings, saveSettings } = useSettingsStore.getState();
    const next = { ...settings, coverSearchEngines: engines };
    await saveSettings(envConfig, next);
    setSettings(next);
  };

  const addEngine = async () => {
    if (!name.trim() || !isValidCoverSearchTemplate(template.trim())) {
      setError(_('Enter a name and an http(s) URL template containing %WORD%'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await persist([
        ...customEngines,
        { id: crypto.randomUUID(), name: name.trim(), urlTemplate: template.trim() },
      ]);
      setAdding(false);
      setName('');
      setTemplate('');
    } catch {
      setError(_('Failed to save search engines'));
    } finally {
      setBusy(false);
    }
  };

  const selectImage = async () => {
    if (!pendingImage) return;
    setBusy(true);
    setError('');
    try {
      await onSelect(pendingImage.url, pendingImage.pageUrl);
      onClose();
    } catch {
      setError(
        _('Could not load the cover image. Try another image or download it and use Replace.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const search = async (engine: CoverSearchEngine) => {
    const url = getCoverSearchUrl(engine, query.trim());
    setError('');
    setPendingImage(null);
    if (appService?.appPlatform !== 'tauri') {
      openExternalUrl(url);
      return;
    }
    setBusy(true);
    try {
      const result = await openWebBrowser(url, {
        ...getWebBrowserOptions(_, !!appService.isEink),
        selectImage: true,
      });
      // Remote pages can forge browser result navigations; confirm in the app before fetching.
      if (result.image) setPendingImage(result.image);
    } catch {
      setError(
        _('Could not load the cover image. Try another image or download it and use Replace.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen
      onClose={() => {
        if (!busy) onClose();
      }}
      title={_('Search Book Covers')}
      aboveKeyboard
      boxClassName='sm:w-[480px]! sm:max-w-[480px]! sm:h-auto! sm:max-h-[85vh]!'
    >
      <div className='flex flex-col gap-4 pb-2 pt-2'>
        <p className='text-neutral-content text-sm leading-relaxed'>
          {appService?.appPlatform === 'tauri'
            ? _('Browse for an image, choose the cover, then confirm it in the cover panel.')
            : _(
                'Search opens in a new tab. Download a cover image, then use Replace to choose the file.',
              )}
        </p>
        {pendingImage && (
          <div className='eink-bordered border-base-300 flex flex-col gap-3 rounded-lg border p-4'>
            <p>{_('Use this image as the book cover?')}</p>
            <p className='text-neutral-content break-all text-sm'>{pendingImage.url}</p>
            <div className='flex flex-wrap justify-end gap-2'>
              <button
                type='button'
                className='btn btn-ghost eink-bordered'
                disabled={busy}
                onClick={() => setPendingImage(null)}
              >
                {_('Cancel')}
              </button>
              <button
                type='button'
                className='btn btn-contrast'
                disabled={busy}
                onClick={() => void selectImage()}
              >
                {_('Use this cover')}
              </button>
            </div>
          </div>
        )}
        <div className='grid grid-cols-2 gap-3'>
          {BUILTIN_COVER_SEARCH_ENGINES.map((engine, index) => {
            const Icon = ENGINE_ICONS[index]!;
            return (
              <button
                key={engine.id}
                type='button'
                className={ENGINE_TILE}
                disabled={busy || !query.trim()}
                onClick={() => void search(engine)}
              >
                <span className='bg-base-200 group-hover:bg-base-300 flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-150'>
                  <Icon aria-hidden className='h-5 w-5' />
                </span>
                <span className='w-full truncate'>{engine.name}</span>
              </button>
            );
          })}
          <button
            type='button'
            className={ENGINE_TILE}
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            <span className='bg-base-200 group-hover:bg-base-300 flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-150'>
              <MdAdd aria-hidden className='h-5 w-5' />
            </span>
            <span>{_('Add Search Engine')}</span>
          </button>
        </div>
        {customEngines.length > 0 && (
          <BoxedList>
            {customEngines.map((engine) => (
              <div key={engine.id} className='flex items-center gap-2 pe-1'>
                <button
                  type='button'
                  disabled={busy || !query.trim()}
                  onClick={() => void search(engine)}
                  className='focus-visible:ring-base-content/15 flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md text-start focus-visible:outline-hidden focus-visible:ring-2'
                >
                  <MdLanguage aria-hidden className='h-5 w-5 shrink-0' />
                  <span className='truncate'>{engine.name}</span>
                </button>
                <button
                  type='button'
                  className='btn btn-ghost btn-circle min-h-11 min-w-11'
                  disabled={busy}
                  aria-label={_('Remove {{name}}', { name: engine.name })}
                  onClick={() => {
                    setBusy(true);
                    void persist(customEngines.filter((item) => item.id !== engine.id))
                      .catch(() => setError(_('Failed to save search engines')))
                      .finally(() => setBusy(false));
                  }}
                >
                  <MdClose aria-hidden className='h-4 w-4' />
                </button>
              </div>
            ))}
          </BoxedList>
        )}
        {adding && (
          <div className='flex flex-col gap-3'>
            <label className='flex flex-col gap-1'>
              <span>{_('Name')}</span>
              <input
                className='input eink-bordered w-full'
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className='flex flex-col gap-1'>
              <span>{_('URL Template')}</span>
              <input
                type='url'
                className='input eink-bordered w-full'
                value={template}
                disabled={busy}
                placeholder='https://example.com/images?q=%WORD%'
                onChange={(event) => setTemplate(event.target.value)}
              />
            </label>
            <p className='text-neutral-content text-sm'>
              {_('Use %WORD% where the cover search query should appear')}
            </p>
            <div className='flex justify-end gap-2'>
              <button
                type='button'
                className='btn btn-ghost eink-bordered'
                disabled={busy}
                onClick={() => {
                  setAdding(false);
                  setError('');
                }}
              >
                {_('Cancel')}
              </button>
              <button
                type='button'
                className='btn btn-contrast'
                disabled={busy}
                onClick={() => void addEngine()}
              >
                {_('Save')}
              </button>
            </div>
          </div>
        )}
        {error && (
          <p role='alert' className='text-error text-sm'>
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
