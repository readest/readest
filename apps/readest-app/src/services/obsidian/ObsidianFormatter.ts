import type { Book, BookNote } from '@/types/book';
import { buildAnnotationAppUrl } from '@/utils/deeplink';
import type { ObsidianFormatOptions } from './types';

export const OBSIDIAN_HIGHLIGHTS_START = '<!-- readest-sync-highlights-start -->';
export const OBSIDIAN_HIGHLIGHTS_END = '<!-- readest-sync-highlights-end -->';
export const OBSIDIAN_USER_NOTES_HEADER = '## 📝 My Personal Notes & Reflections';

export class ObsidianFormatter {
  /**
   * Generates a complete Markdown note for a book and its annotations.
   * If existingContent is provided and preserveUserNotes is true, it performs
   * a non-destructive merge preserving user reflections and custom YAML fields.
   */
  public static format(
    book: Book,
    notes: BookNote[],
    options: ObsidianFormatOptions = {},
    existingContent?: string,
    chapterResolver?: (note: BookNote) => string | null,
  ): string {
    const { resolvedBook, resolvedCoverPath } = this.resolveBookState(
      book,
      options.coverRelativePath,
      existingContent,
    );

    const frontmatter = this.generateFrontmatter(
      resolvedBook,
      notes.length,
      options,
      existingContent,
    );
    const highlightsBody = this.generateHighlightsBody(
      resolvedBook,
      notes,
      options,
      chapterResolver,
    );

    if (existingContent && options.preserveUserNotes !== false) {
      return this.mergeWithExistingContent(
        frontmatter,
        highlightsBody,
        existingContent,
        resolvedBook,
        options,
        resolvedCoverPath,
      );
    }

    const overview = this.generateOverviewSection(resolvedBook, notes.length, resolvedCoverPath);
    const personalNotes = this.generatePersonalNotesSection();

    return [
      frontmatter,
      '',
      overview,
      '',
      personalNotes,
      '',
      OBSIDIAN_HIGHLIGHTS_START,
      highlightsBody,
      OBSIDIAN_HIGHLIGHTS_END,
      '',
    ].join('\n');
  }

  /**
   * Resolves book status, progress, and cover path against existing note content.
   * Prevents stale syncs from resetting books that have already been marked finished or read further.
   */
  public static resolveBookState(
    book: Book,
    coverPath?: string,
    existingContent?: string,
  ): { resolvedBook: Book; resolvedCoverPath?: string } {
    const resolvedBook: Book = { ...book };
    let resolvedCoverPath = coverPath;

    if (!existingContent) {
      return { resolvedBook, resolvedCoverPath };
    }

    // Preserve existing embedded cover image if coverPath was omitted
    if (!resolvedCoverPath) {
      const wikilinkMatch = existingContent.match(
        /!\[\[([^|\]]+\.(?:png|jpg|jpeg|webp))(?:\s*\|\s*\d+)?\]\]/i,
      );
      const mdLinkMatch = existingContent.match(/!\[[^\]]*\]\(([^)]+\.(?:png|jpg|jpeg|webp))\)/i);
      if (wikilinkMatch && wikilinkMatch[1]) {
        resolvedCoverPath = wikilinkMatch[1].trim();
      } else if (mdLinkMatch && mdLinkMatch[1]) {
        resolvedCoverPath = mdLinkMatch[1].trim();
      }
    }

    // Parse existing readingStatus and progress from frontmatter
    let existingStatus: string | undefined;
    let existingProgressPercent: number | undefined;

    if (existingContent.startsWith('---')) {
      const secondDash = existingContent.indexOf('\n---', 3);
      if (secondDash !== -1) {
        const rawFm = existingContent.substring(3, secondDash).split('\n');
        for (const line of rawFm) {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0 && !line.trim().startsWith('-')) {
            const key = line.substring(0, colonIdx).trim().toLowerCase();
            const val = line
              .substring(colonIdx + 1)
              .trim()
              .replace(/^["']|["']$/g, '');
            if (key === 'readingstatus') {
              existingStatus = val.toLowerCase();
            } else if (key === 'progress') {
              const num = parseInt(val.replace('%', ''), 10);
              if (!Number.isNaN(num)) existingProgressPercent = num;
            }
          }
        }
      }
    }

    // Rule: Never downgrade a book that is finished in Obsidian
    if (existingStatus === 'finished') {
      if (resolvedBook.readingStatus !== 'finished') {
        resolvedBook.readingStatus = 'finished';
        if (resolvedBook.progress && resolvedBook.progress[1]) {
          resolvedBook.progress = [resolvedBook.progress[1], resolvedBook.progress[1]];
        }
      }
    } else if (existingProgressPercent !== undefined) {
      const currentPercent = this.calculateProgressPercent(resolvedBook.progress);
      if (currentPercent === undefined || currentPercent < existingProgressPercent) {
        if (existingProgressPercent >= 99) {
          resolvedBook.readingStatus = 'finished';
        } else if (existingProgressPercent > 0 && resolvedBook.readingStatus === 'unread') {
          resolvedBook.readingStatus = 'reading';
        }
      }
    }

    return { resolvedBook, resolvedCoverPath };
  }

  /**
   * Generates YAML frontmatter, preserving any custom user-added fields from existing content.
   */
  public static generateFrontmatter(
    book: Book,
    notesCount: number,
    options: ObsidianFormatOptions = {},
    existingContent?: string,
  ): string {
    const syncDate = this.formatDate(Date.now());
    const status = book.readingStatus || 'unread';
    const statusTag = options.statusTagMapping?.[status] || `reading/${status}`;

    // Managed frontmatter keys - MUST NEVER be overwritten or stored in customFields
    const managed = [
      'title',
      'author',
      'format',
      'readingstatus',
      'progress',
      'totalhighlights',
      'lastsynced',
      'bookhash',
      'tags',
    ];

    // Extract custom frontmatter fields from existing note if present
    const customFields: Record<string, string> = {};
    if (existingContent && existingContent.startsWith('---')) {
      const secondDash = existingContent.indexOf('\n---', 3);
      if (secondDash !== -1) {
        const rawFm = existingContent.substring(3, secondDash).split('\n');
        for (const line of rawFm) {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0 && !line.trim().startsWith('-')) {
            const key = line.substring(0, colonIdx).trim();
            const val = line.substring(colonIdx + 1).trim();
            if (!managed.includes(key.toLowerCase()) && key.length > 0 && val.length > 0) {
              customFields[key] = val;
            }
          }
        }
      }
    }

    const lines: string[] = ['---'];
    lines.push(`title: "${this.escapeYaml(book.title || 'Untitled')}"`);
    lines.push(`author: "${this.escapeYaml(book.author || 'Unknown Author')}"`);
    lines.push(`format: ${(book.format || 'EPUB').toUpperCase()}`);
    lines.push(`readingStatus: ${status}`);

    const percent = this.calculateProgressPercent(book.progress);
    if (percent !== undefined) {
      lines.push(`progress: "${percent}%"`);
    }

    lines.push(`totalHighlights: ${notesCount}`);
    lines.push(`lastSynced: "${syncDate}"`);
    lines.push(`bookHash: "${book.hash}"`);

    // Tags list
    const tagsSet = new Set<string>();
    tagsSet.add('readest');
    tagsSet.add(statusTag);
    if (Array.isArray(book.tags)) {
      for (const t of book.tags) {
        if (t) {
          const sanitized = t
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\p{L}\p{N}_\-/]/gu, '');
          if (sanitized) tagsSet.add(sanitized);
        }
      }
    }

    lines.push('tags:');
    for (const t of tagsSet) {
      lines.push(`  - ${t}`);
    }

    // Re-insert custom user frontmatter fields
    for (const [k, v] of Object.entries(customFields)) {
      lines.push(`${k}: ${v}`);
    }

    lines.push('---');
    return lines.join('\n');
  }

  /**
   * Generates the Book Overview section with title, author, cover, and Book Details callout.
   */
  public static generateOverviewSection(
    book: Book,
    notesCount: number,
    coverPath?: string,
  ): string {
    const lines: string[] = [];
    const cleanTitle = (book.title || 'Untitled Book').replace(/\r?\n/g, ' ');
    const cleanAuthor = (book.author || 'Unknown Author').replace(/\r?\n/g, ' ');
    lines.push(`# ${cleanTitle}`);
    lines.push(`**Author**: [[${cleanAuthor}]]`);

    if (coverPath) {
      lines.push('');
      // Use Obsidian native wikilink embed syntax to support spaces and characters cleanly
      lines.push(`![[${coverPath}|180]]`);
    }

    lines.push('');
    lines.push('> [!info]+ Book Details');
    lines.push(`> - **Format**: ${(book.format || 'EPUB').toUpperCase()}`);
    lines.push(`> - **Status**: \`${(book.readingStatus || 'unread').toUpperCase()}\``);

    if (Array.isArray(book.progress) && book.progress.length >= 2) {
      const [curr, total] = book.progress;
      const { bar, percent } = this.generateProgressBar(curr, total);
      lines.push(`> - **Progress**: ${percent}% \`${bar}\` *(Page ${curr} of ${total})*`);
    } else if (book.readingStatus === 'finished') {
      const { bar, percent } = this.generateProgressBar(100, 100);
      lines.push(`> - **Progress**: ${percent}% \`${bar}\``);
    }

    if (book.groupName) {
      lines.push(`> - **Collection / Shelf**: ${book.groupName}`);
    }

    lines.push(`> - **Highlights & Notes**: ${notesCount}`);

    if (book.metadata?.description) {
      lines.push('>');
      lines.push(`> **Description**: ${book.metadata.description.replace(/\n+/g, ' ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Generates the placeholder section for personal notes, preserved across syncs.
   */
  public static generatePersonalNotesSection(): string {
    return [
      OBSIDIAN_USER_NOTES_HEADER,
      '',
      '> [!tip] User Note Area',
      '> Feel free to write your personal summary, takeaways, or review below.',
      '> *Readest will never overwrite or erase your notes written in this section!*',
      '',
      '*Your thoughts here...*',
      '',
      '---',
    ].join('\n');
  }

  /**
   * Generates the Highlights & Annotations section.
   */
  public static generateHighlightsBody(
    book: Book,
    notes: BookNote[],
    options: ObsidianFormatOptions = {},
    chapterResolver?: (note: BookNote) => string | null,
  ): string {
    const lines: string[] = [];
    lines.push('## 📚 Highlights & Annotations');
    lines.push('');

    // Filter out deleted notes
    const activeNotes = notes.filter((n) => !n.deletedAt);

    if (activeNotes.length === 0) {
      lines.push('*No highlights or annotations recorded in Readest yet.*');
      return lines.join('\n');
    }

    const groupBy = options.groupHighlightsBy || 'chapter';

    if (groupBy === 'chapter') {
      const grouped = new Map<string, BookNote[]>();
      for (const note of activeNotes) {
        const chapter = chapterResolver?.(note) || 'General / Uncategorized';
        if (!grouped.has(chapter)) grouped.set(chapter, []);
        grouped.get(chapter)!.push(note);
      }

      for (const [chapter, chapterNotes] of grouped.entries()) {
        lines.push(`### 📖 ${chapter}`);
        lines.push('');
        for (const note of chapterNotes) {
          lines.push(this.formatSingleNote(book, note, options, chapter));
          lines.push('');
        }
      }
    } else if (groupBy === 'date') {
      const grouped = new Map<string, BookNote[]>();
      for (const note of activeNotes) {
        const dateKey = this.formatDate(note.updatedAt || note.createdAt, 'YYYY-MM-DD');
        if (!grouped.has(dateKey)) grouped.set(dateKey, []);
        grouped.get(dateKey)!.push(note);
      }

      for (const [date, dateNotes] of grouped.entries()) {
        lines.push(`### 📅 ${date}`);
        lines.push('');
        for (const note of dateNotes) {
          const chapter = chapterResolver?.(note) || undefined;
          lines.push(this.formatSingleNote(book, note, options, chapter));
          lines.push('');
        }
      }
    } else {
      // Linear
      for (const note of activeNotes) {
        const chapter = chapterResolver?.(note) || undefined;
        lines.push(this.formatSingleNote(book, note, options, chapter));
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Formats a single highlight according to user preferences (callout, blockquote, bullet).
   */
  public static formatSingleNote(
    book: Book,
    note: BookNote,
    options: ObsidianFormatOptions = {},
    chapterTitle?: string,
  ): string {
    const style = options.highlightStyle || 'callout';
    const colorTag =
      options.colorTags !== false && note.color ? `#highlight/${note.color.toLowerCase()}` : '';
    const dateStr = this.formatDate(note.updatedAt || note.createdAt, options.dateFormat);
    const locationStr = note.page ? `Page ${note.page}` : note.cfi ? 'CFI Anchor' : '';

    // Canonical deep link back to Readest
    const appUrl = buildAnnotationAppUrl({
      bookHash: book.hash,
      noteId: note.id,
      cfi: note.cfi,
    });

    const metaParts: string[] = [];
    if (locationStr) {
      if (options.includeDeepLinks !== false) {
        metaParts.push(`[${locationStr}](${appUrl})`);
      } else {
        metaParts.push(locationStr);
      }
    }
    if (dateStr) metaParts.push(dateStr);
    if (colorTag) metaParts.push(colorTag);

    const metaLine = metaParts.length > 0 ? `*${metaParts.join(' • ')}*` : '';

    if (style === 'callout') {
      const calloutColor =
        options.colorCallouts !== false && note.color ? `|${note.color.toLowerCase()}` : '';
      const calloutType = options.calloutType || 'quote';
      const headerTitle = chapterTitle ? ` ${chapterTitle}` : '';
      const lines: string[] = [`> [!${calloutType}${calloutColor}]${headerTitle}`];

      if (note.text) {
        for (const ql of note.text.trim().split('\n')) {
          lines.push(`> ${ql}`);
        }
      }

      if (note.note) {
        lines.push('>');
        lines.push(`> 💬 **Note**: ${note.note}`);
      }

      if (metaLine) {
        lines.push('>');
        lines.push(`> ${metaLine}`);
      }

      return lines.join('\n');
    }

    if (style === 'blockquote') {
      const lines: string[] = [];
      if (note.text) {
        for (const ql of note.text.trim().split('\n')) {
          lines.push(`> ${ql}`);
        }
      }

      if (note.note) {
        lines.push('');
        lines.push(`💬 **Note**: ${note.note}`);
      }

      if (metaLine) {
        lines.push('');
        lines.push(metaLine);
      }

      return lines.join('\n');
    }

    // Bullet style
    const lines: string[] = [];
    lines.push(`- **Highlight**: "${(note.text || '').replace(/"/g, '\\"')}"`);
    if (note.note) {
      lines.push(`  - 💬 **Note**: ${note.note}`);
    }
    if (metaLine) {
      lines.push(`  - ${metaLine}`);
    }
    return lines.join('\n');
  }

  /**
   * Intelligently merges new frontmatter and highlights into an existing user note,
   * updating the Overview section while strictly preserving any text or user reflections.
   */
  public static mergeWithExistingContent(
    newFrontmatter: string,
    newHighlightsBody: string,
    existingContent: string,
    book: Book,
    _options: ObsidianFormatOptions = {},
    coverPath?: string,
  ): string {
    let existingBody = existingContent;
    if (existingContent.startsWith('---')) {
      const secondDash = existingContent.indexOf('\n---', 3);
      if (secondDash !== -1) {
        existingBody = existingContent.substring(secondDash + 4).trimStart();
      }
    }

    const startIdx = existingBody.indexOf(OBSIDIAN_HIGHLIGHTS_START);
    const endIdx = existingBody.indexOf(OBSIDIAN_HIGHLIGHTS_END);

    // Regenerate Overview section with latest metadata & cover
    const newOverview = this.generateOverviewSection(book, 0, coverPath);

    if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
      const beforeHighlights = existingBody.substring(0, startIdx);
      const afterHighlights = existingBody.substring(endIdx + OBSIDIAN_HIGHLIGHTS_END.length);

      // Extract user personal notes between Overview and Highlights
      let userNotesSection = '';
      const notesMarkerIdx = beforeHighlights.indexOf(OBSIDIAN_USER_NOTES_HEADER);

      if (notesMarkerIdx !== -1) {
        userNotesSection = beforeHighlights.substring(notesMarkerIdx).trim();
      } else {
        const headerMatch = beforeHighlights.match(/\n##\s+/);
        if (headerMatch && headerMatch.index !== undefined) {
          userNotesSection = beforeHighlights.substring(headerMatch.index + 1).trim();
        } else {
          userNotesSection = this.generatePersonalNotesSection();
        }
      }

      return [
        newFrontmatter,
        '',
        newOverview,
        '',
        userNotesSection,
        '',
        OBSIDIAN_HIGHLIGHTS_START,
        newHighlightsBody,
        OBSIDIAN_HIGHLIGHTS_END,
        afterHighlights.trim() ? `\n${afterHighlights.trim()}` : '',
      ].join('\n');
    }

    return [
      newFrontmatter,
      '',
      newOverview,
      '',
      this.generatePersonalNotesSection(),
      '',
      OBSIDIAN_HIGHLIGHTS_START,
      newHighlightsBody,
      OBSIDIAN_HIGHLIGHTS_END,
      '',
    ].join('\n');
  }

  // --- Helper Methods ---

  public static calculateProgressPercent(progress?: [number, number] | null): number | undefined {
    if (!Array.isArray(progress) || progress.length < 2) return undefined;
    const [curr, total] = progress;
    if (total <= 0) return 0;
    return Math.min(100, Math.round((curr / total) * 100));
  }

  public static generateProgressBar(
    current: number,
    total: number,
    length = 16,
  ): { bar: string; percent: number } {
    const len = Math.max(1, Math.min(100, length));
    if (total <= 0) return { bar: '░'.repeat(len), percent: 0 };
    const ratio = Math.max(0, Math.min(1, current / total));
    const percent = Math.round(ratio * 100);
    const filled = Math.max(0, Math.min(len, Math.round(ratio * len)));
    const empty = Math.max(0, len - filled);
    return { bar: '█'.repeat(filled) + '░'.repeat(empty), percent };
  }

  public static formatDate(timestamp?: number, format = 'YYYY-MM-DD HH:mm'): string {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return '';
    const YYYY = d.getFullYear().toString();
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const DD = String(d.getDate()).padStart(2, '0');
    const HH = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return format
      .replace(/YYYY/g, YYYY)
      .replace(/MM/g, MM)
      .replace(/DD/g, DD)
      .replace(/HH/g, HH)
      .replace(/mm/g, mm)
      .replace(/ss/g, ss);
  }

  private static escapeYaml(str: string): string {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
  }
}
