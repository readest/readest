import { describe, expect, it } from 'vitest';
import {
  buildOpdsAudioTracks,
  isOpdsAudioFilePath,
  makeOpdsAudioFilePath,
  parseOpdsAudioFilePath,
  pickAudioLinks,
} from '@/services/opds/audiobook';
import type { OPDSAcquisitionLink } from '@/types/opds';
import { REL } from '@/types/opds';

const link = (partial: Partial<OPDSAcquisitionLink> & { href: string }): OPDSAcquisitionLink => ({
  rel: REL.ACQ,
  ...partial,
});

describe('pickAudioLinks', () => {
  it('keeps only audio links, in feed order', () => {
    const links = [
      link({ href: '/a/3.mp3', type: 'audio/mpeg', title: 'MP3 - Chapter 03' }),
      link({ href: '/b.epub', type: 'application/epub+zip' }),
      link({ href: '/a/1.mp3', type: 'audio/mpeg', title: 'MP3 - Chapter 01' }),
    ];

    expect(pickAudioLinks(links).map((l) => l.href)).toEqual(['/a/3.mp3', '/a/1.mp3']);
  });

  it('finds the audio in a BookOrbit-shaped entry', () => {
    const links = [
      link({
        href: '/api/v1/opds/7/download?fileId=7',
        type: 'application/octet-stream',
        title: 'MP3',
      }),
      link({
        href: '/api/v1/opds/7/download?fileId=8',
        type: 'application/octet-stream',
        title: 'MP3',
      }),
    ];

    expect(pickAudioLinks(links)).toHaveLength(2);
  });

  it('is empty for an ebook-only entry', () => {
    expect(pickAudioLinks([link({ href: '/b.epub', type: 'application/epub+zip' })])).toEqual([]);
  });
});

describe('buildOpdsAudioTracks', () => {
  it('lays tracks end to end with cumulative offsets', () => {
    const tracks = buildOpdsAudioTracks(
      [
        { href: '/a/1.mp3', mimeType: 'audio/mpeg', title: 'Chapter 01' },
        { href: '/a/2.mp3', mimeType: 'audio/mpeg', title: 'Chapter 02' },
        { href: '/a/3.mp3', mimeType: 'audio/mpeg', title: 'Chapter 03' },
      ],
      [20, 30, 25],
    );

    expect(tracks.map((t) => t.startOffset)).toEqual([0, 20, 50]);
    expect(tracks.map((t) => t.duration)).toEqual([20, 30, 25]);
    expect(tracks.map((t) => t.index)).toEqual([0, 1, 2]);
    expect(tracks[1]!.contentUrl).toBe('/a/2.mp3');
    expect(tracks[1]!.mimeType).toBe('audio/mpeg');
  });

  it('drops tracks whose duration could not be probed', () => {
    const tracks = buildOpdsAudioTracks(
      [
        { href: '/a/1.mp3', mimeType: 'audio/mpeg' },
        { href: '/a/2.mp3', mimeType: 'audio/mpeg' },
        { href: '/a/3.mp3', mimeType: 'audio/mpeg' },
      ],
      [20, NaN, 25],
    );

    // A NaN duration would poison every later startOffset and the timeline's
    // total, making the whole book unseekable rather than just that file.
    expect(tracks).toHaveLength(2);
    expect(tracks.map((t) => t.contentUrl)).toEqual(['/a/1.mp3', '/a/3.mp3']);
    expect(tracks.map((t) => t.startOffset)).toEqual([0, 20]);
  });
});

describe('opdsaudio filePath', () => {
  const data = {
    catalogId: 'cat-1',
    title: 'Range Test Audiobook',
    author: 'Range Tester',
    tracks: [
      { href: 'http://host/a/1.mp3', mimeType: 'audio/mpeg', title: 'Chapter 01' },
      { href: 'http://host/a/2.mp3', mimeType: 'audio/mpeg', title: 'Chapter 02' },
    ],
  };

  it('round-trips through the synthetic filePath', () => {
    const path = makeOpdsAudioFilePath(data);

    expect(isOpdsAudioFilePath(path)).toBe(true);
    expect(parseOpdsAudioFilePath(path)).toEqual(data);
  });

  it('survives titles with characters that break a bare URL', () => {
    const path = makeOpdsAudioFilePath({ ...data, title: 'A & B / 100% "done"?' });

    expect(parseOpdsAudioFilePath(path)?.title).toBe('A & B / 100% "done"?');
  });

  it('rejects a path that is not an opdsaudio one', () => {
    expect(isOpdsAudioFilePath('abs://server/item')).toBe(false);
    expect(parseOpdsAudioFilePath('abs://server/item')).toBeNull();
    expect(parseOpdsAudioFilePath(undefined)).toBeNull();
  });
});
