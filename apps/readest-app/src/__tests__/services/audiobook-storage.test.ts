import { describe, expect, it, vi } from 'vitest';

import type { AudiobookChapterMapping, PairedAudiobook } from '@/types/book';
import {
  importPairedAudiobook,
  persistStreamedPairedAudiobook,
  replacePairedAudiobook,
  removePairedAudiobook,
  type AudiobookStorage,
} from '@/services/audiobook/storage';

// A pairing streamed from an Audiobookshelf server: nothing of it is on disk.
const streamed: PairedAudiobook = {
  version: 1,
  files: [{ id: 'abs', name: 'Book', path: 'abs://srv1/item1', duration: 100 }],
  chapters: [],
  mappings: [{ ebookChapterId: 'ch1.xhtml', audioChapterId: 'abs:0' }],
  createdAt: 2,
  source: {
    kind: 'audiobookshelf',
    serverId: 'srv1',
    itemId: 'item1',
    tracks: [{ index: 1, startOffset: 0, duration: 100, contentUrl: '/api/items/item1/file/1' }],
  },
};

const makeStorage = (): AudiobookStorage => ({
  createDir: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  deleteDir: vi.fn().mockResolvedValue(undefined),
});

describe('paired audiobook storage', () => {
  it('copies selected files into the book directory and persists relative paths', async () => {
    const storage = makeStorage();
    const file = new File(['audio'], '01: Opening?.mp3', { type: 'audio/mpeg' });
    const mappings: AudiobookChapterMapping[] = [
      { ebookChapterId: 'opening.xhtml', audioChapterId: 'audio-0:0' },
    ];

    const association = await importPairedAudiobook(storage, 'book-hash', mappings, [
      {
        file,
        metadata: {
          id: 'audio-0',
          name: file.name,
          duration: 42,
          title: 'The Book',
          narrator: 'A Narrator',
          chapters: [
            {
              id: 'audio-0:0',
              fileId: 'audio-0',
              label: 'Opening',
              start: 0,
              end: 42,
            },
          ],
        },
      },
    ]);

    expect(storage.createDir).toHaveBeenCalledWith('book-hash/audiobook', 'Books', true);
    expect(storage.writeFile).toHaveBeenCalledWith(association.files[0]!.path, 'Books', file);
    expect(association.files[0]!.path).toMatch(
      /^book-hash\/audiobook\/\d+-audio-0-01_ Opening_\.mp3$/,
    );
    expect(association).toMatchObject({
      version: 1,
      title: 'The Book',
      narrator: 'A Narrator',
      files: [
        {
          id: 'audio-0',
          name: '01: Opening?.mp3',
          path: association.files[0]!.path,
          duration: 42,
        },
      ],
      chapters: [
        {
          id: 'audio-0:0',
          fileId: 'audio-0',
          label: 'Opening',
          start: 0,
          end: 42,
        },
      ],
      mappings,
    });
  });

  it('copies a native picker path without streaming the full audiobook through JavaScript', async () => {
    const storage = makeStorage();
    const file = new File([], 'Novel.m4b', { type: 'audio/mp4' });

    const association = await importPairedAudiobook(
      storage,
      'book-hash',
      [],
      [
        {
          file,
          sourcePath: '/picked/Novel.m4b',
          metadata: {
            id: 'audio-0',
            name: file.name,
            duration: 3_600,
            chapters: [
              {
                id: 'audio-0:0',
                fileId: 'audio-0',
                label: 'Novel',
                start: 0,
                end: 3_600,
              },
            ],
          },
        },
      ],
    );

    expect(storage.copyFile).toHaveBeenCalledWith(
      '/picked/Novel.m4b',
      'None',
      association.files[0]!.path,
      'Books',
    );
    expect(storage.writeFile).not.toHaveBeenCalled();
  });

  it('removes every partially imported file when a later copy fails', async () => {
    const storage = makeStorage();
    vi.mocked(storage.copyFile)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('copy failed'));
    const importFile = (index: number): Parameters<typeof importPairedAudiobook>[3][number] => ({
      file: new File([], `${index}.mp3`, { type: 'audio/mpeg' }),
      sourcePath: `/picked/${index}.mp3`,
      metadata: {
        id: `audio-${index}`,
        name: `${index}.mp3`,
        duration: 10,
        chapters: [
          {
            id: `audio-${index}:0`,
            fileId: `audio-${index}`,
            label: `Chapter ${index}`,
            start: 0,
            end: 10,
          },
        ],
      },
    });

    await expect(
      importPairedAudiobook(storage, 'book-hash', [], [importFile(1), importFile(2)]),
    ).rejects.toThrow('copy failed');

    const attemptedPaths = vi.mocked(storage.copyFile).mock.calls.map(([, , path]) => path);
    expect(storage.deleteFile).toHaveBeenCalledTimes(2);
    expect(vi.mocked(storage.deleteFile).mock.calls.map(([path]) => path)).toEqual(attemptedPaths);
  });

  it('removes only the paired-audio directory', async () => {
    const storage = makeStorage();
    const association: PairedAudiobook = {
      version: 1,
      files: [],
      chapters: [],
      mappings: [],
      createdAt: 1,
    };

    const persist = vi.fn().mockResolvedValue(undefined);
    await removePairedAudiobook(storage, 'book-hash', association, persist);

    expect(persist).toHaveBeenCalledWith(undefined);
    expect(storage.deleteDir).toHaveBeenCalledWith('book-hash/audiobook', 'Books', true);
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(storage.deleteDir).mock.invocationCallOrder[0]!,
    );
  });

  it('unpairs a streamed audiobook without touching the book directory', async () => {
    const storage = makeStorage();
    const persist = vi.fn().mockResolvedValue(undefined);

    await removePairedAudiobook(storage, 'book-hash', streamed, persist);

    expect(persist).toHaveBeenCalledWith(undefined);
    expect(storage.deleteDir).not.toHaveBeenCalled();
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('persists a streamed pairing, then deletes the local files of the pairing it replaces', async () => {
    const storage = makeStorage();
    const previous: PairedAudiobook = {
      version: 1,
      files: [
        { id: 'audio-0', name: 'a.mp3', path: 'book-hash/audiobook/1-audio-0-a.mp3', duration: 1 },
        { id: 'audio-1', name: 'b.mp3', path: 'other-hash/audiobook/1-audio-1-b.mp3', duration: 1 },
      ],
      chapters: [],
      mappings: [],
      createdAt: 1,
    };
    const persist = vi.fn().mockResolvedValue(undefined);

    const result = await persistStreamedPairedAudiobook(
      storage,
      'book-hash',
      streamed,
      previous,
      persist,
    );

    expect(result).toBe(streamed);
    expect(persist).toHaveBeenCalledWith(streamed);
    expect(storage.copyFile).not.toHaveBeenCalled();
    expect(storage.writeFile).not.toHaveBeenCalled();
    expect(storage.createDir).not.toHaveBeenCalled();
    expect(storage.deleteFile).toHaveBeenCalledTimes(1);
    expect(storage.deleteFile).toHaveBeenCalledWith('book-hash/audiobook/1-audio-0-a.mp3', 'Books');
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(storage.deleteFile).mock.invocationCallOrder[0]!,
    );
  });

  it('keeps the previous local files when persisting a streamed pairing fails', async () => {
    const storage = makeStorage();
    const previous: PairedAudiobook = {
      version: 1,
      files: [
        { id: 'audio-0', name: 'a.mp3', path: 'book-hash/audiobook/1-audio-0-a.mp3', duration: 1 },
      ],
      chapters: [],
      mappings: [],
      createdAt: 1,
    };
    const persist = vi.fn().mockRejectedValue(new Error('disk full'));

    await expect(
      persistStreamedPairedAudiobook(storage, 'book-hash', streamed, previous, persist),
    ).rejects.toThrow('disk full');

    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('persists a replacement before deleting files left behind by the previous pairing', async () => {
    const storage = makeStorage();
    const file = new File(['new'], 'new.mp3', { type: 'audio/mpeg' });
    const previous: PairedAudiobook = {
      version: 1,
      files: [{ id: 'old-0', name: 'old.mp3', path: 'book-hash/audiobook/old.mp3', duration: 10 }],
      chapters: [],
      mappings: [],
      createdAt: 1,
    };

    const persist = vi.fn().mockResolvedValue(undefined);
    await replacePairedAudiobook(
      storage,
      'book-hash',
      [],
      [
        {
          file,
          metadata: {
            id: 'audio-0',
            name: file.name,
            duration: 20,
            chapters: [
              {
                id: 'audio-0:0',
                fileId: 'audio-0',
                label: 'New',
                start: 0,
                end: 20,
              },
            ],
          },
        },
      ],
      previous,
      persist,
    );

    expect(persist).toHaveBeenCalledOnce();
    expect(storage.deleteFile).toHaveBeenCalledWith('book-hash/audiobook/old.mp3', 'Books');
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(storage.deleteFile).mock.invocationCallOrder.at(-1)!,
    );
  });

  it('never deletes paths outside the current book audiobook directory', async () => {
    const storage = makeStorage();
    const file = new File(['new'], 'new.mp3', { type: 'audio/mpeg' });
    const previous: PairedAudiobook = {
      version: 1,
      files: [
        { id: 'safe', name: 'safe.mp3', path: 'book-hash/audiobook/safe.mp3', duration: 10 },
        { id: 'other', name: 'other.epub', path: 'other-book/book.epub', duration: 10 },
        {
          id: 'traversal',
          name: 'private.json',
          path: 'book-hash/audiobook/../../private.json',
          duration: 10,
        },
        { id: 'absolute', name: 'absolute', path: '/private/absolute', duration: 10 },
      ],
      chapters: [],
      mappings: [],
      createdAt: 1,
    };

    await replacePairedAudiobook(
      storage,
      'book-hash',
      [],
      [
        {
          file,
          metadata: {
            id: 'audio-0',
            name: file.name,
            duration: 20,
            chapters: [
              {
                id: 'audio-0:0',
                fileId: 'audio-0',
                label: 'New',
                start: 0,
                end: 20,
              },
            ],
          },
        },
      ],
      previous,
      vi.fn().mockResolvedValue(undefined),
    );

    expect(storage.deleteFile).toHaveBeenCalledTimes(1);
    expect(storage.deleteFile).toHaveBeenCalledWith('book-hash/audiobook/safe.mp3', 'Books');
  });

  it('rolls back newly copied files and preserves old files when config persistence fails', async () => {
    const storage = makeStorage();
    const file = new File(['new'], 'new.mp3', { type: 'audio/mpeg' });
    const previous: PairedAudiobook = {
      version: 1,
      files: [{ id: 'old-0', name: 'old.mp3', path: 'book-hash/audiobook/old.mp3', duration: 10 }],
      chapters: [],
      mappings: [],
      createdAt: 1,
    };
    const persistError = new Error('config write failed');

    await expect(
      replacePairedAudiobook(
        storage,
        'book-hash',
        [],
        [
          {
            file,
            metadata: {
              id: 'audio-0',
              name: file.name,
              duration: 20,
              chapters: [
                {
                  id: 'audio-0:0',
                  fileId: 'audio-0',
                  label: 'New',
                  start: 0,
                  end: 20,
                },
              ],
            },
          },
        ],
        previous,
        vi.fn().mockRejectedValue(persistError),
      ),
    ).rejects.toBe(persistError);

    const deletedPaths = vi.mocked(storage.deleteFile).mock.calls.map(([path]) => path);
    expect(deletedPaths).not.toContain('book-hash/audiobook/old.mp3');
    expect(deletedPaths).toHaveLength(1);
    expect(deletedPaths[0]).toMatch(/^book-hash\/audiobook\/\d+-audio-0-new\.mp3$/);
  });

  it('does not remove files when clearing the persisted association fails', async () => {
    const storage = makeStorage();
    const association: PairedAudiobook = {
      version: 1,
      files: [],
      chapters: [],
      mappings: [],
      createdAt: 1,
    };

    await expect(
      removePairedAudiobook(
        storage,
        'book-hash',
        association,
        vi.fn().mockRejectedValue(new Error('config write failed')),
      ),
    ).rejects.toThrow('config write failed');

    expect(storage.deleteDir).not.toHaveBeenCalled();
  });
});
