import { BookCharacter } from '@/types/book';
import { FoliateView } from '@/types/view';
import { findTextRanges, getLiveSection } from './globalAnnotations';

/**
 * Overlay keys for character dots look like `char:<characterId>#<section>-<n>`.
 * The prefix lets Annotator route draw / click events for them apart from
 * highlights and notes.
 */
const CHARACTER_PREFIX = 'char:';
const MAX_DOTS_PER_CHARACTER_PER_SECTION = 1000;
export const CHARACTER_DOT_COLOR = '#f97316';

export const isCharacterValue = (value?: string): boolean =>
  !!value && value.startsWith(CHARACTER_PREFIX);

export const characterIdFromValue = (value: string): string =>
  value.slice(CHARACTER_PREFIX.length).split('#')[0]!;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Overlayer draw callback (same shape as Overlayer.highlight & co.): paints a
 * small dot beside the last line box of the name.
 */
export function drawCharacterDot(
  rects: ArrayLike<{ left: number; top: number; width: number; height: number }>,
  options: { color?: string } = {},
): SVGElement {
  const { color = CHARACTER_DOT_COLOR } = options;
  const g = document.createElementNS(SVG_NS, 'g');
  const last = rects[rects.length - 1];
  if (!last) return g;
  const r = Math.max(4, last.height * 0.22);
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', String(last.left + last.width + r * 0.6));
  dot.setAttribute('cy', String(last.top + r));
  dot.setAttribute('r', String(r));
  dot.setAttribute('fill', color);
  dot.setAttribute('stroke', 'white');
  dot.setAttribute('stroke-width', '1');
  g.append(dot);
  return g;
}

// A name only counts when it is not glued to other letters ("Ana" must not
// match inside "Mariana"). CJK has no word spacing, so it skips the check.
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

const isWholeWord = (range: Range, term: string): boolean => {
  if (CJK.test(term)) return true;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return true;
  const data = (node as Text).data;
  const before = data[range.startOffset - 1];
  const after = data[range.endOffset];
  return !(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after));
};

// Per-section memo, keyed on the live Document so it resets when the section
// is re-rendered: `${updatedAt}:${terms}` -> number of dots drawn.
const drawnByDoc = new WeakMap<Document, Map<string, { signature: string; count: number }>>();

const signatureOf = (c: BookCharacter): string =>
  `${c.updatedAt}:${c.name}:${(c.aliases ?? []).join('|')}:${c.color ?? ''}`;

const termsOf = (c: BookCharacter): string[] =>
  [c.name, ...(c.aliases ?? [])]
    .map((t) => t.trim())
    .filter(Boolean)
    // Longest first, so "Ana Maria" claims its text before the alias "Ana".
    .sort((a, b) => b.length - a.length);

export function expandCharacter(
  view: FoliateView | null,
  character: BookCharacter,
  doc: Document | null | undefined,
  index: number,
): void {
  if (!view || !doc || character.deletedAt) return;
  const live = getLiveSection(view, index);
  if (!live) return;

  const signature = signatureOf(character);
  let memo = drawnByDoc.get(doc);
  if (memo?.get(character.id)?.signature === signature) return;

  const covered = new Map<Node, Array<[number, number]>>();
  let count = 0;
  for (const term of termsOf(character)) {
    for (const range of findTextRanges(doc, term)) {
      if (count >= MAX_DOTS_PER_CHARACTER_PER_SECTION) break;
      if (!isWholeWord(range, term)) continue;
      const spans = covered.get(range.startContainer) ?? [];
      if (spans.some(([s, e]) => range.startOffset < e && range.endOffset > s)) continue;
      spans.push([range.startOffset, range.endOffset]);
      covered.set(range.startContainer, spans);

      const value = `${CHARACTER_PREFIX}${character.id}#${index}-${count}`;
      count += 1;
      try {
        const draw = (func: unknown, opts?: unknown) =>
          live.overlayer.add(value, range, func, opts);
        (view as unknown as EventTarget).dispatchEvent(
          new CustomEvent('draw-annotation', {
            detail: {
              draw,
              annotation: {
                id: character.id,
                type: 'annotation',
                cfi: '',
                note: '',
                value,
                createdAt: character.createdAt,
                updatedAt: character.updatedAt,
              },
              doc,
              range,
            },
          }),
        );
      } catch (err) {
        console.warn('Failed to draw character dot', { character: character.id, err });
      }
    }
  }

  if (!memo) {
    memo = new Map();
    drawnByDoc.set(doc, memo);
  }
  memo.set(character.id, { signature, count });
}

export function expandCharactersInRenderedSections(
  view: FoliateView | null,
  characters: BookCharacter[],
): void {
  if (!view) return;
  const sections = (view.renderer?.getContents?.() ?? []) as Array<{
    doc?: Document;
    index?: number;
  }>;
  for (const { doc, index } of sections) {
    if (!doc || typeof index !== 'number') continue;
    for (const character of characters) expandCharacter(view, character, doc, index);
  }
}

/** Erase every dot of `character` in the rendered sections (before a rename / delete). */
export function removeCharacterOverlays(view: FoliateView | null, character: BookCharacter): void {
  if (!view) return;
  const sections = (view.renderer?.getContents?.() ?? []) as Array<{
    index?: number;
    doc?: Document;
    overlayer?: { remove: (value: string) => void };
  }>;
  for (const { index, doc, overlayer } of sections) {
    if (typeof index !== 'number' || !overlayer || !doc) continue;
    const memo = drawnByDoc.get(doc);
    const count = memo?.get(character.id)?.count ?? 0;
    for (let i = 0; i < count; i += 1) {
      overlayer.remove(`${CHARACTER_PREFIX}${character.id}#${index}-${i}`);
    }
    memo?.delete(character.id);
  }
}
