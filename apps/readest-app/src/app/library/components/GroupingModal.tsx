import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { MdCheck } from 'react-icons/md';
import { HiOutlineFolder, HiOutlineFolderAdd, HiOutlineFolderRemove } from 'react-icons/hi';

import { Book, BookGroupType } from '@/types/book';
import { isMd5, md5Fingerprint } from '@/utils/md5';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { BOOK_UNGROUPED_ID, BOOK_UNGROUPED_NAME } from '@/services/constants';
import { generateGroupsList } from './BookshelfItem';

interface GroupingModalProps {
  libraryBooks: Book[];
  selectedBooks: string[];
  onCancel: () => void;
  onConfirm: () => void;
}

const GroupingModal: React.FC<GroupingModalProps> = ({
  libraryBooks,
  selectedBooks,
  onCancel,
  onConfirm,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setLibrary } = useLibraryStore();
  const groupsList = generateGroupsList(libraryBooks);

  const [showInput, setShowInput] = useState(false);
  const [editGroupName, setEditGroupName] = useState(_('Untitled Group'));
  const [selectedGroup, setSelectedGroup] = useState<BookGroupType | null>(null);
  const [newGroups, setNewGroups] = useState<BookGroupType[]>([]);
  const [allGroups, setAllGroups] = useState<BookGroupType[]>(groupsList);
  const editorRef = useRef<HTMLInputElement>(null);

  const iconSize = useResponsiveSize(16);

  const isSelectedBooksHasGroup =
    selectedBooks.some((hash) => !isMd5(hash)) ||
    selectedBooks
      .map((hash) => libraryBooks.find((book) => book.hash === hash)?.groupId)
      .some((group) => group && group !== BOOK_UNGROUPED_NAME);

  const handleCreateGroup = () => {
    setShowInput(true);
  };

  const handleRemoveFromGroup = () => {
    selectedBooks.forEach((id) => {
      for (const book of libraryBooks.filter((book) => book.hash === id || book.groupId === id)) {
        if (
          book &&
          book.groupId &&
          book.groupName &&
          book.groupId !== BOOK_UNGROUPED_ID &&
          book.groupName !== BOOK_UNGROUPED_NAME
        ) {
          book.groupId = undefined;
          book.groupName = undefined;
          book.updatedAt = Date.now();
        }
      }
    });
    setLibrary(libraryBooks);
    appService?.saveLibraryBooks(libraryBooks);
    onConfirm();
  };

  const handleConfirmCreateGroup = () => {
    const groupName = editGroupName.trim();
    if (groupName) {
      const newGroup = { id: md5Fingerprint(groupName), name: groupName };
      const existingGroupIndex = newGroups.findIndex((group) => group.name === groupName);
      if (existingGroupIndex > -1) {
        newGroups.splice(existingGroupIndex, 1);
      }
      newGroups.push(newGroup);
      setSelectedGroup(newGroup);
      setNewGroups(newGroups);
      for (const newGroup of newGroups) {
        const existingGroupIndex = groupsList.findIndex((group) => group.id === newGroup.id);
        if (existingGroupIndex > -1) {
          groupsList.splice(existingGroupIndex, 1);
        }
        groupsList.unshift(newGroup);
      }
      setAllGroups(groupsList);
      const untitledGroupPattern = new RegExp(`^${_('Untitled Group')}\\s*(\\d+)?$`);
      const untitledGroupNumbers = groupsList
        .map((group) => {
          const match = group.name.match(untitledGroupPattern);
          return match ? parseInt(match[1] || '0', 10) : null;
        })
        .filter((num) => num !== null);

      const nextNumber =
        untitledGroupNumbers.length > 0 ? Math.max(...untitledGroupNumbers) + 1 : 1;
      setEditGroupName(`${_('Untitled Group')} ${nextNumber}`);
      setShowInput(false);
    }
  };

  const handleToggleSelectGroup = (group: BookGroupType) => {
    setSelectedGroup((prevGroup) => (prevGroup?.id === group.id ? null : group));
  };

  const handleConfirmGrouping = () => {
    selectedBooks.forEach((id) => {
      for (const book of libraryBooks.filter((book) => book.hash === id || book.groupId === id)) {
        if (book && selectedGroup) {
          book.groupId = selectedGroup.id;
          book.groupName = selectedGroup.name;
          book.updatedAt = Date.now();
        }
      }
    });
    setLibrary(libraryBooks);
    appService?.saveLibraryBooks(libraryBooks);
    onConfirm();
  };

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.select();
    }
  }, [showInput]);

  useEffect(() => {
    const groupIds = selectedBooks
      .map((id) => libraryBooks.find((book) => book.hash === id || book.groupId === id)?.groupId)
      .filter((groupId) => groupId);
    if (Array.from(new Set(groupIds)).length === 1) {
      setSelectedGroup(groupsList.find((group) => group.id === groupIds[0]) || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBooks]);

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50'>
      <div
        className={clsx(
          'modal-box bg-base-100 overflow-y-auto rounded-2xl shadow-xl',
          'max-h-[85%] w-[95%] min-w-64 max-w-[440px] p-6 sm:w-[70%]',
        )}
      >
        <h2 className='text-center text-lg font-bold'>{_('Group Books')}</h2>
        <div className={clsx('mt-4 grid grid-cols-1 gap-2 text-base md:grid-cols-2')}>
          {isSelectedBooksHasGroup && (
            <div
              onClick={handleRemoveFromGroup}
              role='button'
              className='flex items-center space-x-2 p-2 text-blue-500'
            >
              <HiOutlineFolderRemove size={iconSize} />
              <span>{_('Remove From Group')}</span>
            </div>
          )}
          <div
            onClick={handleCreateGroup}
            role='button'
            className='flex items-center space-x-2 p-2 text-blue-500'
          >
            <HiOutlineFolderAdd size={iconSize} />
            <span>{_('Create New Group')}</span>
          </div>
        </div>
        {showInput && (
          <div className='mt-4 flex items-center gap-2'>
            <input
              type='text'
              autoFocus
              ref={editorRef}
              value={editGroupName}
              onChange={(e) => setEditGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmCreateGroup();
                e.stopPropagation();
              }}
              className='input input-ghost w-full border-0 px-2 text-base !outline-none sm:text-sm'
            />
            <button
              className={clsx(
                'btn btn-ghost settings-content hover:bg-transparent',
                'flex h-[1.3em] min-h-[1.3em] items-end p-0',
                editorRef.current && editorRef.current.value ? '' : 'btn-disabled !bg-opacity-0',
              )}
              onClick={() => handleConfirmCreateGroup()}
            >
              <div className='pr-1 align-bottom text-base text-blue-500 sm:text-sm'>
                {_('Save')}
              </div>
            </button>
          </div>
        )}
        <ul className='groups-list mt-4 grid grid-cols-2 gap-2'>
          {allGroups.map((group, index) => (
            <button
              key={index}
              className={clsx(
                'hover:bg-base-300 text-base-content flex w-full',
                'items-center justify-between rounded-md px-2 py-2',
              )}
              onClick={() => handleToggleSelectGroup(group)}
            >
              <div className='flex min-w-0 items-center'>
                <span style={{ minWidth: `${iconSize}px` }}>
                  <HiOutlineFolder size={iconSize} />
                </span>
                <span
                  className={clsx('mx-2 flex-1 truncate text-base sm:text-sm')}
                  style={{ minWidth: 0 }}
                >
                  {group.name}
                </span>
              </div>
              <span className='text-neutral-content flex shrink-0 text-sm'>
                {selectedGroup && selectedGroup.id == group.id && (
                  <MdCheck className='fill-blue-500' size={iconSize} />
                )}
              </span>
            </button>
          ))}
        </ul>
        <div className='mt-6 flex justify-end gap-x-8 p-2'>
          <button onClick={onCancel} className='flex items-center'>
            {_('Cancel')}
          </button>
          <button
            onClick={handleConfirmGrouping}
            className={clsx(
              'flex items-center text-blue-500',
              !selectedGroup && 'btn-disabled opacity-50',
            )}
          >
            {_('Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GroupingModal;
