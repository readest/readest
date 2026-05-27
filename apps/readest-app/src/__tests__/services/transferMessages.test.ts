import { describe, expect, test } from 'vitest';
import { getTransferMessages } from '@/services/transferMessages';
import type { TransferItem } from '@/store/transferStore';
import type { TranslationFunc } from '@/hooks/useTranslation';

const passthroughT: TranslationFunc = (key, params) => {
  if (!params) return key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)), key);
};

const baseTransfer = (overrides: Partial<TransferItem> = {}): TransferItem =>
  ({
    id: 't1',
    kind: 'book',
    bookHash: 'h1',
    bookTitle: 'Moby Dick',
    type: 'upload',
    status: 'pending',
    progress: 0,
    totalBytes: 0,
    transferredBytes: 0,
    transferSpeed: 0,
    retryCount: 0,
    maxRetries: 3,
    createdAt: 0,
    priority: 10,
    isBackground: false,
    ...overrides,
  }) as TransferItem;

describe('getTransferMessages', () => {
  test('book transfer uses "Book" copy', () => {
    const m = getTransferMessages(baseTransfer({ bookTitle: 'Moby Dick' }), passthroughT);
    expect(m.success.upload).toBe('Book uploaded: Moby Dick');
    expect(m.success.download).toBe('Book downloaded: Moby Dick');
    expect(m.success.delete).toBe('Deleted cloud backup of the book: Moby Dick');
    expect(m.failure.upload).toBe('Failed to upload book: Moby Dick');
    expect(m.failure.download).toBe('Failed to download book: Moby Dick');
    expect(m.failure.delete).toBe('Failed to delete cloud backup of the book: Moby Dick');
  });

  test('dictionary replica transfer uses generic "File" copy', () => {
    const m = getTransferMessages(
      baseTransfer({
        kind: 'replica',
        replicaKind: 'dictionary',
        bookHash: '',
        bookTitle: 'Longman Phrasal Verbs',
      }),
      passthroughT,
    );
    expect(m.success.upload).toBe('File uploaded: Longman Phrasal Verbs');
    expect(m.success.download).toBe('File downloaded: Longman Phrasal Verbs');
    expect(m.success.delete).toBe('Deleted cloud copy of the file: Longman Phrasal Verbs');
    expect(m.failure.upload).toBe('Failed to upload file: Longman Phrasal Verbs');
    expect(m.failure.download).toBe('Failed to download file: Longman Phrasal Verbs');
    expect(m.failure.delete).toBe('Failed to delete cloud copy of the file: Longman Phrasal Verbs');
  });

  test('font replica transfer also uses generic "File" copy', () => {
    const m = getTransferMessages(
      baseTransfer({ kind: 'replica', replicaKind: 'font', bookTitle: 'Roboto' }),
      passthroughT,
    );
    expect(m.success.upload).toBe('File uploaded: Roboto');
    expect(m.success.download).toBe('File downloaded: Roboto');
    expect(m.success.delete).toBe('Deleted cloud copy of the file: Roboto');
  });
});
