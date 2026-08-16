import type { TOCItem } from '@/libs/document';
import type { AudiobookChapterMapping } from '@/types/book';

export interface AudiobookTextChapter {
  id: string;
  label: string;
  href: string;
  cfi?: string;
}

export interface AudiobookMappingAnchor {
  ebookChapterId: string;
  audioChapterId: string;
}

export const collectAudiobookTextChapters = (toc: TOCItem[]): AudiobookTextChapter[] => {
  const chapters: AudiobookTextChapter[] = [];
  const seenHrefs = new Set<string>();

  const visit = (items: TOCItem[]) => {
    for (const item of items) {
      const href = item.href.trim();
      if (href && !seenHrefs.has(href)) {
        seenHrefs.add(href);
        chapters.push({
          id: href,
          label: item.label.trim() || href,
          href,
          ...(item.cfi ? { cfi: item.cfi } : {}),
        });
      }
      if (item.subitems?.length) visit(item.subitems);
    }
  };

  visit(toc);
  return chapters;
};

/**
 * Continuum-style anchor mapping: pair the selected ebook/audio chapters,
 * then fill both directions by ordinal. Entries that fall outside either list
 * stay unmapped so the review UI can make the mismatch explicit.
 */
export const buildSequentialAudiobookMappings = (
  ebookChapterIds: string[],
  audioChapterIds: string[],
  anchor: AudiobookMappingAnchor,
): AudiobookChapterMapping[] => {
  const ebookAnchorIndex = ebookChapterIds.indexOf(anchor.ebookChapterId);
  const audioAnchorIndex = audioChapterIds.indexOf(anchor.audioChapterId);
  if (ebookAnchorIndex < 0 || audioAnchorIndex < 0) return [];

  const offset = ebookAnchorIndex - audioAnchorIndex;
  return audioChapterIds.flatMap((audioChapterId, audioIndex) => {
    const ebookChapterId = ebookChapterIds[audioIndex + offset];
    return ebookChapterId ? [{ ebookChapterId, audioChapterId }] : [];
  });
};
