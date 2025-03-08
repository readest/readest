import clsx from 'clsx';
import React, { useEffect } from 'react';

import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { useEnv } from '@/context/EnvContext';
import { useDrag } from '@/hooks/useDrag';
import { TextSelection } from '@/utils/sel';
import { BookNote } from '@/types/book';
import { uniqueId } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import { getBookDirFromLanguage } from '@/utils/book';
import BooknoteItem from '../sidebar/BooknoteItem';
import NotebookHeader from './Header';
import NoteEditor from './NoteEditor';

const MIN_NOTEBOOK_WIDTH = 0.15;
const MAX_NOTEBOOK_WIDTH = 0.45;

const Notebook: React.FC = ({}) => {
  const _ = useTranslation();
  const { updateAppTheme } = useThemeStore();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { sideBarBookKey } = useSidebarStore();
  const { notebookWidth, isNotebookVisible, isNotebookPinned } = useNotebookStore();
  const { notebookNewAnnotation, notebookEditAnnotation, setNotebookPin } = useNotebookStore();
  const { getBookData, getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getView, getViewSettings } = useReaderStore();
  const { setNotebookWidth, setNotebookVisible, toggleNotebookPin } = useNotebookStore();
  const { setNotebookNewAnnotation, setNotebookEditAnnotation } = useNotebookStore();

  const onNavigateEvent = async () => {
    const pinButton = document.querySelector('.sidebar-pin-btn');
    const isPinButtonHidden = !pinButton || window.getComputedStyle(pinButton).display === 'none';
    if (isPinButtonHidden) {
      setNotebookVisible(false);
    }
  };

  useEffect(() => {
    if (isNotebookVisible) {
      updateAppTheme('base-200');
    } else {
      updateAppTheme('base-100');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNotebookVisible]);

  useEffect(() => {
    setNotebookWidth(settings.globalReadSettings.notebookWidth);
    setNotebookPin(settings.globalReadSettings.isNotebookPinned);
    setNotebookVisible(settings.globalReadSettings.isNotebookPinned);

    eventDispatcher.on('navigate', onNavigateEvent);
    return () => {
      eventDispatcher.off('navigate', onNavigateEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNotebookResize = (newWidth: string) => {
    setNotebookWidth(newWidth);
    settings.globalReadSettings.notebookWidth = newWidth;
  };

  const handleTogglePin = () => {
    toggleNotebookPin();
    settings.globalReadSettings.isNotebookPinned = !isNotebookPinned;
  };

  const handleClickOverlay = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setNotebookVisible(false);
    setNotebookNewAnnotation(null);
    setNotebookEditAnnotation(null);
  };

  const handleSaveNote = (selection: TextSelection, note: string) => {
    if (!sideBarBookKey) return;
    const view = getView(sideBarBookKey);
    const config = getConfig(sideBarBookKey)!;

    const cfi = view?.getCFI(selection.index, selection.range);
    if (!cfi) return;

    const { booknotes: annotations = [] } = config;
    const annotation: BookNote = {
      id: uniqueId(),
      type: 'annotation',
      cfi,
      note,
      text: selection.text,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    annotations.push(annotation);
    const updatedConfig = updateBooknotes(sideBarBookKey, annotations);
    if (updatedConfig) {
      saveConfig(envConfig, sideBarBookKey, updatedConfig, settings);
    }
    setNotebookNewAnnotation(null);
  };

  const handleEditNote = (note: BookNote, isDelete: boolean) => {
    if (!sideBarBookKey) return;
    const config = getConfig(sideBarBookKey)!;
    const { booknotes: annotations = [] } = config;
    const existingIndex = annotations.findIndex((item) => item.id === note.id);
    if (existingIndex === -1) return;
    if (isDelete) {
      note.deletedAt = Date.now();
    } else {
      note.updatedAt = Date.now();
    }
    annotations[existingIndex] = note;
    const updatedConfig = updateBooknotes(sideBarBookKey, annotations);
    if (updatedConfig) {
      saveConfig(envConfig, sideBarBookKey, updatedConfig, settings);
    }
    setNotebookEditAnnotation(null);
  };

  const onDragMove = (data: { clientX: number }) => {
    const widthFraction = 1 - data.clientX / window.innerWidth;
    const newWidth = Math.max(MIN_NOTEBOOK_WIDTH, Math.min(MAX_NOTEBOOK_WIDTH, widthFraction));
    handleNotebookResize(`${Math.round(newWidth * 10000) / 100}%`);
  };

  const { handleDragStart } = useDrag(onDragMove);

  if (!sideBarBookKey) return null;

  const bookData = getBookData(sideBarBookKey);
  const viewSettings = getViewSettings(sideBarBookKey);
  if (!bookData || !bookData.bookDoc) {
    return null;
  }
  const { bookDoc } = bookData;
  const languageDir = getBookDirFromLanguage(bookDoc.metadata.language);

  const config = getConfig(sideBarBookKey);
  const { booknotes: allNotes = [] } = config || {};
  const annotationNotes = allNotes
    .filter((note) => note.type === 'annotation' && note.note && !note.deletedAt)
    .sort((a, b) => b.createdAt - a.createdAt);
  const excerptNotes = allNotes
    .filter((note) => note.type === 'excerpt' && note.text && !note.deletedAt)
    .sort((a, b) => a.createdAt - b.createdAt);

  return isNotebookVisible ? (
    <>
      {!isNotebookPinned && (
        <div className='overlay fixed inset-0 z-10 bg-black/20' onClick={handleClickOverlay} />
      )}
      <div
        className={clsx(
          'notebook-container bg-base-200 right-0 z-20 min-w-60 select-none',
          'font-sans text-base font-normal sm:text-sm',
          appService?.isIOSApp ? 'h-[100vh]' : 'h-full',
          appService?.hasSafeAreaInset && 'pt-[env(safe-area-inset-top)]',
          appService?.hasRoundedWindow && 'rounded-window-top-right rounded-window-bottom-right',
          !isNotebookPinned && 'shadow-2xl',
        )}
        dir={viewSettings?.rtl && languageDir === 'rtl' ? 'rtl' : 'ltr'}
        style={{
          width: `${notebookWidth}`,
          maxWidth: `${MAX_NOTEBOOK_WIDTH * 100}%`,
          position: isNotebookPinned ? 'relative' : 'absolute',
        }}
      >
        <style jsx>{`
          @media (max-width: 640px) {
            .notebook-container {
              width: 100%;
              min-width: 100%;
            }
          }
        `}</style>
        <div
          className='drag-bar absolute left-0 top-0 h-full w-0.5 cursor-col-resize'
          onMouseDown={handleDragStart}
        />
        <NotebookHeader
          isPinned={isNotebookPinned}
          handleClose={() => setNotebookVisible(false)}
          handleTogglePin={handleTogglePin}
        />
        <div className='max-h-[calc(100vh-44px)] overflow-y-auto px-3'>
          <div dir='ltr'>
            {excerptNotes.length > 0 && (
              <p className='content font-size-base pt-1'>{_('Excerpts')}</p>
            )}
          </div>
          <ul className=''>
            {excerptNotes.map((item, index) => (
              <li key={`${index}-${item.id}`} className='my-2'>
                <div
                  tabIndex={0}
                  className='collapse-arrow border-base-300 bg-base-100 collapse border'
                >
                  <div
                    className='collapse-title font-size-sm h-9 min-h-9 p-2 pe-8 font-medium'
                    style={
                      {
                        '--top-override': '1.2rem',
                        '--end-override': '0.7rem',
                      } as React.CSSProperties
                    }
                  >
                    <p className='line-clamp-1'>{item.text || `Excerpt ${index + 1}`}</p>
                  </div>
                  <div className='collapse-content font-size-xs select-text px-3 pb-0'>
                    <p className='hyphens-auto text-justify'>{item.text}</p>
                    <div className='flex justify-end' dir='ltr'>
                      <div
                        className='font-size-xs cursor-pointer align-bottom text-red-500 hover:text-red-600'
                        onClick={handleEditNote.bind(null, item, true)}
                      >
                        {_('Delete')}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div dir='ltr'>
            {(notebookNewAnnotation || annotationNotes.length > 0) && (
              <p className='content font-size-base pt-1'>{_('Notes')}</p>
            )}
          </div>
          {(notebookNewAnnotation || notebookEditAnnotation) && (
            <NoteEditor onSave={handleSaveNote} onEdit={(item) => handleEditNote(item, false)} />
          )}
          <ul>
            {annotationNotes.map((item, index) => (
              <BooknoteItem key={`${index}-${item.cfi}`} bookKey={sideBarBookKey} item={item} />
            ))}
          </ul>
        </div>
      </div>
    </>
  ) : null;
};

export default Notebook;
