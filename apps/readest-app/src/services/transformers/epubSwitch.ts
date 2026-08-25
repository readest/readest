import type { Transformer } from './types';

const OPS_NS = 'http://www.idpf.org/2007/ops';
// Content grammars the browser renders natively. A `case` requiring any other
// namespace (CML, ...) is skipped in favour of the `default` branch.
const SUPPORTED_NS = new Set([
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1998/Math/MathML',
]);

const resolveSwitch = (switchEl: Element) => {
  const parent = switchEl.parentNode;
  if (!parent) return;
  let chosen: Element | null = null;
  for (const child of switchEl.children) {
    if (child.namespaceURI !== OPS_NS) continue;
    const supported =
      child.localName === 'default' ||
      (child.localName === 'case' &&
        SUPPORTED_NS.has(child.getAttribute('required-namespace') ?? ''));
    if (supported) {
      chosen = child;
      break;
    }
  }
  while (chosen?.firstChild) parent.insertBefore(chosen.firstChild, switchEl);
  switchEl.remove();
};

/**
 * Resolves EPUB 3 `epub:switch` conditional content: the first `case` whose
 * `required-namespace` the browser can render replaces the switch, otherwise
 * the `default` branch does. Left in place, the sanitizer drops the whole
 * switch (DOMPurify treats an HTML-namespace `switch` as an SVG-only tag and
 * removes it together with the fallback, #480), and with scripting allowed the
 * browser would render every branch at once.
 */
export const epubSwitchTransformer: Transformer = {
  name: 'epubSwitch',

  transform: async (ctx) => {
    const { content } = ctx;
    if (!/<(?:[^\s<>/:]+:)?switch[\s/>]/.test(content)) return content;

    const doc = new DOMParser().parseFromString(content, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) return content;
    const switches = [...doc.getElementsByTagNameNS(OPS_NS, 'switch')];
    if (!switches.length) return content;
    switches.forEach(resolveSwitch);

    const prolog = content.match(/^\s*<\?xml[^>]*\?>\s*/)?.[0] ?? '';
    return prolog + new XMLSerializer().serializeToString(doc);
  },
};
