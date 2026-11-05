import { describe, expect, it } from 'vitest';
import {
  createVaultNote,
  mergeVaultNote,
  renderHighlight,
  type VaultBook,
  type VaultHighlight,
} from '@/services/obsidian/vaultNote';

const book: VaultBook = {
  hash: 'bookhash1',
  title: 'The Book',
  author: 'Ann Author',
  progress: 12,
  cover: 'bookhash1.png',
};

const hl = (id: string, patch: Partial<VaultHighlight> = {}): VaultHighlight => ({
  id,
  text: `text ${id}`,
  note: '',
  color: 'yellow',
  chapter: 'Chapter 1',
  url: `https://web.readest.com/o/book/bookhash1/annotation/${id}`,
  deleted: false,
  ...patch,
});

const sync = (existing: string, highlights: VaultHighlight[], written = {}) =>
  mergeVaultNote(existing, book, highlights, written);

describe('createVaultNote', () => {
  it('writes the book properties and a Highlights heading', () => {
    expect(createVaultNote(book)).toBe(
      [
        '---',
        'title: "The Book"',
        'author: "Ann Author"',
        'cover: "[[bookhash1.png]]"',
        'progress: 12',
        'readest_book_id: bookhash1',
        'tags:',
        '  - readest',
        '---',
        '',
        '# Highlights',
        '',
      ].join('\n'),
    );
  });

  it('omits cover and progress when unknown', () => {
    const text = createVaultNote({ ...book, cover: null, progress: null });
    expect(text).not.toContain('cover:');
    expect(text).not.toContain('progress:');
  });
});

describe('renderHighlight', () => {
  it('renders a colored quote callout linking back to the annotation', () => {
    expect(
      renderHighlight(hl('a1', { text: 'line one\n\nline two', note: 'my\nthought' }), 'T'),
    ).toBe(
      [
        '> [!quote|yellow] [Chapter 1](https://web.readest.com/o/book/bookhash1/annotation/a1)',
        '> line one',
        '>',
        '> line two',
        '>',
        '> > [!note]',
        '> > my',
        '> > thought',
      ].join('\n'),
    );
  });

  it('falls back to the book title, escapes brackets and encodes parentheses', () => {
    const out = renderHighlight(
      hl('a1', { chapter: null, url: 'https://x/a?cfi=epubcfi(%2F6)', color: '#FF00aa' }),
      'A [Book]',
    );
    expect(out.split('\n')[0]).toBe(
      '> [!quote|ff00aa] [A \\[Book\\]](https://x/a?cfi=epubcfi%28%2F6%29)',
    );
  });
});

describe('mergeVaultNote', () => {
  it('adds highlights in order, each followed by its block id', () => {
    const { text, written } = sync(createVaultNote(book), [hl('a1'), hl('a2')]);
    expect(
      text.endsWith(
        [
          '# Highlights',
          '',
          renderHighlight(hl('a1'), book.title),
          '',
          '^rd-a1',
          '',
          renderHighlight(hl('a2'), book.title),
          '',
          '^rd-a2',
          '',
        ].join('\n'),
      ),
    ).toBe(true);
    expect(Object.keys(written)).toEqual(['a1', 'a2']);
  });

  it('is a no-op on a second sync and keeps text and properties the user added', () => {
    const first = sync(createVaultNote(book), [hl('a1'), hl('a2')]);
    const edited = first.text
      .replace('tags:', 'rating: 5\ntags:')
      .replace('^rd-a1\n', '^rd-a1\n\nMy reflection between highlights.\n')
      .concat('\n## My Notes\n\nWritten in Obsidian.\n');
    const second = sync(edited, [hl('a1'), hl('a2')], first.written);
    expect(second.text).toBe(edited);
  });

  it('updates a block the user has not touched, keeping its block id', () => {
    const first = sync(createVaultNote(book), [hl('a1')]);
    const { text } = sync(first.text, [hl('a1', { note: 'added later' })], first.written);
    expect(text).toContain('> > added later\n\n^rd-a1');
    expect(text).not.toContain('> text a1\n\n^rd-a1');
  });

  it('leaves a block the user edited', () => {
    const first = sync(createVaultNote(book), [hl('a1')]);
    const edited = first.text.replace('> text a1', '> text a1 (my edit)');
    const { text } = sync(edited, [hl('a1', { note: 'added later' })], first.written);
    expect(text).toBe(edited);
  });

  it('does not bring back a block the user deleted', () => {
    const first = sync(createVaultNote(book), [hl('a1'), hl('a2')]);
    const removed = first.text.replace(
      `${renderHighlight(hl('a1'), book.title)}\n\n^rd-a1\n\n`,
      '',
    );
    const { text } = sync(removed, [hl('a1'), hl('a2')], first.written);
    expect(text).toBe(removed);
  });

  it('removes an untouched block deleted in Readest but keeps an edited one', () => {
    const first = sync(createVaultNote(book), [hl('a1'), hl('a2'), hl('a3')]);
    const edited = first.text.replace('> text a3', '> text a3 (mine)');
    const { text, written } = sync(
      edited,
      [hl('a1', { deleted: true }), hl('a2'), hl('a3', { deleted: true })],
      first.written,
    );
    expect(text).not.toContain('^rd-a1');
    expect(text).toContain('# Highlights\n\n> [!quote|yellow]');
    expect(text).toContain('> text a3 (mine)\n\n^rd-a3');
    expect(Object.keys(written)).toEqual(['a2']);
  });

  it('inserts a new highlight between existing ones, before text that follows them', () => {
    const first = sync(createVaultNote(book), [hl('a1'), hl('a3')]);
    const withNotes = `${first.text}\n## My Notes\n\nmine\n`;
    const { text } = sync(withNotes, [hl('a1'), hl('a2'), hl('a3')], first.written);
    const order = ['^rd-a1', '^rd-a2', '^rd-a3', '## My Notes'].map((s) => text.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBeGreaterThan(-1);
    expect(text).toContain('^rd-a1\n\n> [!quote');
    expect(text).toContain('^rd-a2\n\n> [!quote');
  });

  it('adopts matching blocks written on another device without a record', () => {
    const fromOtherDevice = sync(createVaultNote(book), [hl('a1'), hl('a2')]);
    const edited = fromOtherDevice.text.replace('> text a2', '> text a2 (mine)');
    const { text, written } = sync(edited, [hl('a1'), hl('a2', { note: 'n' })], {});
    expect(text).toBe(edited);
    expect(Object.keys(written)).toEqual(['a1']);
  });

  it('refreshes the progress property', () => {
    const first = sync(createVaultNote(book), [hl('a1')]);
    const { text } = mergeVaultNote(
      first.text,
      { ...book, progress: 80 },
      [hl('a1')],
      first.written,
    );
    expect(text).toContain('\nprogress: 80\n');
    expect(text).not.toContain('progress: 12');
  });
});
