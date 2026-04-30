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

  const getGroupTypeLabel = (): string => {
    switch (groupBy) {
      case LibraryGroupByType.Series:
        return _('Series');
      case LibraryGroupByType.Author:
        return _('Author');
      default:
        return _('Group');
    }
  };

  return (
    <div className='flex items-center gap-3 border-b border-[rgba(185,133,44,0.12)] px-6 py-4 sm:px-8'>
      <button
        onClick={handleBack}
        className='inline-flex h-9 min-h-9 items-center justify-center rounded-full border border-[rgba(185,133,44,0.22)] bg-[rgba(255,255,255,0.02)] px-3 text-[#c6aa73] transition-colors hover:bg-[rgba(185,133,44,0.1)]'
        aria-label={_('Back to library')}
      >
        <MdArrowBack size={iconSize} />
      </button>
      <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
        <span className='text-xs uppercase tracking-[0.16em] text-[#7c694e]'>
          {getGroupTypeLabel()}:
        </span>
        <span
          className='truncate text-base text-[#efdfc4]'
          style={{ fontFamily: 'Georgia, Palatino, "Palatino Linotype", serif' }}
        >
          {groupName}
        </span>
      </div>
    </div>
  );
};

export default GroupHeader;
