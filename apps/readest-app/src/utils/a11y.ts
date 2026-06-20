import { FoliateView } from '@/types/view';

const VOID_ELEMENT_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

// Walk down the last-element-child chain to find the deepest element that the
// next-section skip link can be nested inside. Appending the link there (rather
// than as a trailing sibling of <body>) keeps it within the final content
// column: a full-page illustration wrapper often carries
// `column-break-after: always`, and any sibling placed after that break lands
// in a fresh, blank column/page (#4126). Stops before void elements (which
// cannot host children) and existing skip links.
const findSectionEndHost = (root: Element, excludeIds: string[]): Element => {
  let host: Element = root;
  for (;;) {
    const last = host.lastElementChild;
    if (!last || excludeIds.includes(last.id) || VOID_ELEMENT_TAGS.has(last.localName)) {
      return host;
    }
    host = last;
  }
};

export const handleA11yNavigation = (
  view: FoliateView | null,
  document: Document,
  options?: {
    skipToLastPosCallback: () => void;
    skipToLastPosLabel: string;
    skipToNextSectionCallback: () => void;
    skipToNextSectionLabel: string;
  },
) => {
  if (!view) return;

  document.querySelectorAll('a').forEach((el) => {
    el.setAttribute('tabindex', '-1');
  });

  // Inject a hidden "skip to reading position" link as the very first accessible
  // element in the iframe body. NVDA's D-key landmark navigation fires no DOM
  // events, so we cannot detect it; instead, when NVDA enters the landmark its
  // virtual cursor lands on this link first. The user presses Enter to jump to
  // their actual reading position.
  const skipLinkId = 'readest-skip-link-last-pos';
  if (document.body && !document.getElementById(skipLinkId)) {
    const skipLink = document.createElement('div');
    skipLink.id = skipLinkId;
    skipLink.setAttribute('cfi-inert', '');
    skipLink.setAttribute('tabindex', '0');
    skipLink.setAttribute('aria-hidden', 'false');
    skipLink.setAttribute('aria-label', options?.skipToLastPosLabel ?? '');
    Object.assign(skipLink.style, {
      position: 'absolute',
      left: '0px',
      top: 'auto',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
    });
    skipLink.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      options?.skipToLastPosCallback();
    });
    document.body.prepend(skipLink);
  }
  const skipNextSectionLinkId = 'readest-skip-link-next-section';
  if (document.body && !document.getElementById(skipNextSectionLinkId)) {
    // Use a <span>, not a <div>: this link is nested inside the section's last
    // content element (see findSectionEndHost below). The paragraph-layout rule
    // in getParagraphLayoutStyles() targets `div:not(:has(*:not(b,a,em,i,strong,
    // u,span)))`, so a nested <div> would make the enclosing paragraph fail the
    // `:has()` test and silently lose its line-spacing/indent overrides. <span>
    // is in that allow-list, so the paragraph keeps matching. position:absolute
    // still makes the inline span an out-of-flow 1×1px box, so layout/focus are
    // unchanged.
    const skipLink = document.createElement('span');
    skipLink.id = skipNextSectionLinkId;
    skipLink.setAttribute('cfi-inert', '');
    skipLink.setAttribute('tabindex', '0');
    skipLink.setAttribute('aria-hidden', 'false');
    skipLink.setAttribute('aria-label', options?.skipToNextSectionLabel ?? '');
    // position:absolute keeps the link out of flow so its own box cannot
    // trigger an extra column break (the blank-page bug, #4126); left/top:auto
    // leave it at its static position.
    Object.assign(skipLink.style, {
      position: 'absolute',
      left: 'auto',
      top: 'auto',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
    });
    skipLink.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      options?.skipToNextSectionCallback();
    });
    // Nest the link inside the last content element instead of appending it as
    // a trailing sibling of <body>, so a `column-break-after` on that block
    // cannot push it into a blank column. It stays the last node in document
    // order, so NVDA's virtual cursor still reaches it at the section end.
    const host = findSectionEndHost(document.body, [skipLinkId, skipNextSectionLinkId]);
    host.appendChild(skipLink);
  }
};
