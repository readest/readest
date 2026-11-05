import { describe, expect, test } from 'vitest';
import { grimmoryProgressBody, grimmoryRemoteProgress } from '@/services/grimmory/progress';

describe('grimmoryRemoteProgress', () => {
  test('reads an EPUB position as its CFI and a 0-1 percentage', () => {
    expect(
      grimmoryRemoteProgress(
        {
          id: 2,
          epubProgress: { cfi: 'epubcfi(/6/8!/4/2/10)', href: 'ch1.xhtml', percentage: 42.5 },
          lastReadTime: '2026-11-05T14:04:52.123Z',
        },
        false,
      ),
    ).toEqual({
      progress: 'epubcfi(/6/8!/4/2/10)',
      percentage: 0.425,
      timestamp: Date.parse('2026-11-05T14:04:52.123Z') / 1000,
      device: 'Grimmory',
    });
  });

  test('reads a PDF or comic position as its page number', () => {
    expect(
      grimmoryRemoteProgress({ id: 1, pdfProgress: { page: 27, percentage: 38.6 } }, true),
    ).toMatchObject({ progress: '27', percentage: 0.386 });
    expect(
      grimmoryRemoteProgress({ id: 1, cbxProgress: { page: 3, percentage: 10 } }, true),
    ).toMatchObject({ progress: '3', percentage: 0.1 });
  });

  test('is null for a book never read on the server', () => {
    expect(grimmoryRemoteProgress({ id: 2 }, false)).toBeNull();
    expect(grimmoryRemoteProgress({ id: 2, epubProgress: {} }, false)).toBeNull();
    expect(grimmoryRemoteProgress({ id: 1 }, true)).toBeNull();
  });

  test('ignores the other layout’s position', () => {
    expect(grimmoryRemoteProgress({ id: 1, pdfProgress: { page: 2, percentage: 5 } }, false)).toBe(
      null,
    );
  });
});

describe('grimmoryProgressBody', () => {
  test('sends the position on the matched file, as a 0-100 percentage', () => {
    expect(
      grimmoryProgressBody(
        { bookId: 2, bookFileId: 7, bookType: 'EPUB', isPrimary: false, statusPushedAt: 0 },
        'epubcfi(/6/8!/4/2/10)',
        0.425,
      ),
    ).toEqual({
      bookId: 2,
      fileProgress: {
        bookFileId: 7,
        positionData: 'epubcfi(/6/8!/4/2/10)',
        progressPercent: 42.5,
      },
    });
  });
});
