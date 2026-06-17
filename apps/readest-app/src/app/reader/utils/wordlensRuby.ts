import type { GlossOccurrence } from '@/services/wordlens/types';

const GLOSS_CLASS = 'ww-gloss';

interface Segment {
  node: Text;
  /** Offset of this node's text within the concatenated model string. */
  start: number;
}

export interface SectionTextModel {
  text: string;
  locate(offset: number): { node: Text; offset: number };
}

const isEligible = (node: Text): boolean => {
  let p: Node | null = node.parentNode;
  while (p) {
    if (p.nodeType === Node.ELEMENT_NODE) {
      const tag = (p as Element).tagName.toLowerCase();
      if (tag === 'rt' || tag === 'rp' || tag === 'ruby' || tag === 'script' || tag === 'style') {
        return false;
      }
    }
    p = p.parentNode;
  }
  return true;
};

/** Concatenate eligible text nodes and remember each node's slice offset. */
export const buildSectionTextModel = (doc: Document): SectionTextModel => {
  const root = doc.body ?? doc.documentElement;
  const segments: Segment[] = [];
  let text = '';
  if (root) {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        isEligible(n as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text;
      const data = t.data;
      if (!data) continue;
      segments.push({ node: t, start: text.length });
      text += data;
    }
  }
  const locate = (offset: number) => {
    let lo = 0;
    let hi = segments.length - 1;
    let seg = segments[0]!;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = segments[mid]!;
      if (offset < s.start) hi = mid - 1;
      else {
        seg = s;
        lo = mid + 1;
      }
    }
    return { node: seg.node, offset: offset - seg.start };
  };
  return { text, locate };
};

const occurrenceRange = (
  doc: Document,
  model: SectionTextModel,
  occ: GlossOccurrence,
): Range | null => {
  const s = model.locate(occ.start);
  const e = model.locate(occ.end);
  if (s.node !== e.node) return null;
  const range = doc.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  return range;
};

/** Wrap each occurrence as <ruby class=ww-gloss cfi-skip>word<rt cfi-inert>gloss</rt></ruby>. */
export const applyGlosses = (
  doc: Document,
  model: SectionTextModel,
  occurrences: GlossOccurrence[],
): void => {
  const sorted = [...occurrences].sort((a, b) => b.start - a.start);
  for (const occ of sorted) {
    const range = occurrenceRange(doc, model, occ);
    if (!range) continue;
    const ruby = doc.createElement('ruby');
    ruby.className = GLOSS_CLASS;
    ruby.setAttribute('cfi-skip', '');
    const rt = doc.createElement('rt');
    rt.setAttribute('cfi-inert', '');
    rt.textContent = occ.gloss;
    try {
      const word = range.extractContents();
      ruby.appendChild(word);
      ruby.appendChild(rt);
      range.insertNode(ruby);
    } catch {
      // Range became invalid (concurrent mutation); skip this one.
    }
  }
};

/** Unwrap every injected gloss, restoring the original text. */
export const clearGlosses = (doc: Document): void => {
  const rubies = doc.querySelectorAll(`ruby.${GLOSS_CLASS}`);
  rubies.forEach((ruby) => {
    ruby.querySelectorAll('rt').forEach((rt) => rt.remove());
    const parent = ruby.parentNode;
    if (!parent) return;
    while (ruby.firstChild) parent.insertBefore(ruby.firstChild, ruby);
    parent.removeChild(ruby);
  });
  (doc.body ?? doc.documentElement)?.normalize();
};

/** Given a tap target, return the base word if it is inside a gloss, else null. */
export const findGlossWord = (target: HTMLElement | null): string | null => {
  const ruby = target?.closest(`ruby.${GLOSS_CLASS}`);
  if (!ruby) return null;
  const clone = ruby.cloneNode(true) as Element;
  clone.querySelectorAll('rt').forEach((rt) => rt.remove());
  const word = clone.textContent?.trim() ?? '';
  return word || null;
};
