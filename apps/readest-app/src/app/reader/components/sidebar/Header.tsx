import clsx from 'clsx';
import React from 'react';
import { GiBookshelf } from 'react-icons/gi';
import { FiSearch } from 'react-icons/fi';
import { MdOutlineMenu, MdOutlinePushPin, MdPushPin } from 'react-icons/md';
import { MdArrowBackIosNew } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import Dropdown from '@/components/Dropdown';
import BookMenu from './BookMenu';

const SidebarHeader: React.FC<{
  isPinned: boolean;
  isSearchBarVisible: boolean;
  onGoToLibrary: () => void;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleSearchBar: () => void;
}> = ({ isPinned, isSearchBarVisible, onGoToLibrary, onClose, onTogglePin, onToggleSearchBar }) => {
  const _ = useTranslation();
  const { isTrafficLightVisible } = useTrafficLight();
  const iconSize14 = useResponsiveSize(14);
  const iconSize18 = useResponsiveSize(18);
  const iconSize22 = useResponsiveSize(22);

  return (
    <div
      className={clsx(
        'sidebar-header flex h-11 items-center justify-between pe-2',
        isTrafficLightVisible ? 'ps-1.5 sm:ps-20' : 'ps-1.5',
      )}
      dir='ltr'
    >
      <div className='flex items-center gap-x-8'>
        <Button
          variant='ghost'
          size='icon-sm'
          onClick={onClose}
          className='flex sm:hidden'
          aria-label={_('Close')}
        >
          <MdArrowBackIosNew size={iconSize22} />
        </Button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='hidden sm:flex'
                onClick={onGoToLibrary}
              >
                <GiBookshelf className='fill-base-content' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom'>{_('Go to Library')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className='flex min-w-24 max-w-32 items-center justify-between sm:size-[70%]'>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                onClick={onToggleSearchBar}
                className={clsx(isSearchBarVisible && 'bg-base-300')}
              >
                <FiSearch size={iconSize18} className='text-base-content' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom'>
              {isSearchBarVisible ? _('Hide Search Bar') : _('Show Search Bar')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Dropdown
                  label={_('Book Menu')}
                  showTooltip={false}
                  className={clsx(
                    window.innerWidth < 640 && 'dropdown-end',
                    'dropdown-bottom flex justify-center',
                  )}
                  menuClassName={window.innerWidth < 640 ? 'no-triangle mt-1' : 'dropdown-center mt-3'}
                  buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
                  toggleButton={<MdOutlineMenu className='fill-base-content' />}
                >
                  <BookMenu />
                </Dropdown>
              </div>
            </TooltipTrigger>
            <TooltipContent side='bottom'>{_('Book Menu')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className='right-0 hidden h-8 w-8 items-center justify-center sm:flex'>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  onClick={onTogglePin}
                  className={clsx(
                    'sidebar-pin-btn hidden sm:flex',
                    isPinned ? 'bg-base-300' : 'bg-base-300/65',
                  )}
                >
                  {isPinned ? <MdPushPin size={iconSize14} /> : <MdOutlinePushPin size={iconSize14} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side='bottom'>
                {isPinned ? _('Unpin Sidebar') : _('Pin Sidebar')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
};

export default SidebarHeader;
