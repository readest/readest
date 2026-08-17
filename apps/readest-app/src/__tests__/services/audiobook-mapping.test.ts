import { describe, expect, it } from 'vitest';

import type { TOCItem } from '@/libs/document';
import {
  buildSequentialAudiobookMappings,
  collectAudiobookTextChapters,
} from '@/services/audiobook/mapping';

describe('collectAudiobookTextChapters', () => {
  it('flattens nested TOC entries in reading order and drops duplicate hrefs', () => {
    const toc: TOCItem[] = [
      {
        id: 0,
        label: 'Part One',
        href: 'part-1.xhtml',
        index: 0,
        subitems: [
          { id: 1, label: 'Chapter 1', href: 'chapter-1.xhtml', index: 0 },
          { id: 2, label: 'Chapter 2', href: 'chapter-2.xhtml', index: 0 },
        ],
      },
      { id: 3, label: 'Chapter 2 again', href: 'chapter-2.xhtml', index: 0 },
      { id: 4, label: 'Chapter 3', href: 'chapter-3.xhtml#start', index: 0 },
    ];

    expect(collectAudiobookTextChapters(toc)).toEqual([
      { id: 'part-1.xhtml', label: 'Part One', href: 'part-1.xhtml' },
      { id: 'chapter-1.xhtml', label: 'Chapter 1', href: 'chapter-1.xhtml' },
      { id: 'chapter-2.xhtml', label: 'Chapter 2', href: 'chapter-2.xhtml' },
      {
        id: 'chapter-3.xhtml#start',
        label: 'Chapter 3',
        href: 'chapter-3.xhtml#start',
      },
    ]);
  });
});

describe('buildSequentialAudiobookMappings', () => {
  const ebookChapterIds = ['cover', 'introduction', 'chapter-1', 'chapter-2'];
  const audioChapterIds = ['track-1', 'track-2', 'track-3'];

  it('maps forward and backward from the selected anchor pair', () => {
    expect(
      buildSequentialAudiobookMappings(ebookChapterIds, audioChapterIds, {
        ebookChapterId: 'introduction',
        audioChapterId: 'track-1',
      }),
    ).toEqual([
      { ebookChapterId: 'introduction', audioChapterId: 'track-1' },
      { ebookChapterId: 'chapter-1', audioChapterId: 'track-2' },
      { ebookChapterId: 'chapter-2', audioChapterId: 'track-3' },
    ]);
  });

  it('leaves audio before the anchor and ebook chapters after the available audio unmapped', () => {
    expect(
      buildSequentialAudiobookMappings(ebookChapterIds, audioChapterIds, {
        ebookChapterId: 'cover',
        audioChapterId: 'track-2',
      }),
    ).toEqual([
      { ebookChapterId: 'cover', audioChapterId: 'track-2' },
      { ebookChapterId: 'introduction', audioChapterId: 'track-3' },
    ]);
  });

  it('returns no mappings when either anchor no longer exists', () => {
    expect(
      buildSequentialAudiobookMappings(ebookChapterIds, audioChapterIds, {
        ebookChapterId: 'missing',
        audioChapterId: 'track-1',
      }),
    ).toEqual([]);
  });
});
