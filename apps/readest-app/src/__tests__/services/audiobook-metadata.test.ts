import { describe, expect, it } from 'vitest';

import { buildAudiobookChapters } from '@/services/audiobook/metadata';

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
