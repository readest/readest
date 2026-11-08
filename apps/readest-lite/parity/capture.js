// Parity capture, shared by both runners: the state of the page after a step, as JSON.
// - `loc`: the book's location from foliate-view (`lastLocation`: the visible range's CFI) and the
//   paginator's page and page count.
// - `rects`: every element's border box (getBoundingClientRect, in its own document's viewport),
//   keyed by its DOM path. The path crosses shadow roots (`#shadow`) and iframes (`#doc`), so the
//   book's section documents are compared element by element too.
globalThis.__parityCapture = (step) => {
  const SKIP = new Set([
    'head',
    'script',
    'style',
    'link',
    'meta',
    'title',
    'noscript',
    'template',
    'base',
  ]);
  const rects = {};
  const round = (v) => Math.round(v * 100) / 100;
  const walk = (parent, path) => {
    const counts = {};
    // Readest Lite's Document and ShadowRoot have no `children`.
    const kids = parent.children ?? [...(parent.childNodes ?? [])].filter((n) => n.nodeType === 1);
    for (const el of kids) {
      const tag = el.localName;
      if (SKIP.has(tag)) continue;
      counts[tag] = (counts[tag] ?? 0) + 1;
      const p = `${path}/${tag}[${counts[tag]}]`;
      const r = el.getBoundingClientRect();
      rects[p] = [round(r.x), round(r.y), round(r.width), round(r.height)];
      if (el.shadowRoot) walk(el.shadowRoot, `${p}/#shadow`);
      if (tag === 'iframe') {
        let doc = null;
        try {
          doc = el.contentDocument;
        } catch {}
        if (doc?.documentElement) walk(doc, `${p}/#doc`);
      }
      walk(el, p);
    }
  };
  walk(document, '');
  const fv = document.querySelector('foliate-view');
  const l = fv?.lastLocation;
  const r = fv?.renderer;
  const loc = fv
    ? {
        cfi: l?.cfi ?? null,
        section: l?.section?.current ?? null,
        page: r?.page ?? null,
        pages: r?.pages ?? null,
        location: l?.location ? [l.location.current, l.location.total] : null,
      }
    : null;
  // A scenario's `probe` script may define __parityProbe(); its result is kept with the step.
  const probe = globalThis.__parityProbe?.() ?? null;
  return { step, path: location.pathname, loc, rects, probe };
};
