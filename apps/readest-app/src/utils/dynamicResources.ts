/**
 * Resolve resource references that a book's scripts introduce after the
 * section was loaded.
 *
 * foliate-js rewrites every `src`, `poster`, `srcset`, stylesheet and inline
 * `url()` to a blob URL while it loads a section, then serves the document
 * itself from a `blob:` URL. A reference a script adds later (Kotobee builds
 * `<video src="../../../video/x.mp4">` on the play click, out of an encrypted
 * payload) never went through that pass, and a relative path cannot resolve
 * against a `blob:` base, so the media silently fails to load. Watch the
 * document for such references and route them through the same loader.
 */
export type LoadHref = (href: string) => Promise<string>;

// `[style]` rather than `[style*="url("]`: the substring form is valid CSS
// but jsdom's selector engine drops it, and the regex below filters anyway.
const SELECTOR =
  'img[src], video[src], audio[src], source[src], track[src], video[poster], [style]';
// Compared against `localName`: EPUB sections are XHTML documents, where
// `tagName` keeps the lowercase source form.
const SRC_TAGS = new Set(['img', 'video', 'audio', 'source', 'track']);
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const STYLE_URL_RE = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi;

const isRelative = (url: string | null): url is string =>
  !!url && !SCHEME_RE.test(url) && !url.startsWith('#') && !url.startsWith('//');

export const observeDynamicResources = (doc: Document, loadHref: LoadHref): (() => void) => {
  // Values written by this observer, so seeing them again is a no-op rather
  // than a loop (a reference the loader cannot resolve is written back as is).
  const written = new WeakMap<Element, Map<string, string>>();
  // The reference each attribute is currently resolving, so a resolution that
  // finishes after the script has moved on does not win over the newer one.
  const loading = new WeakMap<Element, Map<string, string>>();
  // One lookup per reference per document. Book scripts reuse the same file
  // across widgets, and a script that rewrites an attribute the moment it
  // changes would otherwise drive an unbounded number of lookups.
  const resolved = new Map<string, Promise<string>>();

  const track = (map: WeakMap<Element, Map<string, string>>, el: Element, k: string, v: string) => {
    let attrs = map.get(el);
    if (!attrs) map.set(el, (attrs = new Map()));
    attrs.set(k, v);
  };
  const write = (el: Element, attr: string, value: string) => {
    track(written, el, attr, value);
    el.setAttribute(attr, value);
  };
  const isOwnWrite = (el: Element, attr: string) =>
    written.get(el)?.get(attr) === el.getAttribute(attr);

  const resolve = (href: string) => {
    let pending = resolved.get(href);
    // Keep the original reference if the loader cannot resolve it.
    if (!pending) resolved.set(href, (pending = loadHref(href).catch(() => href)));
    return pending;
  };

  const resolveAttr = async (el: Element, attr: 'src' | 'poster') => {
    if (attr === 'src' ? !SRC_TAGS.has(el.localName) : el.localName !== 'video') return;
    const value = el.getAttribute(attr);
    if (!isRelative(value) || isOwnWrite(el, attr)) return;
    track(loading, el, attr, value);
    // Park a `src` while it resolves: removing it re-runs the media element
    // load algorithm, which cancels the `error` the unresolvable URL would
    // fire (Kotobee tears its player down on that event) long before a
    // multi-megabyte clip has been read out of the archive.
    if (attr === 'src') el.removeAttribute('src');
    const url = await resolve(value);
    // The script moved on while this was loading: either to another relative
    // reference (which took over `loading`), or to one this observer leaves
    // alone, which for a parked `src` means the attribute is back.
    if (loading.get(el)?.get(attr) !== value) return;
    if (attr === 'src' ? el.hasAttribute('src') : el.getAttribute(attr) !== value) return;
    write(el, attr, url);
    if (url !== value && el.localName === 'source') {
      (el.parentElement as HTMLMediaElement | null)?.load?.();
    }
  };

  const resolveStyle = async (el: Element) => {
    const style = el.getAttribute('style');
    if (!style || isOwnWrite(el, 'style')) return;
    const refs = new Set(
      [...style.matchAll(STYLE_URL_RE)].map((match) => match[2]!).filter(isRelative),
    );
    if (!refs.size) return;
    const urls = new Map(
      await Promise.all([...refs].map(async (ref) => [ref, await resolve(ref)] as const)),
    );
    if ([...urls].every(([ref, url]) => ref === url)) return;
    // The script rewrote the style in the meantime; the next mutation gets it.
    if (el.getAttribute('style') !== style) return;
    write(
      el,
      'style',
      style.replace(STYLE_URL_RE, (match, _quote, ref: string) => {
        const url = urls.get(ref);
        return url && url !== ref ? `url("${url}")` : match;
      }),
    );
  };

  const process = (el: Element) => {
    void resolveAttr(el, 'src');
    void resolveAttr(el, 'poster');
    void resolveStyle(el);
  };
  const sweep = (root: Element) => {
    if (root.matches(SELECTOR)) process(root);
    for (const el of root.querySelectorAll(SELECTOR)) process(el);
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        const el = record.target as Element;
        if (record.attributeName === 'style') void resolveStyle(el);
        else void resolveAttr(el, record.attributeName as 'src' | 'poster');
      } else {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) sweep(node as Element);
        }
      }
    }
  });
  observer.observe(doc, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'poster', 'style'],
  });
  if (doc.documentElement) sweep(doc.documentElement);
  return () => observer.disconnect();
};
