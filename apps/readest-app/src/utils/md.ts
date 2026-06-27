import { marked } from 'marked';

import type { BookDoc, SectionItem } from '@/libs/document';
import { sanitizeHtml } from './sanitize';

// Render a standalone Markdown (.md) file into an in-memory foliate-js book at
// runtime (no EPUB conversion). The document is split into one section per
// top-level heading so reading progress, the cross-device location cursor and
// TTS section tracking all work per chapter — the same contract fb2.js gives a
// single-file format. Layout/font/theme styling applies for free because the
// reader styles whatever HTML the view renders.

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

// Minimal defaults so code blocks wrap inside the paginated column (long lines
// would otherwise overflow and break pagination) and tables/images stay legible
// under every theme. `currentColor` keeps borders readable in dark / e-ink.
const MD_STYLE = `
img { max-width: 100%; height: auto; }
pre { white-space: pre-wrap; overflow-wrap: break-word; }
pre, code { font-family: monospace; }
table { border-collapse: collapse; }
th, td { border: 1px solid currentColor; padding: 0.2em 0.5em; }
blockquote { margin-inline: 1em; }
`;

const wrapXhtml = (inner: string): string =>
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  `<html xmlns="${XHTML_NS}"><head><meta charset="utf-8"/>` +
  `<style>${MD_STYLE}</style></head><body>${inner}</body></html>`;

interface Frontmatter {
  title?: string;
  author?: string;
}

// Strip a leading YAML frontmatter block so it does not render as a stray
// `<hr>` + text, and lift `title` / `author` from it.
const stripFrontmatter = (text: string): { body: string; meta: Frontmatter } => {
  const match = text.match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (!match) return { body: text, meta: {} };
  const meta: Frontmatter = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const value = kv[2]!.trim().replace(/^['"]|['"]$/g, '');
    if (key === 'title') meta.title = value;
    else if (key === 'author') meta.author = value;
  }
  return { body: text.slice(match[0]!.length), meta };
};

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';

const isExternalUri = (uri: string): boolean => /^(?:https?|mailto|tel):/i.test(uri);

interface TocNode {
  label: string;
  href: string;
  subitems?: TocNode[];
}

type MarkdownSection = SectionItem & { load: () => string };

export async function makeMarkdownBook(file: File): Promise<BookDoc> {
  const text = await file.text();
  const { body, meta } = stripFrontmatter(text);
  const rawHtml = await marked.parse(body, { gfm: true });
  const safeHtml = sanitizeHtml(rawHtml);
  const docBody = new DOMParser().parseFromString(safeHtml, 'text/html').body;

  // Ensure every id is unique (including author-provided ids on raw HTML /
  // footnotes), then give each heading a stable slug id for TOC anchors and
  // internal-link resolution.
  const usedIds = new Set<string>();
  for (const el of Array.from(docBody.querySelectorAll('[id]'))) {
    if (el.id) usedIds.add(el.id);
  }
  const uniqueId = (base: string): string => {
    let id = base;
    let n = 1;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    return id;
  };
  const headingEls = Array.from(docBody.querySelectorAll('h1, h2, h3'));
  for (const h of headingEls) {
    if (!h.id) h.id = uniqueId(slugify(h.textContent ?? ''));
  }

  // Split the top-level nodes into sections at <h1> boundaries. Content before
  // the first <h1> becomes a leading preamble section (only when it has real
  // content). A document with no <h1> stays a single section.
  const hasContent = (nodes: ChildNode[]): boolean =>
    nodes.some(
      (n) =>
        n.nodeType === Node.ELEMENT_NODE ||
        (n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim()),
    );
  const groups: ChildNode[][] = [];
  let current: ChildNode[] = [];
  for (const node of Array.from(docBody.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'H1') {
      if (hasContent(current)) groups.push(current);
      current = [node];
    } else {
      current.push(node);
    }
  }
  if (hasContent(current)) groups.push(current);
  if (groups.length === 0) groups.push([]);

  // Serialize each section to well-formed XHTML. Marked emits HTML5 void tags
  // (<br>, <hr>, <img>) that are parse errors under application/xhtml+xml, so
  // XMLSerializer (not innerHTML) is required. Map every id to its section.
  const serializer = new XMLSerializer();
  const idMap = new Map<string, number>();
  const xhtml = groups.map((nodes, index) => {
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      if (el.id) idMap.set(el.id, index);
      for (const child of Array.from(el.querySelectorAll('[id]'))) {
        if (child.id) idMap.set(child.id, index);
      }
    }
    return wrapXhtml(nodes.map((n) => serializer.serializeToString(n)).join(''));
  });

  // Build a nested heading outline as the TOC, each entry linking to its
  // section index plus heading anchor.
  const root: TocNode[] = [];
  const stack: { level: number; subitems: TocNode[] }[] = [{ level: 0, subitems: root }];
  for (const h of headingEls) {
    const label = (h.textContent ?? '').trim();
    if (!label) continue;
    const level = Number(h.tagName.slice(1));
    const item: TocNode = { label, href: `${idMap.get(h.id) ?? 0}#${h.id}`, subitems: [] };
    while (stack[stack.length - 1]!.level >= level) stack.pop();
    stack[stack.length - 1]!.subitems.push(item);
    stack.push({ level, subitems: item.subitems! });
  }
  const prune = (items: TocNode[]): TocNode[] =>
    items.map(({ label, href, subitems }) => ({
      label,
      href,
      subitems: subitems && subitems.length ? prune(subitems) : undefined,
    }));
  const toc = prune(root);

  const urls: (string | undefined)[] = new Array(xhtml.length).fill(undefined);
  const sections: MarkdownSection[] = xhtml.map((str, index) => ({
    id: String(index),
    cfi: '',
    size: new TextEncoder().encode(str).length,
    linear: 'yes',
    load: () => {
      if (urls[index] === undefined) {
        urls[index] = URL.createObjectURL(new Blob([str], { type: 'application/xhtml+xml' }));
      }
      return urls[index]!;
    },
    loadText: async () => str,
    createDocument: async () => new DOMParser().parseFromString(str, 'application/xhtml+xml'),
  }));

  const title =
    meta.title?.trim() ||
    (headingEls.find((h) => h.tagName === 'H1')?.textContent ?? '').trim() ||
    file.name.replace(/\.(?:md|markdown)$/i, '');

  const book = {
    metadata: {
      title,
      author: meta.author?.trim() ?? '',
      language: 'en',
      identifier: file.name,
    },
    rendition: { layout: 'reflowable' as const },
    dir: 'ltr',
    toc,
    sections,
    splitTOCHref: (href: string): string[] => (href ? href.split('#') : []),
    getTOCFragment: (doc: Document, id: string): Element | null => doc.getElementById(id),
    resolveHref: (href: string) => {
      const [a, b] = href.split('#');
      if (a) {
        const index = Number(a);
        if (!Number.isInteger(index) || index < 0 || index >= sections.length) return null;
        return { index, anchor: (doc: Document) => (b ? doc.getElementById(b) : null) };
      }
      if (!b) return null;
      const index = idMap.get(b);
      if (index === undefined) return null;
      return { index, anchor: (doc: Document) => doc.getElementById(b) };
    },
    isExternal: (uri: string): boolean => isExternalUri(uri),
    getCover: async (): Promise<Blob | null> => null,
    destroy: () => {
      for (const url of urls) if (url) URL.revokeObjectURL(url);
    },
  };

  return book as unknown as BookDoc;
}
