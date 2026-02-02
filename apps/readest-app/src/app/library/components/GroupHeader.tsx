import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MdArrowBack } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { navigateToLibrary } from '@/utils/nav';
import { LibraryGroupByType } from '@/types/settings';

interface GroupHeaderProps {
  groupBy: LibraryGroupByType;
  groupName: string;
}

/**
 * Header component displayed when viewing books inside a series or author group.
 * Shows the group type, group name, and a back button to return to the main bookshelf.
 */
const GroupHeader: React.FC<GroupHeaderProps> = ({ groupBy, groupName }) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const iconSize = useResponsiveSize(20);

  const handleBack = () => {
    const params = new URLSearchParams(searchParams?.toString());
    params.delete('group');
    navigateToLibrary(router, params.toString());
  };

  // Get localized label for the group type
  const getGroupTypeLabel = (): string => {
    switch (groupBy) {
      case 'series':
        return _('Series');
      case 'author':
        return _('Author');
      default:
        return _('Group');
    }
  };

  return (
    <div className='flex items-center gap-2 px-4 py-2'>
      <button
        onClick={handleBack}
        className='btn btn-ghost btn-sm h-8 min-h-8 px-2'
        aria-label={_('Back to library')}
      >
        <MdArrowBack size={iconSize} />
      </button>
      <div className='flex items-center gap-2 overflow-hidden'>
        <span className='text-neutral-content text-sm'>{getGroupTypeLabel()}:</span>
        <span className='truncate text-base font-medium'>{groupName}</span>
      </div>
    </div>
  );
};

export default GroupHeader;
