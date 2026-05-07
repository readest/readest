import type { TransferItem } from '@/store/transferStore';
import type { TranslationFunc } from '@/hooks/useTranslation';

export interface TransferMessages {
  success: { upload: string; download: string; delete: string };
  failure: { upload: string; download: string; delete: string };
}

/**
 * Build per-kind toast copy for a TransferItem. Books keep their own
 * copy ("Book uploaded"); everything else — replica kinds (dictionary,
 * font, textures, OPDS catalogs, …) and any future transfer kind —
 * falls through to the generic "File uploaded" string so we don't have
 * to add a per-kind branch each time.
 */
export const getTransferMessages = (
  transfer: TransferItem,
  _: TranslationFunc,
): TransferMessages => {
  const title = transfer.bookTitle;

  if (transfer.kind === 'book') {
    return {
      success: {
        upload: _('Book uploaded: {{title}}', { title }),
        download: _('Book downloaded: {{title}}', { title }),
        delete: _('Deleted cloud backup of the book: {{title}}', { title }),
      },
      failure: {
        upload: _('Failed to upload book: {{title}}', { title }),
        download: _('Failed to download book: {{title}}', { title }),
        delete: _('Failed to delete cloud backup of the book: {{title}}', { title }),
      },
    };
  }

  return {
    success: {
      upload: _('File uploaded: {{title}}', { title }),
      download: _('File downloaded: {{title}}', { title }),
      delete: _('Deleted cloud copy of the file: {{title}}', { title }),
    },
    failure: {
      upload: _('Failed to upload file: {{title}}', { title }),
      download: _('Failed to download file: {{title}}', { title }),
      delete: _('Failed to delete cloud copy of the file: {{title}}', { title }),
    },
  };
};
