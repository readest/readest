import { describe, expect, it } from 'vitest';
import type { OPDSAcquisitionLink } from '@/types/opds';
import { REL } from '@/types/opds';
import {
  classifyAcquisitionLink,
  getFormatExt,
  getFormatName,
  getFormatTier,
} from '@/services/opds/formats';

const link = (partial: Partial<OPDSAcquisitionLink> & { href: string }): OPDSAcquisitionLink => ({
  rel: REL.ACQ,
  ...partial,
});

describe('classifyAcquisitionLink', () => {
  describe('supported', () => {
    // Real shape served by a Calibre content server: lowercase format token in
    // the path, plus a genuine media type (verified 2026-08-09).
    it('accepts a Calibre EPUB link', () => {
      expect(
        classifyAcquisitionLink(
          link({ href: '/get/epub/56/Calibre_Library', type: 'application/epub+zip' }),
        ),
      ).toBe('supported');
    });

    it('accepts every format Readest can import', () => {
      const hrefs = [
        '/dl/book.epub',
        '/dl/book.mobi',
        '/dl/book.azw3',
        '/dl/book.cbz',
        '/dl/book.fb2',
        '/dl/book.pdf',
        '/dl/book.txt',
        '/dl/book.md',
      ];
      for (const href of hrefs) {
        expect(classifyAcquisitionLink(link({ href }))).toBe('supported');
      }
    });

    // Feeds that serve a real EPUB but label it octet-stream must not lose
    // their only download.
    it('recovers a supported format from the href when the type is octet-stream', () => {
      expect(
        classifyAcquisitionLink(link({ href: '/dl/book.epub', type: 'application/octet-stream' })),
      ).toBe('supported');
    });

    // The download handler opens text/html in a browser rather than importing
    // it, so it stays a valid path.
    it('keeps text/html as the open-in-browser escape hatch', () => {
      expect(classifyAcquisitionLink(link({ href: '/landing', type: 'text/html' }))).toBe(
        'supported',
      );
    });

    // Standard Ebooks serves *.kepub.epub as application/kepub+zip. The file is
    // a valid EPUB, so the href extension wins over the unrecognised mime.
    it('accepts a Kobo kepub whose href still ends in .epub', () => {
      expect(
        classifyAcquisitionLink(
          link({ href: '/ebooks/x/downloads/y.kepub.epub', type: 'application/kepub+zip' }),
        ),
      ).toBe('supported');
    });
  });

  describe('unsupported', () => {
    // The whole point of issue #5583. Calibre has no mime for KFX, so the
    // lowercase path token is the only signal available.
    it('rejects a Calibre KFX link identified only by its path token', () => {
      expect(classifyAcquisitionLink(link({ href: '/get/kfx/56/Calibre_Library' }))).toBe(
        'unsupported',
      );
    });

    it('rejects Calibre-Web style /opds/download/<id>/<format>/ hrefs', () => {
      expect(classifyAcquisitionLink(link({ href: '/opds/download/123/lit/' }))).toBe(
        'unsupported',
      );
    });

    // Standard Ebooks: no extension in the href and "XHTML" is not a file
    // extension, so only the mime arm catches this one.
    it('rejects the Standard Ebooks XHTML link by media type', () => {
      expect(
        classifyAcquisitionLink(
          link({
            href: '/ebooks/author/title/text/single-page',
            type: 'application/xhtml+xml',
            title: 'XHTML',
          }),
        ),
      ).toBe('unsupported');
    });

    it('rejects an Adobe ACSM fulfillment link', () => {
      expect(
        classifyAcquisitionLink(
          link({ href: '/fulfill/123', type: 'application/vnd.adobe.adept+xml' }),
        ),
      ).toBe('unsupported');
    });

    it('rejects an incompatible format named only in the link title', () => {
      expect(classifyAcquisitionLink(link({ href: '/download/9912', title: 'DjVu' }))).toBe(
        'unsupported',
      );
    });

    it('rejects incompatible formats by href extension', () => {
      for (const href of ['/dl/book.rtf', '/dl/book.docx', '/dl/book.lrf', '/dl/book.prc']) {
        expect(classifyAcquisitionLink(link({ href }))).toBe('unsupported');
      }
    });
  });

  describe('unknown', () => {
    // Dropping a link needs a positively named incompatible format. A script
    // extension is not one -- this may well serve an EPUB.
    it('keeps a script-extension href', () => {
      expect(classifyAcquisitionLink(link({ href: '/download/book.php?id=1' }))).toBe('unknown');
    });

    it('keeps an extensionless href with no type', () => {
      expect(classifyAcquisitionLink(link({ href: '/download/1' }))).toBe('unknown');
    });

    // "prc" appears inside the word, not as a token -- must not match.
    it('does not match an incompatible token embedded in a longer word', () => {
      expect(classifyAcquisitionLink(link({ href: '/library/sprocket/1' }))).toBe('unknown');
    });
  });
});

describe('getFormatExt', () => {
  it('names the format for a button label', () => {
    expect(getFormatExt(link({ href: '/get/epub/1/lib', type: 'application/epub+zip' }))).toBe(
      'epub',
    );
    expect(getFormatExt(link({ href: '/dl/book.pdf' }))).toBe('pdf');
    expect(getFormatExt(link({ href: '/download/1' }))).toBe('');
  });
});

describe('getFormatName', () => {
  // A menu listing incompatible formats has to tell them apart; getFormatExt
  // returns '' for those, which would render every entry identically.
  it('names formats Readest cannot import', () => {
    expect(getFormatName(link({ href: '/get/kfx/1/lib' }))).toBe('kfx');
    expect(getFormatName(link({ href: '/get/lit/1/lib' }))).toBe('lit');
    expect(getFormatName(link({ href: '/dl/book.rtf' }))).toBe('rtf');
  });

  it('still prefers the importable name when there is one', () => {
    expect(getFormatName(link({ href: '/get/epub/1/lib', type: 'application/epub+zip' }))).toBe(
      'epub',
    );
  });

  it('returns empty when nothing names the format', () => {
    expect(getFormatName(link({ href: '/download/1' }))).toBe('');
  });
});

describe('getFormatTier', () => {
  it('ranks advanced EPUB above plain EPUB above MOBI above PDF', () => {
    const advanced = getFormatTier(
      link({ href: '/dl/book.epub', type: 'application/epub+zip', title: 'Advanced epub' }),
    );
    const plain = getFormatTier(link({ href: '/dl/book.epub', type: 'application/epub+zip' }));
    const mobi = getFormatTier(
      link({ href: '/dl/book.mobi', type: 'application/x-mobipocket-ebook' }),
    );
    const pdf = getFormatTier(link({ href: '/dl/book.pdf', type: 'application/pdf' }));

    expect(advanced).toBeLessThan(plain);
    expect(plain).toBeLessThan(mobi);
    expect(mobi).toBeLessThan(pdf);
  });
});
