import { parseBlob } from 'music-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAudiobookChapters, parseAudiobookFile } from '@/services/audiobook/metadata';
import { readMp4Chapters } from '@/services/audiobook/mp4Chapters';

vi.mock('music-metadata', () => ({ parseBlob: vi.fn() }));
vi.mock('@/services/audiobook/mp4Chapters', () => ({ readMp4Chapters: vi.fn() }));

beforeEach(() => {
  vi.mocked(parseBlob).mockReset();
  vi.mocked(readMp4Chapters).mockReset().mockResolvedValue([]);
});

const audioWithoutChapters = (duration: number) => ({
  format: { duration, chapters: [], trackInfo: [], tagTypes: [] },
  common: {
    title: 'The Book',
    track: { no: null, of: null },
    disk: { no: null, of: null },
    movementIndex: { no: null, of: null },
  },
  native: {},
  quality: { warnings: [] },
});

describe('buildAudiobookChapters', () => {
  it('converts MP4 chapter timescales and derives missing end times', () => {
    expect(
      buildAudiobookChapters('audio-0', 'Novel.m4b', 75, [
        { title: 'Opening', start: 0, timeScale: 1_000 },
        { title: 'Chapter 1', start: 15_000, timeScale: 1_000 },
        { title: 'Chapter 2', start: 45_000, timeScale: 1_000 },
      ]),
    ).toEqual([
      {
        id: 'audio-0:0',
        fileId: 'audio-0',
        label: 'Opening',
        start: 0,
        end: 15,
      },
      {
        id: 'audio-0:1',
        fileId: 'audio-0',
        label: 'Chapter 1',
        start: 15,
        end: 45,
      },
      {
        id: 'audio-0:2',
        fileId: 'audio-0',
        label: 'Chapter 2',
        start: 45,
        end: 75,
      },
    ]);
  });

  it('uses ID3 chapter seconds directly', () => {
    expect(
      buildAudiobookChapters('audio-1', 'Track.mp3', 30, [
        { title: 'First', start: 2, end: 12 },
        { title: 'Second', start: 12, end: 30 },
      ]),
    ).toEqual([
      { id: 'audio-1:0', fileId: 'audio-1', label: 'First', start: 2, end: 12 },
      { id: 'audio-1:1', fileId: 'audio-1', label: 'Second', start: 12, end: 30 },
    ]);
  });

  it('drops chapters that start past the audio and clamps the rest to it', () => {
    expect(
      buildAudiobookChapters('audio-3', 'Novel.m4b', 90, [
        { title: 'A', start: 0 },
        { title: 'B', start: 300 },
        { title: 'C', start: 600 },
      ]),
    ).toEqual([{ id: 'audio-3:0', fileId: 'audio-3', label: 'A', start: 0, end: 90 }]);
  });

  it('labels the synthesized chapter with the fallback label when given one', () => {
    expect(buildAudiobookChapters('audio-4', 'My Audiobook.m4b', 90, [], 'The Book')).toEqual([
      { id: 'audio-4:0', fileId: 'audio-4', label: 'The Book', start: 0, end: 90 },
    ]);
  });

  it('falls back to one full-file chapter when the file has no chapter table', () => {
    expect(buildAudiobookChapters('audio-2', '03 - The Journey.mp3', 91, [])).toEqual([
      {
        id: 'audio-2:0',
        fileId: 'audio-2',
        label: '03 - The Journey',
        start: 0,
        end: 91,
      },
    ]);
  });
});

describe('parseAudiobookFile', () => {
  it('reads title, narrator, duration, and fallback chapter metadata', async () => {
    vi.mocked(parseBlob).mockResolvedValue({
      format: { duration: 90, chapters: [], trackInfo: [], tagTypes: [] },
      common: {
        title: 'Opening',
        album: 'The Book',
        albumartist: 'A Narrator',
        track: { no: null, of: null },
        disk: { no: null, of: null },
        movementIndex: { no: null, of: null },
      },
      native: {},
      quality: { warnings: [] },
    });

    await expect(
      parseAudiobookFile(new File(['audio'], 'book.m4b'), 'audio-0'),
    ).resolves.toMatchObject({
      id: 'audio-0',
      title: 'The Book',
      narrator: 'A Narrator',
      duration: 90,
      chapters: [{ label: 'Opening', start: 0, end: 90 }],
    });
  });

  it('uses the MP4 chapter reader when music-metadata returns no chapters', async () => {
    vi.mocked(parseBlob).mockResolvedValue(audioWithoutChapters(90));
    vi.mocked(readMp4Chapters).mockResolvedValue([
      { title: 'Opening Credits', start: 0, timeScale: 1_000 },
      { title: 'Chapter 1', start: 30_000, timeScale: 1_000 },
    ]);
    const file = new File(['audio'], 'book.m4b');

    await expect(parseAudiobookFile(file, 'audio-0')).resolves.toMatchObject({
      chapters: [
        { label: 'Opening Credits', start: 0, end: 30 },
        { label: 'Chapter 1', start: 30, end: 90 },
      ],
    });
    expect(readMp4Chapters).toHaveBeenCalledWith(file);
  });

  it('keeps the embedded title when every MP4 chapter is rejected', async () => {
    vi.mocked(parseBlob).mockResolvedValue(audioWithoutChapters(90));
    // A trailing marker sample at the very end of the audio yields no usable
    // chapter, so the single full-file chapter must still carry the title.
    vi.mocked(readMp4Chapters).mockResolvedValue([
      { title: 'End Credits', start: 90_000, timeScale: 1_000 },
    ]);

    await expect(
      parseAudiobookFile(new File(['audio'], 'My Audiobook.m4b'), 'audio-0'),
    ).resolves.toMatchObject({
      chapters: [{ label: 'The Book', start: 0, end: 90 }],
    });
  });

  it('keeps the single full-file chapter when the MP4 chapter fallback fails', async () => {
    vi.mocked(parseBlob).mockResolvedValue(audioWithoutChapters(90));
    vi.mocked(readMp4Chapters).mockRejectedValue(new RangeError('Offset is outside the bounds'));

    await expect(
      parseAudiobookFile(new File(['audio'], 'book.m4b'), 'audio-0'),
    ).resolves.toMatchObject({
      chapters: [{ label: 'The Book', start: 0, end: 90 }],
    });
  });

  it('rejects audio whose duration cannot be determined', async () => {
    vi.mocked(parseBlob).mockResolvedValue({
      format: { chapters: [], trackInfo: [], tagTypes: [] },
      common: {
        track: { no: null, of: null },
        disk: { no: null, of: null },
        movementIndex: { no: null, of: null },
      },
      native: {},
      quality: { warnings: [] },
    });

    await expect(parseAudiobookFile(new File(['audio'], 'broken.m4b'), 'audio-0')).rejects.toThrow(
      'Could not determine the duration of broken.m4b',
    );
  });
});
