import { describe, expect, it } from 'vitest';
import {
  BOOKORBIT_AUDIO_SCHEME,
  isBookOrbitAudioFilePath,
  makeBookOrbitAudioFilePath,
  matchBookOrbitAudiobook,
  parseBookOrbitAudioFilePath,
} from '@/services/bookorbit/audiobookId';

const SETTINGS = { serverUrl: 'http://localhost:13380', username: 'admin', password: 'pw' };

describe('matchBookOrbitAudiobook', () => {
  // The user already browses their BookOrbit through OPDS. When the catalog
  // they are browsing IS the server they configured for sync, the audiobook
  // API can serve the same book with chapters, ranges and progress -- none of
  // which OPDS can express. The book id is right there in the acquisition href.
  it('recognises an audio entry served by the configured server', () => {
    const match = matchBookOrbitAudiobook(
      ['http://localhost:13380/api/v1/opds/9/download?fileId=23'],
      SETTINGS,
    );

    expect(match).toEqual({ bookId: 9 });
  });

  it('ignores a different host, even with the same URL shape', () => {
    expect(
      matchBookOrbitAudiobook(
        ['http://other.example.com/api/v1/opds/9/download?fileId=23'],
        SETTINGS,
      ),
    ).toBeNull();
  });

  it('tolerates a trailing slash and a port-qualified host', () => {
    expect(
      matchBookOrbitAudiobook(['http://localhost:13380/api/v1/opds/4/download?fileId=1'], {
        ...SETTINGS,
        serverUrl: 'http://localhost:13380/',
      }),
    ).toEqual({ bookId: 4 });
  });

  it('refuses when the tracks disagree about which book they belong to', () => {
    expect(
      matchBookOrbitAudiobook(
        [
          'http://localhost:13380/api/v1/opds/9/download?fileId=23',
          'http://localhost:13380/api/v1/opds/10/download?fileId=24',
        ],
        SETTINGS,
      ),
    ).toBeNull();
  });

  it('needs a password: the JWT login cannot run on a userkey alone', () => {
    expect(
      matchBookOrbitAudiobook(['http://localhost:13380/api/v1/opds/9/download?fileId=23'], {
        ...SETTINGS,
        password: '',
      }),
    ).toBeNull();
  });

  it('ignores hrefs that are not BookOrbit acquisition links', () => {
    expect(matchBookOrbitAudiobook(['http://localhost:13380/files/a.mp3'], SETTINGS)).toBeNull();
    expect(matchBookOrbitAudiobook([], SETTINGS)).toBeNull();
  });
});

describe('bookorbit filePath', () => {
  it('round-trips the book id', () => {
    const path = makeBookOrbitAudioFilePath(9);

    expect(path).toBe(`${BOOKORBIT_AUDIO_SCHEME}9`);
    expect(isBookOrbitAudioFilePath(path)).toBe(true);
    expect(parseBookOrbitAudioFilePath(path)).toBe(9);
  });

  it('rejects anything else', () => {
    expect(isBookOrbitAudioFilePath('opdsaudio://x')).toBe(false);
    expect(parseBookOrbitAudioFilePath('abs://s/i')).toBeNull();
    expect(parseBookOrbitAudioFilePath(`${BOOKORBIT_AUDIO_SCHEME}abc`)).toBeNull();
    expect(parseBookOrbitAudioFilePath(undefined)).toBeNull();
  });
});
