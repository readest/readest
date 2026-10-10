import React, { useMemo } from 'react';
import { PiPencilLine } from 'react-icons/pi';
import { RiDeleteBinLine } from 'react-icons/ri';

import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';
import { HANDWRITING_VERSION, type HandwritingDoc } from '@/services/handwriting/model';
import { parsePageKey } from '@/services/handwriting/pageKey';
import { findTocItemBS } from '@/services/nav';
import { CFI } from '@/libs/document';
import EmptyState from '../EmptyState';
import { BoxedList, SettingLabel } from '@/components/settings/primitives';

interface HandwritingViewProps {
  bookKey: string;
}

interface InkPageRow {
  key: string;
  label: string;
  strokeCount: number;
  updatedAt: number;
  /** Foliate navigation target: a section index, or the CFI of the inked text. */
  target: string | number;
}

/**
 * Ink is not a booknote: it has no CFI and no text, so it can't join the
 * annotation list's chapter grouping. This lists it by page instead, and is
 * the only place with a book-wide "clear all ink" — the in-page toolbar can
 * only reach the page on screen.
 */
const HandwritingView: React.FC<HandwritingViewProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getBookData, getConfig: getBookConfig, setConfig, saveConfig } = useBookDataStore();
  const { getView } = useReaderStore();
  const config = getBookConfig(bookKey);
  const doc = config?.handwriting;

  const toc = getBookData(bookKey)?.bookDoc?.toc;

  const rows = useMemo<InkPageRow[]>(() => {
    if (!doc) return [];
    const rows: (InkPageRow & { index: number })[] = [];
    for (const [key, page] of Object.entries(doc.pages)) {
      const parsed = parsePageKey(key);
      if (!parsed || page.strokes.length === 0) continue;
      const common = { key, strokeCount: page.strokes.length, updatedAt: page.updatedAt };
      if (parsed.kind === 'page') {
        const label = _('Page {{page}}', { page: parsed.index + 1 });
        rows.push({ ...common, label, target: parsed.index, index: parsed.index });
      } else {
        // Reflowable ink is bound to text: label the row by the chapter of its
        // earliest anchor and jump straight to that text.
        const anchors = page.strokes.flatMap((stroke) => (stroke.anchor ? [stroke.anchor] : []));
        const first = anchors.sort(CFI.compare)[0];
        const label = (first && findTocItemBS(toc ?? [], first)?.label) || _('Untitled');
        rows.push({ ...common, label, target: first ?? parsed.index, index: parsed.index });
      }
    }
    return rows.sort((a, b) => a.index - b.index);
  }, [doc, toc, _]);

  const totalStrokes = rows.reduce((sum, row) => sum + row.strokeCount, 0);

  const goToPage = (row: InkPageRow) => {
    const view = getView(bookKey);
    if (!view) return;
    void view.goTo(row.target);
  };

  const clearPage = async (key: string) => {
    if (!config || !doc) return;
    const pages = { ...doc.pages };
    delete pages[key];
    const next: HandwritingDoc = { version: HANDWRITING_VERSION, pages };
    setConfig(bookKey, { handwriting: next });
    await saveConfig(envConfig, bookKey, { ...config, handwriting: next }, settings);
    // The live editor holds the pre-delete store; make it re-read.
    eventDispatcher.dispatch('handwriting', { action: 'reload', bookKey });
  };

  const clearAll = async () => {
    if (!config) return;
    // Dropping the key with a destructure does not survive: setConfig merges a
    // partial into the stored config, and saveConfig calls setConfig itself,
    // so a key-absent object still reads back as "ink stays". Writing an
    // explicitly empty document removes every page and is the merge-safe way
    // to express "no ink".
    const cleared: HandwritingDoc = { version: HANDWRITING_VERSION, pages: {} };
    setConfig(bookKey, { handwriting: cleared });
    await saveConfig(envConfig, bookKey, { ...config, handwriting: cleared }, settings);
    eventDispatcher.dispatch('handwriting', { action: 'reload', bookKey });
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        Icon={PiPencilLine}
        label={_('No Handwriting')}
        hint={_('Turn on Handwriting Mode in the View menu to write on the page')}
      />
    );
  }

  return (
    <div className='booknote-list scroll-container h-full overflow-y-auto rounded-sm'>
      <BoxedList>
        {rows.map((row) => (
          // Two siblings, not a nested button: the row navigates, the trailing
          // action clears. Anatomy follows NavigationRow (chip · label · status)
          // so it reads as the same list family.
          <div key={row.key} className='group flex w-full items-center gap-1 pe-3'>
            <button
              type='button'
              onClick={() => goToPage(row)}
              aria-label={_('Go to handwriting on {{page}}', { page: row.label })}
              className='focus-visible:ring-base-content/15 flex min-w-0 flex-1 items-center gap-3 py-4 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-hidden'
            >
              <span className='bg-base-200 text-base-content/70 group-hover:bg-base-300/70 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-150'>
                <PiPencilLine className='h-5 w-5' />
              </span>
              <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
                <SettingLabel>{row.label}</SettingLabel>
                <span className='text-base-content/65 truncate text-[0.85em]'>
                  {_('{{count}} strokes', { count: row.strokeCount })}
                </span>
              </span>
            </button>
            <button
              type='button'
              aria-label={_('Clear handwriting on {{page}}', { page: row.label })}
              title={_('Clear handwriting on {{page}}', { page: row.label })}
              onClick={() => void clearPage(row.key)}
              className='not-eink:hover:bg-base-200 eink:hover:border shrink-0 rounded-md p-2'
            >
              <RiDeleteBinLine size={18} />
            </button>
          </div>
        ))}
      </BoxedList>
      <div className='px-4 py-3'>
        <button
          type='button'
          onClick={() => void clearAll()}
          className='btn btn-sm btn-ghost w-full gap-1.5'
        >
          <RiDeleteBinLine className='shrink-0' size={16} />
          <span className='min-w-0 truncate'>
            {_('Clear All Handwriting ({{count}} strokes)', { count: totalStrokes })}
          </span>
        </button>
      </div>
    </div>
  );
};

export default HandwritingView;
