import { describe, expect, it, vi } from 'vitest';

import type { AudiobookChapterMapping, PairedAudiobook } from '@/types/book';
import {
  importPairedAudiobook,
  removePairedAudiobook,
  type AudiobookStorage,
} from '@/services/audiobook/storage';

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
    expect(storage.writeFile).toHaveBeenCalledWith(
      'book-hash/audiobook/audio-0-01_ Opening_.mp3',
      'Books',
      file,
    );
    expect(association).toMatchObject({
      version: 1,
      title: 'The Book',
      narrator: 'A Narrator',
      files: [
        {
          id: 'audio-0',
          name: '01: Opening?.mp3',
          path: 'book-hash/audiobook/audio-0-01_ Opening_.mp3',
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

    await importPairedAudiobook(
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
      'book-hash/audiobook/audio-0-Novel.m4b',
      'Books',
    );
    expect(storage.writeFile).not.toHaveBeenCalled();
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

    await removePairedAudiobook(storage, 'book-hash', association);

    expect(storage.deleteDir).toHaveBeenCalledWith('book-hash/audiobook', 'Books', true);
  });

  it('deletes files left behind when an existing pairing is replaced', async () => {
    const storage = makeStorage();
    const file = new File(['new'], 'new.mp3', { type: 'audio/mpeg' });
    const previous: PairedAudiobook = {
      version: 1,
      files: [{ id: 'old-0', name: 'old.mp3', path: 'book-hash/audiobook/old.mp3', duration: 10 }],
      chapters: [],
      mappings: [],
      createdAt: 1,
    };

    await importPairedAudiobook(
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
    );

    expect(storage.deleteFile).toHaveBeenCalledWith('book-hash/audiobook/old.mp3', 'Books');
  });
});
