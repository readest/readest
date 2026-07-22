// Map a book's table of contents onto downloadable chapters for the podcast
// player sheet. Downloads work per section index; the TOC is href-based and
// often nested, so this derives, in reading order, one chapter per distinct
// section a TOC entry points at, each spanning to the next chapter's section
// (so TOC-less continuation sections fold into the preceding chapter). Books
// without a usable TOC fall back to one row per section.

import type { TOCItem } from '@/libs/document';

export interface DownloadChapter {
  key: string;
  label: string;
  depth: number;
  startSection: number;
  // Exclusive: the sections this chapter downloads are [startSection, endSection).
  endSection: number;
}

export type ChapterDownloadStatus = 'none' | 'partial' | 'complete';

export interface SectionCacheStatus {
  total: number;
  recorded: number;
  packed: boolean;
}

const flatten = (
  items: TOCItem[],
  depth: number,
  out: { label: string; href: string; depth: number }[],
): void => {
  for (const item of items) {
    out.push({ label: item.label, href: item.href, depth });
    if (item.subitems?.length) flatten(item.subitems, depth + 1, out);
  }
};

export const deriveDownloadChapters = (
  toc: TOCItem[],
  resolveSection: (href: string) => number | null,
  sectionCount: number,
  // User-facing label for TOC-less sections; the component injects i18n.
  sectionLabel: (oneBasedIndex: number) => string = (n) => `Section ${n}`,
): DownloadChapter[] => {
  const flat: { label: string; href: string; depth: number }[] = [];
  flatten(toc ?? [], 0, flat);

  // Resolve each entry to a section, keeping the first label seen for each
  // distinct section in reading order.
  const seen = new Set<number>();
  const anchors: { key: string; label: string; depth: number; startSection: number }[] = [];
  for (const entry of flat) {
    const section = resolveSection(entry.href);
    if (section === null || section < 0 || section >= sectionCount) continue;
    if (seen.has(section)) continue;
    seen.add(section);
    anchors.push({
      key: entry.href,
      label: entry.label,
      depth: entry.depth,
      startSection: section,
    });
  }

  if (!anchors.length) {
    return Array.from({ length: sectionCount }, (_, i) => ({
      key: `section-${i}`,
      label: sectionLabel(i + 1),
      depth: 0,
      startSection: i,
      endSection: i + 1,
    }));
  }

  // Anchors are in reading order but keep them sorted defensively, then span
  // each to the next anchor's section (last spans to the end of the book).
  anchors.sort((a, b) => a.startSection - b.startSection);
  return anchors.map((anchor, i) => ({
    key: anchor.key,
    label: anchor.label,
    depth: anchor.depth,
    startSection: anchor.startSection,
    endSection: i + 1 < anchors.length ? anchors[i + 1]!.startSection : sectionCount,
  }));
};

export const chapterDownloadStatus = (
  chapter: DownloadChapter,
  statuses: Map<number, SectionCacheStatus>,
): ChapterDownloadStatus => {
  let allPacked = true;
  let anyRecorded = false;
  for (let section = chapter.startSection; section < chapter.endSection; section++) {
    const status = statuses.get(section);
    if (!status?.packed) allPacked = false;
    if (status && (status.packed || status.recorded > 0)) anyRecorded = true;
  }
  if (allPacked) return 'complete';
  return anyRecorded ? 'partial' : 'none';
};

export const chapterSections = (chapter: DownloadChapter): number[] =>
  Array.from(
    { length: chapter.endSection - chapter.startSection },
    (_, i) => chapter.startSection + i,
  );
