import { describe, expect, it } from 'vitest';
import {
  OBSIDIAN_HIGHLIGHTS_END,
  OBSIDIAN_HIGHLIGHTS_START,
  OBSIDIAN_USER_NOTES_HEADER,
  ObsidianFormatter,
} from '@/services/obsidian';
import type { Book, BookNote } from '@/types/book';

describe('ObsidianFormatter', () => {
  const mockBook: Book = {
    hash: 'abc123hash',
    title: 'Atomic Habits',
    author: 'James Clear',
    format: 'epub',
    readingStatus: 'reading',
    progress: [50, 100],
    tags: ['self-improvement', 'psychology'],
  } as unknown as Book;

  const mockNotes: BookNote[] = [
    {
      id: 'note-1',
      bookHash: 'abc123hash',
      text: 'You do not rise to the level of your goals.',
      note: 'Key insight about habits',
      color: 'yellow',
      page: 42,
      cfi: '/6/4[chapter1]!/4/2/10',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    } as unknown as BookNote,
    {
      id: 'note-2',
      bookHash: 'abc123hash',
      text: 'You fall to the level of your systems.',
      color: 'blue',
      page: 43,
      createdAt: 1700000100000,
      updatedAt: 1700000100000,
    } as unknown as BookNote,
  ];

  describe('generateFrontmatter', () => {
    it('generates standard YAML frontmatter with correct metadata and tags', () => {
      const frontmatter = ObsidianFormatter.generateFrontmatter(mockBook, 2);

      expect(frontmatter).toContain('---');
      expect(frontmatter).toContain('title: "Atomic Habits"');
      expect(frontmatter).toContain('author: "James Clear"');
      expect(frontmatter).toContain('format: EPUB');
      expect(frontmatter).toContain('readingStatus: reading');
      expect(frontmatter).toContain('progress: "50%"');
      expect(frontmatter).toContain('totalHighlights: 2');
      expect(frontmatter).toContain('bookHash: "abc123hash"');
      expect(frontmatter).toContain('  - readest');
      expect(frontmatter).toContain('  - reading/reading');
      expect(frontmatter).toContain('  - self-improvement');
      expect(frontmatter).toContain('  - psychology');
    });

    it('preserves custom frontmatter fields from existing content', () => {
      const existing = [
        '---',
        'title: "Old Title"',
        'customRating: 5',
        'shelfLocation: "Bedroom"',
        'tags:',
        '  - readest',
        '---',
      ].join('\n');

      const frontmatter = ObsidianFormatter.generateFrontmatter(mockBook, 2, {}, existing);

      expect(frontmatter).toContain('title: "Atomic Habits"');
      expect(frontmatter).toContain('customRating: 5');
      expect(frontmatter).toContain('shelfLocation: "Bedroom"');
    });
  });

  describe('generateOverviewSection', () => {
    it('creates title, author link, and book details callout', () => {
      const overview = ObsidianFormatter.generateOverviewSection(mockBook, 2, 'covers/atomic.jpg');

      expect(overview).toContain('# Atomic Habits');
      expect(overview).toContain('**Author**: [[James Clear]]');
      expect(overview).toContain('![[covers/atomic.jpg|180]]');
      expect(overview).toContain('> [!info]+ Book Details');
      expect(overview).toContain('> - **Format**: EPUB');
      expect(overview).toContain('> - **Status**: `READING`');
      expect(overview).toContain('50%');
    });
  });

  describe('formatSingleNote', () => {
    it('formats a callout style note with color and deep link', () => {
      const note = mockNotes[0]!;
      const formatted = ObsidianFormatter.formatSingleNote(mockBook, note, {
        highlightStyle: 'callout',
        colorCallouts: true,
      });

      expect(formatted).toContain('> [!quote|yellow]');
      expect(formatted).toContain('> You do not rise to the level of your goals.');
      expect(formatted).toContain('> 💬 **Note**: Key insight about habits');
      expect(formatted).toContain('readest://book/abc123hash/annotation/note-1?cfi=');
      expect(formatted).toContain('#highlight/yellow');
    });

    it('formats a blockquote style note', () => {
      const note = mockNotes[0]!;
      const formatted = ObsidianFormatter.formatSingleNote(mockBook, note, {
        highlightStyle: 'blockquote',
      });

      expect(formatted).toContain('> You do not rise to the level of your goals.');
      expect(formatted).toContain('💬 **Note**: Key insight about habits');
      expect(formatted).not.toContain('> [!quote');
    });

    it('formats a bullet style note', () => {
      const note = mockNotes[1]!;
      const formatted = ObsidianFormatter.formatSingleNote(mockBook, note, {
        highlightStyle: 'bullet',
      });

      expect(formatted).toContain('- **Highlight**: "You fall to the level of your systems."');
      expect(formatted).toContain('#highlight/blue');
    });
  });

  describe('generateHighlightsBody & grouping', () => {
    it('groups highlights by chapter when chapterResolver is provided', () => {
      const chapterResolver = (note: BookNote) =>
        note.id === 'note-1' ? 'Chapter 1: The Fundamentals' : 'Chapter 2: The Systems';

      const body = ObsidianFormatter.generateHighlightsBody(
        mockBook,
        mockNotes,
        { groupHighlightsBy: 'chapter' },
        chapterResolver,
      );

      expect(body).toContain('### 📖 Chapter 1: The Fundamentals');
      expect(body).toContain('### 📖 Chapter 2: The Systems');
      expect(body).toContain('You do not rise to the level of your goals.');
      expect(body).toContain('You fall to the level of your systems.');
    });

    it('groups highlights by date', () => {
      const body = ObsidianFormatter.generateHighlightsBody(mockBook, mockNotes, {
        groupHighlightsBy: 'date',
      });

      expect(body).toContain('### 📅 ');
    });

    it('renders empty placeholder message when no notes are present', () => {
      const body = ObsidianFormatter.generateHighlightsBody(mockBook, []);
      expect(body).toContain('*No highlights or annotations recorded in Readest yet.*');
    });
  });

  describe('resolveBookState', () => {
    it('never downgrades finished status from existing Obsidian note', () => {
      const existing = ['---', 'readingStatus: finished', 'progress: "100%"', '---'].join('\n');

      const staleBook: Book = {
        ...mockBook,
        readingStatus: 'reading',
        progress: [30, 100],
      };

      const { resolvedBook } = ObsidianFormatter.resolveBookState(staleBook, undefined, existing);

      expect(resolvedBook.readingStatus).toBe('finished');
      expect(resolvedBook.progress).toEqual([100, 100]);
    });

    it('preserves existing embedded cover if cover path is not re-supplied', () => {
      const existing = [
        '# Book Title',
        '![[assets/covers/Atomic Habits.png|180]]',
        '> [!info]+ Book Details',
      ].join('\n');

      const { resolvedCoverPath } = ObsidianFormatter.resolveBookState(
        mockBook,
        undefined,
        existing,
      );

      expect(resolvedCoverPath).toBe('assets/covers/Atomic Habits.png');
    });
  });

  describe('mergeWithExistingContent', () => {
    it('preserves user reflections and notes under personal notes header', () => {
      const initial = ObsidianFormatter.format(mockBook, mockNotes);

      // Simulate user adding custom personal notes in Obsidian
      const modifiedWithUserNotes = initial.replace(
        '*Your thoughts here...*',
        'These are my in-depth personal takeaways and real-life reflections on Atomic Habits.',
      );

      // Re-sync with a 3rd note added
      const updatedNotes = [
        ...mockNotes,
        {
          id: 'note-3',
          bookHash: 'abc123hash',
          text: 'Every action you take is a vote for the type of person you wish to become.',
          color: 'green',
          createdAt: 1700000200000,
        } as unknown as BookNote,
      ];

      const merged = ObsidianFormatter.format(
        mockBook,
        updatedNotes,
        { preserveUserNotes: true },
        modifiedWithUserNotes,
      );

      // Verify user's personal reflection was strictly preserved
      expect(merged).toContain(
        'These are my in-depth personal takeaways and real-life reflections on Atomic Habits.',
      );

      // Verify new note was synced
      expect(merged).toContain(
        'Every action you take is a vote for the type of person you wish to become.',
      );

      // Verify markers remain intact
      expect(merged).toContain(OBSIDIAN_USER_NOTES_HEADER);
      expect(merged).toContain(OBSIDIAN_HIGHLIGHTS_START);
      expect(merged).toContain(OBSIDIAN_HIGHLIGHTS_END);
    });
  });

  describe('generateProgressBar', () => {
    it('produces accurate 16-character progress bars', () => {
      const half = ObsidianFormatter.generateProgressBar(50, 100, 16);
      expect(half.percent).toBe(50);
      expect(half.bar).toBe('████████░░░░░░░░');

      const full = ObsidianFormatter.generateProgressBar(100, 100, 16);
      expect(full.percent).toBe(100);
      expect(full.bar).toBe('████████████████');

      const zero = ObsidianFormatter.generateProgressBar(0, 100, 16);
      expect(zero.percent).toBe(0);
      expect(zero.bar).toBe('░░░░░░░░░░░░░░░░');
    });
  });
});
