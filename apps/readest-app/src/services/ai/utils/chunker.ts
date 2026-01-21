import { TextChunk } from '../types';

// same formula as toc.ts - 1500 chars = 1 page
export const SIZE_PER_PAGE = 1500;

interface ChunkingOptions {
  maxChunkSize: number;
  overlapSize: number;
  minChunkSize: number;
}

const DEFAULT_OPTIONS: ChunkingOptions = {
  maxChunkSize: 500,
  overlapSize: 50,
  minChunkSize: 100,
};

export function extractTextFromDocument(doc: Document): string {
  const body = doc.body || doc.documentElement;
  if (!body) return '';
  const clone = body.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll('script, style, noscript, nav, header, footer')
    .forEach((el) => el.remove());
  return clone.textContent?.trim() || '';
}

function findBreakPoint(text: string, targetPos: number, searchRange = 50): number {
  const start = Math.max(0, targetPos - searchRange);
  const end = Math.min(text.length, targetPos + searchRange);
  const searchText = text.slice(start, end);

  const paragraphBreak = searchText.lastIndexOf('\n\n');
  if (paragraphBreak !== -1 && paragraphBreak > searchRange / 2) return start + paragraphBreak + 2;

  const sentenceBreak = searchText.lastIndexOf('. ');
  if (sentenceBreak !== -1 && sentenceBreak > searchRange / 2) return start + sentenceBreak + 2;

  const wordBreak = searchText.lastIndexOf(' ');
  if (wordBreak !== -1) return start + wordBreak + 1;

  return targetPos;
}

export function chunkSection(
  doc: Document,
  sectionIndex: number,
  chapterTitle: string,
  bookHash: string,
  cumulativeSizeBeforeSection: number, // total chars in all sections before this one
  options?: Partial<ChunkingOptions>,
): TextChunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const text = extractTextFromDocument(doc);

  if (!text || text.length < opts.minChunkSize) {
    return text
      ? [
          {
            id: `${bookHash}-${sectionIndex}-0`,
            bookHash,
            sectionIndex,
            chapterTitle,
            text: text.trim(),
            pageNumber: Math.floor(cumulativeSizeBeforeSection / SIZE_PER_PAGE),
          },
        ]
      : [];
  }

  const chunks: TextChunk[] = [];
  let position = 0;
  let chunkIndex = 0;

  while (position < text.length) {
    let chunkEnd = position + opts.maxChunkSize;

    if (chunkEnd >= text.length) {
      const remaining = text.slice(position).trim();
      if (remaining.length >= opts.minChunkSize) {
        chunks.push({
          id: `${bookHash}-${sectionIndex}-${chunkIndex}`,
          bookHash,
          sectionIndex,
          chapterTitle,
          text: remaining,
          pageNumber: Math.floor((cumulativeSizeBeforeSection + position) / SIZE_PER_PAGE),
        });
      } else if (chunks.length > 0) {
        chunks[chunks.length - 1]!.text += ' ' + remaining;
      }
      break;
    }

    chunkEnd = findBreakPoint(text, chunkEnd);
    const chunkText = text.slice(position, chunkEnd).trim();

    if (chunkText.length >= opts.minChunkSize) {
      chunks.push({
        id: `${bookHash}-${sectionIndex}-${chunkIndex}`,
        bookHash,
        sectionIndex,
        chapterTitle,
        text: chunkText,
        pageNumber: Math.floor((cumulativeSizeBeforeSection + position) / SIZE_PER_PAGE),
      });
      chunkIndex++;
    }

    position = chunkEnd - opts.overlapSize;
  }

  return chunks;
}
