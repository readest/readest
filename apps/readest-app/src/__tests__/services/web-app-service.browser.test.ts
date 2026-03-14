import { describe, it, expect, beforeEach } from 'vitest';
import { WebAppService } from '@/services/webAppService';
import { fsTests } from './suites/fs-tests';
import { libraryTests } from './suites/library-tests';
import { bookTests } from './suites/book-tests';

async function getBookFile(name: string): Promise<File> {
  const url = new URL(`../fixtures/data/${name}`, import.meta.url).href;
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type });
}

/** Clear all records from the IndexedDB object store without deleting the database. */
async function clearStore() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('AppFileSystem', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'path' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    request.onerror = () => reject(request.error);
  });
}

describe('WebAppService', () => {
  let service: WebAppService;

  beforeEach(async () => {
    await clearStore();
    service = new WebAppService();
    await service.init();
  });

  it('should resolve file paths with base prefix', async () => {
    const resolved = await service.resolveFilePath('test.json', 'Books');
    expect(resolved).toBe('Readest/Books/test.json');
  });

  it('should resolve empty Data path to prefix', async () => {
    const resolved = await service.resolveFilePath('', 'Data');
    expect(resolved).toBe('Readest');
  });

  it('should set localBooksDir after init', () => {
    expect(service.localBooksDir).toBe('Readest/Books');
  });

  fsTests(() => service);
  libraryTests(() => service);
  bookTests(() => service, getBookFile);
});
