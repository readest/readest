import { describe, it, expect } from 'vitest';
import { makeMarkdownBook } from '@/utils/md';
import { expandInlineFootnotes } from '@/utils/mdFootnotes';
import type { BookDoc } from '@/libs/document';

type MdBook = BookDoc & {
  toc: NonNullable<BookDoc['toc']>;
  resolveHref: (
    href: string,
  ) => { index: number; anchor: (doc: Document) => Element | null } | null;
};

const make = async (content: string) =>
  (await makeMarkdownBook(
    new File([content], 'note.md', { type: 'text/markdown' }),
  )) as unknown as MdBook;

const docOf = (book: MdBook, index = 0) => book.sections[index]!.createDocument();

const refs = (doc: Document) =>
  Array.from(doc.querySelectorAll('a[role="doc-noteref"]')) as HTMLAnchorElement[];

const notes = (doc: Document) =>
  Array.from(doc.querySelectorAll('li[role="doc-endnote"]')) as HTMLLIElement[];

describe('expandInlineFootnotes', () => {
  it('rewrites an inline note into a reference plus a definition', () => {
    const out = expandInlineFootnotes('Text.^[The note.]\n');
    expect(out).toContain('Text.[^inline-1]');
    expect(out).toContain('[^inline-1]: The note.');
  });

  it('leaves source without inline notes untouched', () => {
    const src = 'Plain text[^1].\n\n[^1]: A labelled note.\n';
    expect(expandInlineFootnotes(src)).toBe(src);
  });

  it('does not convert ^[...] inside an inline code span', () => {
    const out = expandInlineFootnotes('Use `^[not a note]` here.\n');
    expect(out).toContain('`^[not a note]`');
    expect(out).not.toContain('[^inline-1]');
  });

  it('does not convert ^[...] inside a fenced code block', () => {
    const out = expandInlineFootnotes('```\nliteral ^[not a note]\n```\n');
    expect(out).toContain('literal ^[not a note]');
    expect(out).not.toContain('[^inline-1]');
  });

  it('does not convert ^[...] inside a tilde fence', () => {
    const out = expandInlineFootnotes('~~~\nliteral ^[not a note]\n~~~\n');
    expect(out).toContain('literal ^[not a note]');
    expect(out).not.toContain('[^inline-1]');
  });

  it('captures the whole note when it contains balanced brackets', () => {
    const out = expandInlineFootnotes('Text.^[see [Foo](http://bar) now] end.\n');
    expect(out).toContain('[^inline-1]: see [Foo](http://bar) now');
    expect(out).toContain('Text.[^inline-1] end.');
  });

  it('collapses a note that wraps across lines', () => {
    const out = expandInlineFootnotes('Text.^[a note\nwrapped over lines]\n');
    expect(out).toContain('[^inline-1]: a note wrapped over lines');
  });

  it('leaves an unterminated ^[ alone', () => {
    const src = 'Text.^[never closed\n';
    expect(expandInlineFootnotes(src)).toBe(src);
  });

  it('respects a backslash-escaped caret', () => {
    const src = 'Text.\\^[not a note]\n';
    expect(expandInlineFootnotes(src)).toBe(src);
  });

  it('picks a label prefix that cannot collide with an author label', () => {
    const out = expandInlineFootnotes('A[^inline-1] B.^[mine]\n\n[^inline-1]: theirs.\n');
    // The author already owns `inline-1`, so ours must not reuse it.
    expect(out).toContain('[^inline-1]: theirs.');
    expect(out).toMatch(/B\.\[\^inlinex-1\]/);
    expect(out).toContain('[^inlinex-1]: mine');
  });
});

describe('markdown footnotes', () => {
  it('renders the issue repro as a footnote instead of literal text', async () => {
    // https://github.com/readest/readest/issues/5074
    const book = await make('text[^1]\n\n[^1]: footnote\n');
    const doc = await docOf(book);

    expect(doc.body.textContent).not.toContain('[^1]');

    const [ref] = refs(doc);
    expect(ref).toBeTruthy();
    expect(ref!.textContent).toBe('1');
    expect(ref!.parentElement?.tagName.toLowerCase()).toBe('sup');

    const [note] = notes(doc);
    expect(note!.textContent).toContain('footnote');
    expect(ref!.getAttribute('href')).toBe(`#${note!.id}`);
  });

  it('numbers by first reference, not by label', async () => {
    const book = await make('a[^zebra] b[^1]\n\n[^1]: one\n[^zebra]: zed\n');
    const doc = await docOf(book);
    const [first, second] = refs(doc);
    expect(first!.textContent).toBe('1');
    expect(second!.textContent).toBe('2');
    expect(notes(doc)[0]!.textContent).toContain('zed');
    expect(notes(doc)[1]!.textContent).toContain('one');
  });

  it('renders inline notes sharing one sequence with labelled notes', async () => {
    const book = await make('a.^[inline one] b[^x] c.^[inline two]\n\n[^x]: labelled\n');
    const doc = await docOf(book);
    expect(refs(doc).map((r) => r.textContent)).toEqual(['1', '2', '3']);
    expect(notes(doc).map((n) => n.textContent?.trim())).toEqual([
      expect.stringContaining('inline one'),
      expect.stringContaining('labelled'),
      expect.stringContaining('inline two'),
    ]);
  });

  it('keeps a multi-paragraph definition intact', async () => {
    const book = await make('t[^a]\n\n[^a]: First para.\n\n    Second para.\n');
    const doc = await docOf(book);
    const note = notes(doc)[0]!;
    expect(note.querySelectorAll('p').length).toBe(2);
    expect(note.textContent).toContain('First para.');
    expect(note.textContent).toContain('Second para.');
  });

  it('gives a reused reference one note, unique ids and a backlink per reference', async () => {
    const book = await make('a[^a] b[^a]\n\n[^a]: once\n');
    const doc = await docOf(book);

    expect(notes(doc).length).toBe(1);
    const [r1, r2] = refs(doc);
    expect(r1!.textContent).toBe('1');
    expect(r2!.textContent).toBe('1');
    expect(r1!.id).not.toBe(r2!.id);
    expect(r1!.getAttribute('href')).toBe(r2!.getAttribute('href'));

    const backlinks = Array.from(
      notes(doc)[0]!.querySelectorAll('a[role="doc-backlink"]'),
    ) as HTMLAnchorElement[];
    expect(backlinks.map((b) => b.getAttribute('href'))).toEqual([`#${r1!.id}`, `#${r2!.id}`]);
  });

  it('puts each note in the chapter that references it and restarts numbering', async () => {
    const book = await make(
      '# One\n\na[^a] b[^b]\n\n# Two\n\nc[^c]\n\n[^a]: note a\n[^b]: note b\n[^c]: note c\n',
    );
    const one = await docOf(book, 0);
    const two = await docOf(book, 1);

    expect(refs(one).map((r) => r.textContent)).toEqual(['1', '2']);
    expect(notes(one).map((n) => n.textContent)).toEqual([
      expect.stringContaining('note a'),
      expect.stringContaining('note b'),
    ]);

    expect(refs(two).map((r) => r.textContent)).toEqual(['1']);
    expect(notes(two).length).toBe(1);
    expect(notes(two)[0]!.textContent).toContain('note c');
  });

  it('clones a note into every chapter that references it', async () => {
    const book = await make('# One\n\na[^s]\n\n# Two\n\nb[^s]\n\n[^s]: shared\n');
    const one = await docOf(book, 0);
    const two = await docOf(book, 1);

    expect(notes(one)[0]!.textContent).toContain('shared');
    expect(notes(two)[0]!.textContent).toContain('shared');
    expect(refs(two)[0]!.textContent).toBe('1');
    // Each chapter's reference points into its own list, not across sections.
    expect(refs(one)[0]!.getAttribute('href')).toBe(`#${notes(one)[0]!.id}`);
    expect(refs(two)[0]!.getAttribute('href')).toBe(`#${notes(two)[0]!.id}`);
    expect(notes(one)[0]!.id).not.toBe(notes(two)[0]!.id);
  });

  it('resolves a footnote href to the section that holds it', async () => {
    const book = await make('# One\n\na[^a]\n\n# Two\n\nb[^b]\n\n[^a]: note a\n[^b]: note b\n');
    const two = await docOf(book, 1);
    const href = refs(two)[0]!.getAttribute('href')!;
    expect(book.resolveHref(href)).toMatchObject({ index: 1 });
  });

  it('marks backlinks so they do not open a popup on themselves', async () => {
    const book = await make('t[^a]\n\n[^a]: note\n');
    const doc = await docOf(book);
    const backlink = notes(doc)[0]!.querySelector('a[role="doc-backlink"]');
    expect(backlink).toBeTruthy();
    expect(backlink!.getAttribute('role')).toBe('doc-backlink');
  });

  it('keeps the footnotes list out of the TOC', async () => {
    const book = await make('# One\n\na[^a]\n\n[^a]: note a\n');
    const labels = book.toc.map((i) => i.label.toLowerCase());
    expect(labels).toEqual(['one']);
  });

  it('drops an unreferenced definition and leaves a dangling reference as text', async () => {
    const book = await make('t[^a]\n\n[^a]: used\n[^b]: never used\n');
    const doc = await docOf(book);
    expect(notes(doc).length).toBe(1);
    expect(doc.body.textContent).not.toContain('never used');

    const dangling = await make('t[^missing]\n');
    const danglingDoc = await docOf(dangling);
    expect(refs(danglingDoc).length).toBe(0);
    expect(danglingDoc.body.textContent).toContain('[^missing]');
  });

  it('produces XHTML that parses without errors', async () => {
    const book = await make('# H\n\nt[^a] and inline.^[note b]\n\n[^a]: note a\n');
    const doc = await docOf(book);
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('section.md-footnotes')).toBeTruthy();
  });
});
