// Markdown footnotes for standalone .md books (see utils/md.ts).
//
// Two syntaxes are supported. `[^label]` + `[^label]: note` is the de-facto
// standard (PHP Markdown Extra, adopted verbatim by GitHub, Pandoc, Obsidian,
// Typora, goldmark and others) and is parsed by the `marked-footnote` plugin.
// Pandoc's inline `^[note]` is not, so `expandInlineFootnotes` rewrites it into
// the standard form before the plugin runs; both then share one numbering
// sequence.
//
// The plugin collects every definition into one trailing section, which would
// strand the whole book's notes inside the last <h1> section once md.ts splits
// at chapter boundaries. Instead `extractFootnoteDefs` lifts them out and
// `buildChapterFootnotes` re-emits them as per-chapter endnotes, numbered from
// 1 in each chapter, with the DPUB roles foliate's footnote popup keys on.

// `prefixId` passed to marked-footnote. Definitions are `<PREFIX><label>` and
// references `<PREFIX>ref-<label>`; distinctive enough not to collide with ids
// an author wrote by hand.
export const FOOTNOTE_PREFIX_ID = 'md-fn-';
const DEF_PREFIX = FOOTNOTE_PREFIX_ID;
const REF_PREFIX = `${FOOTNOTE_PREFIX_ID}ref-`;

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

// Rewrite Pandoc/Obsidian inline notes `^[text]` into a reference plus a
// definition appended to the source, so marked-footnote sees one uniform
// document and numbers inline and labelled notes in a single sequence.
//
// Code spans and fenced blocks are copied through untouched. Indented (4-space)
// code blocks are not detected: telling them apart from list continuations needs
// a full block parser, and a `^[` inside one is vanishingly rare.
export const expandInlineFootnotes = (src: string): string => {
  if (!src.includes('^[')) return src;

  // Never reuse a label the author already owns.
  let prefix = 'inline';
  while (src.includes(`[^${prefix}-`)) prefix += 'x';

  const defs: string[] = [];
  let out = '';
  let i = 0;

  while (i < src.length) {
    if (i === 0 || src[i - 1] === '\n') {
      const eol = src.indexOf('\n', i);
      const line = src.slice(i, eol === -1 ? src.length : eol);
      const fence = FENCE_RE.exec(line);
      if (fence) {
        const marker = fence[1]!;
        const closing = new RegExp(`^ {0,3}\\${marker[0]}{${marker.length},}[ \t]*$`);
        let j = eol === -1 ? src.length : eol + 1;
        while (j < src.length) {
          const end = src.indexOf('\n', j);
          const next = src.slice(j, end === -1 ? src.length : end);
          j = end === -1 ? src.length : end + 1;
          if (closing.test(next)) break;
        }
        out += src.slice(i, j);
        i = j;
        continue;
      }
    }

    const ch = src[i]!;

    if (ch === '`') {
      const run = /^`+/.exec(src.slice(i))![0];
      const close = src.indexOf(run, i + run.length);
      const stop = close === -1 ? i + run.length : close + run.length;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === '\\' && src[i + 1] === '^') {
      out += src.slice(i, i + 2);
      i += 2;
      continue;
    }

    if (ch === '^' && src[i + 1] === '[') {
      let depth = 1;
      let j = i + 2;
      while (j < src.length && depth > 0) {
        const c = src[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '[') depth++;
        else if (c === ']') depth--;
        if (depth === 0) break;
        j++;
      }
      const text =
        depth === 0
          ? src
              .slice(i + 2, j)
              .replace(/\s*\n\s*/g, ' ')
              .trim()
          : '';
      if (text) {
        const label = `${prefix}-${defs.length + 1}`;
        defs.push(`[^${label}]: ${text}`);
        out += `[^${label}]`;
        i = j + 1;
        continue;
      }
    }

    out += ch;
    i++;
  }

  return defs.length ? `${out.replace(/\s+$/, '')}\n\n${defs.join('\n\n')}\n` : src;
};

// Lift the plugin's trailing footnotes section out of the document, keyed by
// label. Removing it here (before md.ts scans headings) also keeps the plugin's
// "Footnotes" <h2> out of the TOC.
export const extractFootnoteDefs = (docBody: HTMLElement): Map<string, HTMLLIElement> => {
  const defs = new Map<string, HTMLLIElement>();
  const section = docBody.querySelector('section.footnotes');
  if (!section) return defs;
  for (const li of Array.from(section.querySelectorAll('li'))) {
    if (li.id.startsWith(DEF_PREFIX)) defs.set(li.id.slice(DEF_PREFIX.length), li as HTMLLIElement);
  }
  section.remove();
  return defs;
};

// Rewrite every footnote reference in one chapter's nodes to a chapter-local
// number, and return the endnote list to append to that chapter. A note cited
// from two chapters is cloned into both, so each chapter's list is complete and
// its numbers match its own references.
export const buildChapterFootnotes = (
  nodes: ChildNode[],
  sectionIndex: number,
  defs: Map<string, HTMLLIElement>,
  uniqueId: (base: string) => string,
): HTMLElement | null => {
  if (!defs.size) return null;

  const doc = nodes[0]?.ownerDocument;
  if (!doc) return null;

  interface Placed {
    li: HTMLLIElement;
    id: string;
    ordinal: number;
    refIds: string[];
  }
  const placed = new Map<string, Placed>();
  const list = doc.createElement('ol');

  // A note may itself cite a note, so newly cloned definitions are scanned too.
  const queue: HTMLAnchorElement[] = [];
  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    queue.push(
      ...Array.from(
        (node as Element).querySelectorAll<HTMLAnchorElement>(`a[id^="${REF_PREFIX}"]`),
      ),
    );
  }

  for (let i = 0; i < queue.length; i++) {
    const ref = queue[i]!;
    const label = (ref.getAttribute('href') ?? '').slice(`#${DEF_PREFIX}`.length);
    const def = defs.get(label);
    if (!def) continue;

    let entry = placed.get(label);
    if (!entry) {
      const li = def.cloneNode(true) as HTMLLIElement;
      // The plugin's backlinks point at document-wide reference ids; ours are
      // chapter-local, so drop them and regenerate below.
      for (const back of Array.from(li.querySelectorAll(`a[href^="#${REF_PREFIX}"]`))) {
        back.remove();
      }
      const id = uniqueId(`fn-${sectionIndex}-${placed.size + 1}`);
      li.id = id;
      li.setAttribute('role', 'doc-endnote');
      entry = { li, id, ordinal: placed.size + 1, refIds: [] };
      placed.set(label, entry);
      list.appendChild(li);
      queue.push(...Array.from(li.querySelectorAll<HTMLAnchorElement>(`a[id^="${REF_PREFIX}"]`)));
    }

    const refId = uniqueId(`fnref-${sectionIndex}-${entry.ordinal}`);
    ref.id = refId;
    ref.setAttribute('href', `#${entry.id}`);
    // foliate's FootnoteHandler treats doc-noteref as a definite footnote
    // reference, so the popup does not depend on the superscript heuristic.
    ref.setAttribute('role', 'doc-noteref');
    ref.textContent = String(entry.ordinal);
    entry.refIds.push(refId);
  }

  if (!placed.size) return null;

  for (const entry of placed.values()) {
    const target = entry.li.querySelector('p:last-of-type') ?? entry.li;
    entry.refIds.forEach((refId, index) => {
      const back = doc.createElement('a');
      back.setAttribute('href', `#${refId}`);
      // Excluded by foliate's footnote heuristic, so tapping it navigates back
      // instead of opening a popup on itself.
      back.setAttribute('role', 'doc-backlink');
      back.setAttribute('class', 'footnote-backref');
      back.textContent = '↩';
      if (entry.refIds.length > 1) {
        const sup = doc.createElement('sup');
        sup.textContent = String(index + 1);
        back.appendChild(sup);
      }
      target.appendChild(doc.createTextNode(' '));
      target.appendChild(back);
    });
  }

  const section = doc.createElement('section');
  section.setAttribute('class', 'md-footnotes');
  section.setAttribute('role', 'doc-endnotes');
  section.appendChild(doc.createElement('hr'));
  section.appendChild(list);
  return section;
};
