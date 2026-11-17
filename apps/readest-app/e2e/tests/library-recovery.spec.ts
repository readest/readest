import { createHash } from 'node:crypto';
import { expect, test } from '../fixtures/base';
import { SAMPLE_TXT } from '../fixtures/books';
import { LibraryPage } from '../pages/LibraryPage';

for (const partiallyRecovered of [false, true]) {
  test(`keeps readable books visible when recovery cannot save (earlier move completed: ${partiallyRecovered})`, async ({
    page,
  }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await library.importBook(SAMPLE_TXT);
    await expect(library.bookCards()).toHaveCount(1);

    const readBooks = () =>
      page.evaluate(
        () =>
          new Promise<{ hash: string; groupName?: string }[]>((resolve, reject) => {
            const open = indexedDB.open('AppFileSystem');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              const transaction = db.transaction('files');
              const read = transaction.objectStore('files').get('Readest/Books/library.json');
              read.onsuccess = () => resolve(JSON.parse(read.result?.content || '[]'));
              read.onerror = () => reject(read.error);
              transaction.oncomplete = () => db.close();
            };
          }),
      );
    await expect.poll(async () => (await readBooks()).length).toBe(1);
    const book = (await readBooks())[0]!;
    const key = 'readest.bookshelf.group-change.v1:readonly-e2e';
    const groupName = 'Recovered';
    const groupId = createHash('md5').update(groupName).digest('hex').slice(0, 7);
    await page.evaluate(
      ({ key, hash, groupId, groupName, partiallyRecovered, earlierGroupId }) => {
        if (partiallyRecovered)
          localStorage.setItem(
            key + ':earlier',
            JSON.stringify({
              account: '',
              createdAt: Date.now() - 1,
              before: [],
              after: [],
              books: [
                {
                  hash,
                  groupId: earlierGroupId,
                  groupName: 'Earlier',
                  groupUpdatedAt: Date.now() - 1,
                },
              ],
              rollback: false,
            }),
          );
        localStorage.setItem(
          key,
          JSON.stringify({
            account: '',
            createdAt: Date.now(),
            before: [],
            after: [],
            books: [{ hash, groupId, groupName, groupUpdatedAt: Date.now() }],
            rollback: false,
          }),
        );
        localStorage.setItem('readest.e2e.deny-library-write', 'true');
      },
      {
        key,
        hash: book.hash,
        groupId,
        groupName,
        partiallyRecovered,
        earlierGroupId: createHash('md5').update('Earlier').digest('hex').slice(0, 7),
      },
    );
    await page.addInitScript(
      ({ permittedWrites }) => {
        const put = IDBObjectStore.prototype.put;
        let writes = 0;
        IDBObjectStore.prototype.put = function (value, ...args) {
          if (
            localStorage.getItem('readest.e2e.deny-library-write') === 'true' &&
            (value?.path === 'Readest/Books/library.json' ||
              value?.path === 'Readest/Books/library.json.bak') &&
            writes++ >= permittedWrites
          )
            throw new Error('EACCES: library is readable but not writable');
          return put.call(this, value, ...args);
        };
      },
      { permittedWrites: partiallyRecovered ? 2 : 0 },
    );

    await page.reload();
    await expect(library.bookCards()).toHaveCount(1);
    await expect(library.emptyState).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBeTruthy();
    if (partiallyRecovered) {
      expect((await readBooks())[0]?.groupName).toBe('Earlier');
      await expect(library.bookshelf.locator('[data-group-name="Earlier"]')).toBeVisible();
      expect(await page.evaluate((key) => localStorage.getItem(key + ':earlier'), key)).toBeNull();
    } else expect((await readBooks())[0]?.groupName).toBeUndefined();

    await page.evaluate(() => localStorage.removeItem('readest.e2e.deny-library-write'));
    await page.reload();
    await expect.poll(async () => (await readBooks())[0]?.groupName).toBe(groupName);
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
    await expect(library.container).toBeVisible();
  });
}
