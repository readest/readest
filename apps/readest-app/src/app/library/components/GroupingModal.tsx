import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { MdCheck, MdChevronRight, MdEdit } from 'react-icons/md';
import { HiOutlineFolder, HiOutlineFolderAdd, HiOutlineFolderRemove } from 'react-icons/hi';
import { IoMdArrowBack } from 'react-icons/io';

import { Book, BookGroupType } from '@/types/book';
import { isMd5 } from '@/utils/md5';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { BOOK_UNGROUPED_ID, BOOK_UNGROUPED_NAME } from '@/services/constants';
import { getBreadcrumbs } from '../utils/libraryUtils';

interface GroupingModalProps {
  libraryBooks: Book[];
  selectedBooks: string[];
  parentGroupName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

const GroupingModal: React.FC<GroupingModalProps> = ({
  libraryBooks,
  selectedBooks,
  parentGroupName,
  onCancel,
  onConfirm,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const {
    setLibrary,
    addGroup,
    getGroups,
    getGroupId,
    getGroupsByParent,
    getParentPath,
    refreshGroups,
  } = useLibraryStore();

  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined);
  const [showInput, setShowInput] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<BookGroupType | null>(null);
  const [newGroup, setNewGroup] = useState<BookGroupType | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [originalGroupName, setOriginalGroupName] = useState<string | null>(null);

  const divRef = useKeyDownActions({ onCancel, onConfirm });
  const editorRef = useRef<HTMLInputElement>(null);
  const iconSize = useResponsiveSize(16);

  const allGroups = getGroups();
  const currentGroups = getGroupsByParent(currentPath);
  const currentGroupsList =
    newGroup &&
    !currentGroups.some((g) => g.id === newGroup.id) &&
    !currentGroups.some((g) => newGroup.name.startsWith(g.name))
      ? [newGroup, ...currentGroups]
      : currentGroups;

  const isSelectedBooksHasGroup =
    selectedBooks.some((hash) => !isMd5(hash)) ||
    selectedBooks
      .map((hash) => libraryBooks.find((book) => book.hash === hash)?.groupId)
      .some((group) => group && group !== BOOK_UNGROUPED_NAME);

  const canRenameGroup = selectedBooks.length === 1 && selectedBooks.every((id) => !isMd5(id));
  const currentGroupForRename = canRenameGroup
    ? allGroups.find((group) => group.id === selectedBooks[0])
    : null;

  const generateNextUntitledGroupName = () => {
    const baseName = _('Untitled Group');
    const basePattern = parentGroupName
      ? `${parentGroupName}/${baseName}`
      : currentPath
        ? `${currentPath}/${baseName}`
        : baseName;

    const escapedPattern = basePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const untitledGroupPattern = new RegExp(`^${escapedPattern}\\s*(\\d+)?$`);

    const untitledGroupNumbers = allGroups
      .map((group) => {
        const match = group.name.match(untitledGroupPattern);
        return match ? parseInt(match[1] || '1', 10) : null;
      })
      .filter((num) => num !== null) as number[];

    const nextNumber = untitledGroupNumbers.length > 0 ? Math.max(...untitledGroupNumbers) + 1 : 1;

    return `${basePattern} ${nextNumber}`;
  };

  const handleCreateGroup = () => {
    const nextName = generateNextUntitledGroupName();
    setEditGroupName(nextName);
    setShowInput(true);
    setIsRenaming(false);
    setOriginalGroupName(null);
    setSelectedGroup(null);
  };

  const handleRenameGroup = () => {
    if (!currentGroupForRename) return;

    setEditGroupName(currentGroupForRename.name);
    setOriginalGroupName(currentGroupForRename.name);
    setShowInput(true);
    setIsRenaming(true);
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
    setLibrary([...libraryBooks]);
    appService?.saveLibraryBooks(libraryBooks);
    onConfirm();
  };

  const handleConfirmCreateGroup = () => {
    let groupName = editGroupName.trim();
    if (groupName) {
      if (isRenaming && originalGroupName) {
        // Renaming existing group
        const oldGroupName = originalGroupName;

        // Update the group name for all books in this group and nested groups
        libraryBooks.forEach((book) => {
          if (book.groupName === oldGroupName) {
            book.groupName = groupName;
            book.groupId = getGroupId(book.groupName);
            book.updatedAt = Date.now();
          } else if (book.groupName?.startsWith(oldGroupName + '/')) {
            book.groupName = book.groupName.replace(oldGroupName, groupName);
            book.groupId = getGroupId(book.groupName);
            book.updatedAt = Date.now();
          }
        });

        setLibrary([...libraryBooks]);
        appService?.saveLibraryBooks(libraryBooks);

        refreshGroups();
        setShowInput(false);
        setIsRenaming(false);
        setOriginalGroupName(null);
      } else {
        // Creating new group
        if (currentPath && !groupName.startsWith(currentPath + '/')) {
          groupName = `${currentPath}/${groupName}`;
        }

        const newGroup = addGroup(groupName);
        setNewGroup(newGroup);
        setSelectedGroup(newGroup);
        setShowInput(false);
        const parentGroup = getParentPath(groupName);
        if (parentGroup) {
          setCurrentPath(parentGroup);
        }
      }
    }
  };

  const handleToggleSelectGroup = (group: BookGroupType) => {
    setSelectedGroup((prevGroup) => (prevGroup?.id === group.id ? null : group));
  };

  const handleNavigateToGroup = (group: BookGroupType) => {
    setCurrentPath(group.name);
  };

  const handleNavigateBack = () => {
    const parent = currentPath ? getParentPath(currentPath) : undefined;
    setCurrentPath(parent);
  };

  const handleNavigateToPath = (path: string | undefined) => {
    setCurrentPath(path);
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
    setLibrary([...libraryBooks]);
    appService?.saveLibraryBooks(libraryBooks);
    onConfirm();
  };

  const getDisplayName = (fullPath: string) => {
    const segments = fullPath.split('/');
    return segments[segments.length - 1];
  };

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.select();
    }
  }, [showInput]);

  useEffect(() => {
    refreshGroups();
  }, [refreshGroups]);

  useEffect(() => {
    const groupIds = selectedBooks
      .map((id) => libraryBooks.find((book) => book.hash === id || book.groupId === id)?.groupId)
      .filter((groupId) => groupId);
    if (Array.from(new Set(groupIds)).length === 1) {
      setTimeout(() => {
        const allGroups = getGroups();
        const group = allGroups.find((group) => group.id === groupIds[0]);
        setSelectedGroup(group || null);
        if (group && !currentPath) {
          const parent = getParentPath(group.name);
          setCurrentPath(parent);
        }
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className='fixed inset-0 flex items-center justify-center'>
      <div
        ref={divRef}
        className={clsx(
          'modal-box bg-base-100 overflow-y-auto rounded-2xl shadow-xl',
          'max-h-[85%] w-[95%] min-w-64 max-w-[440px] p-6 sm:w-[70%]',
        )}
      >
        <h2 className='text-center text-lg font-bold'>{_('Group Books')}</h2>

        {/* Action buttons */}
        <div className={clsx('mt-4 grid grid-cols-1 gap-2 text-base md:grid-cols-2')}>
          <button
            onClick={handleRemoveFromGroup}
            className='flex items-center space-x-2 p-2 text-blue-500 disabled:text-gray-400'
            disabled={!isSelectedBooksHasGroup}
          >
            <HiOutlineFolderRemove size={iconSize} />
            <span className='truncate'>{_('Remove From Group')}</span>
          </button>
          <button
            onClick={handleCreateGroup}
            className='flex items-center space-x-2 p-2 text-blue-500 disabled:text-gray-400'
          >
            <HiOutlineFolderAdd size={iconSize} />
            <span className='truncate'>{_('Create New Group')}</span>
          </button>
          <button
            onClick={handleRenameGroup}
            className='flex items-center space-x-2 p-2 text-blue-500 disabled:text-gray-400'
            disabled={!canRenameGroup}
          >
            <MdEdit size={iconSize} />
            <span className='truncate'>{_('Rename Group')}</span>
          </button>
        </div>

        {/* Create/Rename group input */}
        {showInput && (
          <div className='mt-4 space-y-2'>
            <div className='flex items-center gap-2'>
              <input
                type='text'
                ref={editorRef}
                value={editGroupName}
                onChange={(e) => setEditGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmCreateGroup();
                  if (e.key === 'Escape') {
                    setShowInput(false);
                    setIsRenaming(false);
                    setOriginalGroupName(null);
                  }
                  e.stopPropagation();
                }}
                className='input input-ghost w-full border-0 px-2 text-base !outline-none sm:text-sm'
              />
              <button
                className={clsx(
                  'btn btn-ghost settings-content hover:bg-transparent',
                  'flex h-[1.3em] min-h-[1.3em] items-end p-0',
                  editGroupName ? '' : 'btn-disabled !bg-opacity-0',
                )}
                onClick={() => handleConfirmCreateGroup()}
              >
                <div className='pr-1 align-bottom text-base text-blue-500 sm:text-sm'>
                  {_('Save')}
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Breadcrumb navigation */}
        {currentPath && (
          <div className='mt-4 flex flex-wrap items-center gap-2 text-base'>
            <button
              onClick={handleNavigateBack}
              className='hover:bg-base-300 flex items-center gap-1 rounded px-2 py-1'
            >
              <IoMdArrowBack size={iconSize} />
            </button>
            <button
              onClick={() => handleNavigateToPath(undefined)}
              className='hover:bg-base-300 rounded px-2 py-1'
            >
              {_('All')}
            </button>
            {getBreadcrumbs(currentPath).map((crumb, index, array) => {
              const isLast = index === array.length - 1;
              return (
                <React.Fragment key={index}>
                  <MdChevronRight size={iconSize} className='text-neutral-content' />
                  {isLast ? (
                    <span className='truncate rounded px-2 py-1'>{crumb.name}</span>
                  ) : (
                    <button
                      onClick={() => handleNavigateToPath(crumb.path)}
                      className='hover:bg-base-300 truncate rounded px-2 py-1'
                    >
                      {crumb.name}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Groups list */}
        <ul className='groups-list mt-4 grid grid-cols-2 gap-2 overflow-x-hidden'>
          {currentGroupsList.map((group, index) => {
            const displayName = getDisplayName(group.name);
            const hasChildren = allGroups.some((g) => g.name.startsWith(group.name + '/'));
            return (
              <div key={index} className='flex min-w-0 gap-1'>
                <button
                  className={clsx(
                    'hover:bg-base-300 text-base-content flex min-w-0 max-w-[90%] flex-1',
                    'items-center justify-between gap-2 rounded-md px-2 py-2',
                  )}
                  onClick={() => handleToggleSelectGroup(group)}
                >
                  <div className='flex min-w-0 flex-1 items-center gap-2'>
                    <span className='shrink-0'>
                      <HiOutlineFolder size={iconSize} />
                    </span>
                    <span className='min-w-0 truncate text-base sm:text-sm'>{displayName}</span>
                  </div>
                  <span className='text-neutral-content flex shrink-0 text-sm'>
                    {selectedGroup && selectedGroup.id === group.id && (
                      <MdCheck className='fill-blue-500' size={iconSize} />
                    )}
                  </span>
                </button>
                {hasChildren && (
                  <button
                    onClick={() => handleNavigateToGroup(group)}
                    className='hover:bg-base-300 flex shrink-0 items-center rounded-md px-1'
                  >
                    <MdChevronRight size={iconSize} />
                  </button>
                )}
              </div>
            );
          })}
        </ul>

        {/* Footer actions */}
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
