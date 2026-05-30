import type { PromptLayer } from './types';
import type { ReadingContextSnapshot } from '../../tools/builtins/types';

/**
 * Shows the agent where the user is in the book. Expendable — under
 * extreme budget pressure the agent can still answer by calling
 * `getReadingContext` on demand instead of having it in every system
 * prompt — but very low shrinkPriority because losing it makes vague
 * questions ("what does this mean?") much worse.
 *
 * Shrink levels:
 *   0: chapter title + page + selection (if any)
 *   1: chapter title only
 *   2: drop (null)
 */
export function createReadingLayer(snapshot: ReadingContextSnapshot | null): PromptLayer {
  return {
    name: 'reading',
    renderPriority: 20,
    shrinkPriority: 20,
    expendable: true,
    render() {
      return renderFull(snapshot);
    },
    shrink(level) {
      if (!snapshot) return null;
      if (level <= 0) return renderFull(snapshot);
      if (level === 1) return renderTerse(snapshot);
      return null;
    },
  };
}

function renderFull(snapshot: ReadingContextSnapshot | null): string | null {
  if (!snapshot) return null;
  const lines: string[] = ['Reading context:'];
  if (snapshot.chapterTitle) {
    lines.push(`- Chapter: ${snapshot.chapterTitle} (section ${snapshot.sectionIndex})`);
  } else {
    lines.push(`- Section: ${snapshot.sectionIndex}`);
  }
  lines.push(`- Page: ${snapshot.pageNumber}`);
  if (snapshot.cfi) lines.push(`- CFI: ${snapshot.cfi}`);
  if (snapshot.selection) {
    lines.push(
      `- Active selection (${snapshot.selection.text.length} chars): "${truncate(snapshot.selection.text, 240)}"`,
    );
  }
  return lines.join('\n');
}

function renderTerse(snapshot: ReadingContextSnapshot): string {
  if (snapshot.chapterTitle) {
    return `Currently reading: ${snapshot.chapterTitle}.`;
  }
  return `Currently in section ${snapshot.sectionIndex}.`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
