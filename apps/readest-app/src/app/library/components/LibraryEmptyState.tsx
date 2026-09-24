import * as React from 'react';
import { PiBooks } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import LibraryImportButton from './LibraryImportButton';

interface LibraryEmptyStateProps {
  onImport: (anchor: HTMLElement) => void;
}

const LibraryEmptyState: React.FC<LibraryEmptyStateProps> = ({ onImport }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const isMobile = appService?.isMobile ?? false;

  return (
    <div className='hero-content text-neutral-content text-center'>
      <div className='flex max-w-md flex-col items-center'>
        <PiBooks aria-hidden className='text-base-content/60 mb-10 size-16' />
        <h1 className='mb-5 text-balance text-4xl font-semibold leading-tight tracking-tight'>
          {_('Start your library')}
        </h1>
        <p className='text-base-content/70 mb-12 text-pretty text-base leading-relaxed'>
          {isMobile
            ? _('Pick a book from your device to add it to your library.')
            : _('Drop a book anywhere on this window, or pick one from your computer.')}
        </p>
        <div className='flex w-full max-w-xs flex-col gap-3'>
          <LibraryImportButton onImport={onImport} primary />
          {/* TODO: add a 'Browse free catalogs' secondary action that opens the
              OPDS dialog (handleShowOPDSDialog) once we settle on placement. */}
        </div>
      </div>
    </div>
  );
};

export default LibraryEmptyState;
