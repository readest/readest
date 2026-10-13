import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { MdCheck, MdLabelOff, MdLabelOutline, MdNewLabel, MdRemove } from 'react-icons/md';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import {
  TagSelectionState,
  applyBookTagEdits,
  getLibraryTags,
  getTagSelectionState,
} from '../utils/libraryUtils';

interface TaggingModalProps {
  libraryBooks: Book[];
  // The selected books, with any selected groups already expanded.
  bookHashes: string[];
  onCancel: () => void;
  onConfirm: () => void;
}

// Every edit is staged until Confirm, so Cancel leaves the library untouched.
// Edits only ever reach the selected books; there is deliberately no
// library-wide tag delete here, where one mis-tap would strip it from every book.
const TaggingModal: React.FC<TaggingModalProps> = ({
  libraryBooks,
  bookHashes,
  onCancel,
  onConfirm,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setLibrary } = useLibraryStore();

  const [libraryTags] = useState(() => getLibraryTags(libraryBooks));
  const [initialStates] = useState(() => {
    const selected = libraryBooks.filter((book) => bookHashes.includes(book.hash));
    return Object.fromEntries(
      libraryTags.map((tag) => [tag, getTagSelectionState(selected, tag)]),
    ) as Record<string, TagSelectionState>;
  });
  const [states, setStates] = useState(initialStates);
  const [createdTags, setCreatedTags] = useState<string[]>([]);
  const [showInput, setShowInput] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  const editorRef = useRef<HTMLInputElement>(null);
  const iconSize = useResponsiveSize(16);

  const visibleTags = [...createdTags, ...libraryTags.filter((tag) => !createdTags.includes(tag))];
  const stateOf = (tag: string) => states[tag] ?? 'none';
  const initialStateOf = (tag: string) => initialStates[tag] ?? 'none';
  const hasChanges = visibleTags.some((tag) => stateOf(tag) !== initialStateOf(tag));
  const hasSelectedTags = visibleTags.some((tag) => stateOf(tag) !== 'none');

  const handleToggleTag = (tag: string) => {
    setStates((prev) => ({ ...prev, [tag]: stateOf(tag) === 'all' ? 'none' : 'all' }));
  };

  const handleRemoveAllTags = () => {
    setStates((prev) => Object.fromEntries(Object.keys(prev).map((tag) => [tag, 'none' as const])));
  };

  const handleCreateTag = () => {
    setNewTagName('');
    setShowInput(true);
  };

  const handleConfirmCreateTag = () => {
    const tag = newTagName.trim();
    if (!tag) return;
    if (!visibleTags.includes(tag)) setCreatedTags((prev) => [tag, ...prev]);
    setStates((prev) => ({ ...prev, [tag]: 'all' }));
    setShowInput(false);
  };

  const handleConfirm = () => {
    if (!hasChanges) return;
    const changed = visibleTags.filter((tag) => stateOf(tag) !== initialStateOf(tag));
    const updatedBooks = applyBookTagEdits(libraryBooks, bookHashes, {
      add: changed.filter((tag) => stateOf(tag) === 'all'),
      remove: changed.filter((tag) => stateOf(tag) === 'none'),
    });
    setLibrary(updatedBooks);
    appService?.saveLibraryBooks(updatedBooks);
    onConfirm();
  };

  const divRef = useKeyDownActions({ onCancel, onConfirm: handleConfirm });

  useEffect(() => {
    if (showInput) editorRef.current?.focus();
  }, [showInput]);

  return (
    <div className='fixed inset-0 flex items-center justify-center'>
      <div
        ref={divRef}
        className={clsx(
          'modal-box bg-base-100 overflow-y-auto rounded-2xl shadow-xl',
          'max-h-[85%] w-[95%] min-w-64 max-w-[440px] p-6 sm:w-[70%]',
        )}
      >
        <h2 className='text-center text-lg font-bold'>{_('Tag Books')}</h2>

        {/* Action buttons */}
        <div className={clsx('mt-4 grid grid-cols-1 gap-2 text-base md:grid-cols-2')}>
          <button
            onClick={handleRemoveAllTags}
            className='flex items-center space-x-2 p-2 text-blue-500 disabled:text-gray-400'
            disabled={!hasSelectedTags}
          >
            <MdLabelOff size={iconSize} />
            <span className='truncate'>{_('Remove All Tags')}</span>
          </button>
          <button
            onClick={handleCreateTag}
            className='flex items-center space-x-2 p-2 text-blue-500 disabled:text-gray-400'
          >
            <MdNewLabel size={iconSize} />
            <span className='truncate'>{_('Create New Tag')}</span>
          </button>
        </div>

        {/* Create tag input */}
        {showInput && (
          <div className='mt-4 flex items-center gap-2'>
            <input
              type='text'
              ref={editorRef}
              value={newTagName}
              placeholder={_('Tag name')}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmCreateTag();
                if (e.key === 'Escape') setShowInput(false);
                e.stopPropagation();
              }}
              className='input input-ghost w-full border-0 px-2 text-base outline-hidden! sm:text-sm'
            />
            <button
              className={clsx(
                'btn btn-ghost settings-content hover:bg-transparent',
                'flex h-[1.3em] min-h-[1.3em] items-end p-0',
                newTagName.trim() ? '' : 'btn-disabled bg-transparent!',
              )}
              onClick={handleConfirmCreateTag}
            >
              <div className='pr-1 align-bottom text-base text-blue-500 sm:text-sm'>
                {_('Save')}
              </div>
            </button>
          </div>
        )}

        {/* Tags list */}
        {visibleTags.length === 0 && !showInput && (
          <p className='text-neutral-content mt-4 text-center text-sm'>{_('No tags yet')}</p>
        )}
        <ul className='tags-list mt-4 grid grid-cols-2 gap-2 overflow-x-hidden'>
          {visibleTags.map((tag) => {
            const state = stateOf(tag);
            return (
              <li key={tag} className='flex min-w-0 gap-1'>
                <button
                  role='checkbox'
                  aria-checked={state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false'}
                  aria-label={tag}
                  className={clsx(
                    'hover:bg-base-300 text-base-content flex min-w-0 flex-1',
                    'items-center justify-between gap-2 rounded-md px-2 py-2',
                  )}
                  onClick={() => handleToggleTag(tag)}
                >
                  <div className='flex min-w-0 flex-1 items-center gap-2'>
                    <span className='shrink-0'>
                      <MdLabelOutline size={iconSize} />
                    </span>
                    <span className='min-w-0 truncate text-base sm:text-sm'>{tag}</span>
                  </div>
                  <span className='flex shrink-0 text-sm'>
                    {state === 'all' && <MdCheck className='fill-blue-500' size={iconSize} />}
                    {state === 'some' && <MdRemove className='fill-blue-500' size={iconSize} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Footer actions */}
        <div className='mt-6 flex justify-end gap-x-8 p-2'>
          <button onClick={onCancel} className='flex items-center'>
            {_('Cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!hasChanges}
            className={clsx(
              'flex items-center text-blue-500',
              !hasChanges && 'btn-disabled opacity-50',
            )}
          >
            {_('Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TaggingModal;
