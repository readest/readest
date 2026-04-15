import { CFI, SectionFragment, SectionItem, TOCItem } from '@/libs/document';

const findFragmentPosition = (html: string, fragmentId: string | undefined): number => {
  if (!fragmentId) return html.length;
  const patterns = [
    new RegExp(`\\sid=["']${CSS.escape(fragmentId)}["']`, 'i'),
    new RegExp(`\\sname=["']${CSS.escape(fragmentId)}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && typeof match.index === 'number') return match.index;
  }
  return -1;
};

const calculateFragmentSize = (
  content: string,
  fragmentId: string | undefined,
  prevFragmentId: string | undefined,
): number => {
  const endPos = findFragmentPosition(content, fragmentId);
  if (endPos < 0) return 0;
  const startPos = prevFragmentId ? findFragmentPosition(content, prevFragmentId) : 0;
  const validStartPos = Math.max(0, startPos);
  if (endPos < validStartPos) return 0;
  return new Blob([content.substring(validStartPos, endPos)]).size;
};

const getHTMLFragmentElement = (doc: Document, id: string | undefined): Element | null => {
  if (!id) return null;
  return doc.getElementById(id) ?? doc.querySelector(`[name="${CSS.escape(id)}"]`);
};

type CFIModule = {
  joinIndir: (...xs: string[]) => string;
  fromElements: (elements: Element[]) => string[];
};

const buildFragmentCfi = (section: SectionItem, element: Element | null): string => {
  const cfiLib = CFI as unknown as CFIModule;
  const rel = element ? (cfiLib.fromElements([element])[0] ?? '') : '';
  return cfiLib.joinIndir(section.cfi, rel);
};

export const buildSectionFragments = (
  section: SectionItem,
  fragments: TOCItem[],
  base: TOCItem | null,
  content: string,
  doc: Document,
  splitHref: (href: string) => Array<string | number>,
): SectionFragment[] => {
  const out: SectionFragment[] = [];
  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i]!;
    const [, rawFragmentId] = splitHref(fragment.href) as [string | undefined, string | undefined];
    const fragmentId = rawFragmentId;

    const prev = i > 0 ? fragments[i - 1] : base;
    const [, rawPrevFragmentId] = prev
      ? (splitHref(prev.href) as [string | undefined, string | undefined])
      : [undefined, undefined];
    const prevFragmentId = rawPrevFragmentId;

    const element = getHTMLFragmentElement(doc, fragmentId);
    const cfi = buildFragmentCfi(section, element);
    const size = calculateFragmentSize(content, fragmentId, prevFragmentId);

    out.push({
      id: fragment.href,
      href: fragment.href,
      cfi,
      size,
      linear: section.linear,
    });
  }
  return out;
};
