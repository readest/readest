import { describe, expect, it } from 'vitest';
import type { OPDSAcquisitionLink } from '@/types/opds';
import { REL } from '@/types/opds';
import { classifyAcquisitionLink, getAudioFormat, isAudioLink } from '@/services/opds/formats';

const link = (partial: Partial<OPDSAcquisitionLink> & { href: string }): OPDSAcquisitionLink => ({
  rel: REL.ACQ,
  ...partial,
});

describe('getAudioFormat', () => {
  it('reads a declared audio media type', () => {
    expect(getAudioFormat(link({ href: '/dl/1', type: 'audio/mpeg' }))).toBe('mp3');
    expect(getAudioFormat(link({ href: '/dl/1', type: 'audio/mp4' }))).toBe('m4b');
    expect(getAudioFormat(link({ href: '/dl/1', type: 'audio/flac' }))).toBe('flac');
    expect(getAudioFormat(link({ href: '/dl/1', type: 'audio/opus' }))).toBe('opus');
    // The container names the format; `codecs` is a hint for the decoder, not
    // a different file type.
    expect(getAudioFormat(link({ href: '/dl/1', type: 'audio/ogg; codecs=opus' }))).toBe('ogg');
  });

  it('falls back to the href extension', () => {
    expect(getAudioFormat(link({ href: '/files/Chapter 01.mp3' }))).toBe('mp3');
    expect(getAudioFormat(link({ href: '/files/book.m4b?x=1' }))).toBe('m4b');
  });

  // The shape BookOrbit 2.10.0 actually serves (captured 2026-09-18): a
  // generic media type, an extensionless href, and the format only in `title`.
  it('falls back to the link title when the server sends octet-stream', () => {
    expect(
      getAudioFormat(
        link({
          href: '/api/v1/opds/7/download?fileId=8',
          type: 'application/octet-stream',
          title: 'MP3',
        }),
      ),
    ).toBe('mp3');
    expect(
      getAudioFormat(
        link({
          href: '/api/v1/opds/6/download?fileId=6',
          type: 'application/octet-stream',
          title: 'M4B',
        }),
      ),
    ).toBe('m4b');
  });

  it('does not claim ebook or comic links', () => {
    expect(getAudioFormat(link({ href: '/dl/b.epub', type: 'application/epub+zip' }))).toBe('');
    expect(getAudioFormat(link({ href: '/dl/c.cbz', type: 'application/vnd.comicbook+zip' }))).toBe(
      '',
    );
    expect(getAudioFormat(link({ href: '/dl/d.pdf', type: 'application/pdf' }))).toBe('');
    expect(getAudioFormat(link({ href: '/api/v1/opds/1/download?fileId=1', title: 'CBZ' }))).toBe(
      '',
    );
  });
});

describe('isAudioLink', () => {
  it('is true only for audio acquisition links', () => {
    expect(isAudioLink(link({ href: '/dl/1', type: 'audio/mpeg' }))).toBe(true);
    expect(isAudioLink(link({ href: '/dl/b.epub', type: 'application/epub+zip' }))).toBe(false);
  });
});

describe('classifyAcquisitionLink with audio', () => {
  // Audio is played, never imported as a book, so it must not be offered as a
  // download candidate -- but it is also not a format we should condemn.
  it('does not report an audio link as importable', () => {
    expect(classifyAcquisitionLink(link({ href: '/dl/1', type: 'audio/mpeg' }))).not.toBe(
      'supported',
    );
  });
});
