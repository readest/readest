import type { TransferItem } from '@/store/transferStore';
import type { TranslationFunc } from '@/hooks/useTranslation';

export interface TransferMessages {
  success: { upload: string; download: string; delete: string };
  failure: { upload: string; download: string; delete: string };
}

/**
 * Build per-kind toast copy for a TransferItem. Books and replica kinds
 * (currently just `dictionary`; fonts / textures / OPDS catalogs come
 * later) get distinct strings so the toast doesn't say "Book uploaded"
 * when a dictionary just synced.
 *
 * Future replica kinds slot into the switch on transfer.replicaKind.
 */
export const getTransferMessages = (
  transfer: TransferItem,
  _: TranslationFunc,
): TransferMessages => {
  const title = transfer.bookTitle;

  if (transfer.kind === 'replica' && transfer.replicaKind === 'dictionary') {
    return {
      success: {
        upload: _('Dictionary uploaded: {{title}}', { title }),
        download: _('Dictionary downloaded: {{title}}', { title }),
        delete: _('Deleted cloud copy of the dictionary: {{title}}', { title }),
      },
      failure: {
        upload: _('Failed to upload dictionary: {{title}}', { title }),
        download: _('Failed to download dictionary: {{title}}', { title }),
        delete: _('Failed to delete cloud copy of the dictionary: {{title}}', { title }),
      },
    };
  }

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
};
