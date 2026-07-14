import type { IconType } from 'react-icons';
import { IoFileTray } from 'react-icons/io5';
import { MdLink, MdRssFeed } from 'react-icons/md';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';

export interface ImportOptionHandlers {
  onImportBooksFromFiles: () => void;
  onImportBooksFromDirectory?: () => void;
  onImportBookFromUrl?: () => void;
  onOpenCatalogManager: () => void;
}

export interface ImportOption {
  id: 'file' | 'directory' | 'url' | 'catalog';
  label: string;
  description: string;
  Icon: IconType;
  onSelect: () => void;
}

export function useImportOptions({
  onImportBooksFromFiles,
  onImportBooksFromDirectory,
  onImportBookFromUrl,
  onOpenCatalogManager,
}: ImportOptionHandlers): ImportOption[] {
  const _ = useTranslation();
  const { appService } = useEnv();

  return [
    {
      id: 'file',
      label: _('From Local File'),
      description: _('Choose one or more books from your device'),
      Icon: IoFileTray,
      onSelect: onImportBooksFromFiles,
    },
    ...(onImportBooksFromDirectory
      ? [
          {
            id: 'directory' as const,
            label: _('From Directory'),
            description: _('Import supported books from a folder'),
            Icon: IoFileTray,
            onSelect: onImportBooksFromDirectory,
          },
        ]
      : []),
    ...(onImportBookFromUrl
      ? [
          {
            id: 'url' as const,
            label: _('From Web URL'),
            description: _('Import a book using a direct download link'),
            Icon: MdLink,
            onSelect: onImportBookFromUrl,
          },
        ]
      : []),
    {
      id: 'catalog',
      label: appService?.isOnlineCatalogsAccessible ? _('Online Library') : _('OPDS Catalogs'),
      description: _('Browse and download books from online catalogs'),
      Icon: MdRssFeed,
      onSelect: onOpenCatalogManager,
    },
  ];
}
