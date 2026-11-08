// `DOMParser` and `XMLSerializer` for tauri-runtime-blitz (QuickJS has none): a small XML DOM,
// enough for foliate-js's epub.js to read container.xml, the OPF, the NCX and the nav document,
// and to rewrite a chapter's links before the iframe loads it (loadReplaced). Covers
// localName/namespaceURI/nodeName, (NS) attributes, children and siblings, processing
// instructions, comments and the doctype, textContent, replaceWith, getElementsByTagName(NS),
// getElementById, lookupNamespaceURI, and querySelector(All) for simple selectors (`tag`,
// `ns|tag`, `[attr]`, `[*|attr]`, `[attr="v"]`, `:not(...)` of those, comma lists). Lenient:
// never reports a parsererror. text/html is parsed by the same XML rules plus void elements and
// an html/head/body skeleton (no other HTML parsing rules, few named entities).
//
// Built for an interpreter (QuickJS on armv7): namespaces resolve through a scope chain while
// parsing, every node knows its index in its parent, element children are kept in their own list,
// and entities are decoded only in text that has an `&`. Descendant lists are cached until the
// document changes.
(() => {
  const XMLNS = 'http://www.w3.org/2000/xmlns/';
  const XML_NS = 'http://www.w3.org/XML/1998/namespace';
  const XHTML_NS = 'http://www.w3.org/1999/xhtml';
  const VOID = new Set(
    'area base br col embed hr img input link meta param source track wbr'.split(' '),
  );
  const HEAD = new Set('base link meta script style title'.split(' '));
  const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
  const ENTITY = /&(#x[0-9a-f]+|#\d+|\w+);/gi;
  const decodeEntity = (m, e) =>
    e[0] === '#'
      ? String.fromCodePoint(
          e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10),
        )
      : (ENTITIES[e] ?? m);
  const decode = (s) => (s.indexOf('&') < 0 ? s : s.replace(ENTITY, decodeEntity));

  const collectText = (node, out) => {
    const c = node.childNodes;
    for (let i = 0; i < c.length; i++) {
      const n = c[i];
      if (n.nodeType === 3) out.push(n.data);
      else if (n.nodeType === 1) collectText(n, out);
    }
  };

  const NONE = Object.freeze([]); // children of a leaf (text, comment, PI, doctype)

  class XNode {
    constructor(type, parent, doc, leaf) {
      this.nodeType = type;
      this.parentNode = parent;
      this.ownerDocument = doc;
      this.childNodes = leaf ? NONE : [];
      this._kids = leaf ? NONE : []; // element children
      this._i = 0; // index in parent.childNodes
    }
    get parentElement() {
      const p = this.parentNode;
      return p && p.nodeType === 1 ? p : null;
    }
    get children() {
      return this._kids;
    }
    get childElementCount() {
      return this._kids.length;
    }
    get firstElementChild() {
      return this._kids[0] ?? null;
    }
    get lastElementChild() {
      return this._kids[this._kids.length - 1] ?? null;
    }
    get firstChild() {
      return this.childNodes[0] ?? null;
    }
    get lastChild() {
      return this.childNodes[this.childNodes.length - 1] ?? null;
    }
    get nextSibling() {
      return this.parentNode?.childNodes[this._i + 1] ?? null;
    }
    get previousSibling() {
      return this.parentNode?.childNodes[this._i - 1] ?? null;
    }
    get nextElementSibling() {
      const s = this.parentNode?.childNodes ?? [];
      for (let i = this._i + 1; i < s.length; i++) if (s[i].nodeType === 1) return s[i];
      return null;
    }
    get previousElementSibling() {
      const s = this.parentNode?.childNodes ?? [];
      for (let i = this._i - 1; i >= 0; i--) if (s[i].nodeType === 1) return s[i];
      return null;
    }
    get textContent() {
      const out = [];
      collectText(this, out);
      return out.join('');
    }
    set textContent(v) {
      const s = v == null ? '' : String(v);
      splice(this, 0, this.childNodes.length, s ? [new XText(s, this, this._doc)] : []);
    }
    get innerText() {
      return this.textContent;
    }
    get _doc() {
      return this.ownerDocument ?? this;
    }
    hasChildNodes() {
      return this.childNodes.length > 0;
    }
    remove() {
      if (this.parentNode) splice(this.parentNode, this._i, 1, []);
    }
    replaceWith(...nodes) {
      const p = this.parentNode;
      if (p) splice(p, this._i, 1, nodes);
    }
    // Descendant elements in document order, cached until the document changes.
    _all() {
      const v = this._doc._v;
      if (this._desc && this._descV === v) return this._desc;
      const out = [],
        stack = [this._kids, 0];
      while (stack.length) {
        const i = stack.pop(),
          kids = stack[stack.length - 1];
        if (i >= kids.length) {
          stack.pop();
          continue;
        }
        const e = kids[i];
        out.push(e);
        stack.push(i + 1);
        if (e._kids.length) stack.push(e._kids, 0);
      }
      this._descV = v;
      return (this._desc = out);
    }
    getElementsByTagName(name) {
      const all = this._all();
      if (name === '*') return all.slice();
      const out = [];
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        if (e.nodeName === name || e.localName === name) out.push(e);
      }
      return out;
    }
    getElementsByTagNameNS(ns, local) {
      const all = this._all(),
        out = [];
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        if ((ns === '*' || e.namespaceURI === ns) && (local === '*' || e.localName === local))
          out.push(e);
      }
      return out;
    }
    getElementById(id) {
      const all = this._all();
      for (let i = 0; i < all.length; i++) if (all[i].getAttribute('id') === id) return all[i];
      return null;
    }
    querySelectorAll(selector) {
      const test = compile(String(selector)),
        all = this._all(),
        out = [];
      for (let i = 0; i < all.length; i++) if (test(all[i])) out.push(all[i]);
      return out;
    }
    querySelector(selector) {
      const test = compile(String(selector)),
        all = this._all();
      for (let i = 0; i < all.length; i++) if (test(all[i])) return all[i];
      return null;
    }
  }

  // Replaces `count` children of `parent` from `index` with `nodes` (taken from where they were).
  function splice(parent, index, count, nodes) {
    for (const k of nodes) if (k.parentNode && k.parentNode !== parent) k.remove();
    const gone = parent.childNodes.splice(index, count, ...nodes);
    for (const k of gone) k.parentNode = null;
    for (const k of nodes) k.parentNode = parent;
    const c = parent.childNodes;
    for (let i = 0; i < c.length; i++) c[i]._i = i;
    parent._kids = c.filter((k) => k.nodeType === 1);
    parent._doc._v++;
  }

  // Comma list of compounds: `tag`, `*` or `ns|tag` (namespace prefix ignored), then `[attr]`,
  // `[*|attr]` (any namespace), `[attr="v"]`, and `:not(...)` of such a compound.
  const compiled = new Map();
  function compile(selector) {
    let test = compiled.get(selector);
    if (!test) {
      const tests = selector.split(',').map((s) => compileOne(s.trim()));
      test = tests.length === 1 ? tests[0] : (e) => tests.some((t) => t(e));
      compiled.set(selector, test);
    }
    return test;
  }
  function compileOne(sel) {
    const nots = [];
    const base = sel.replace(/:not\(([^()]*)\)/g, (_, s) => {
      nots.push(compileOne(s.trim()));
      return '';
    });
    const test = base ? compileCompound(base) : () => true;
    return nots.length ? (e) => test(e) && !nots.some((t) => t(e)) : test;
  }
  function compileCompound(sel) {
    const m = sel.match(/^((?:[\w*-]+\|)?[\w*.:-]+)?((?:\[[^\]]+\])*)$/);
    if (!m) return () => false;
    const tag = m[1]?.replace(/^[\w*-]+\|/, '');
    const attrs = [
      ...(m[2] ?? '').matchAll(
        /\[\s*(?:([\w*-]+)\|)?([\w:.-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]/g,
      ),
    ].map((a) => [a[1] === '*', a[2], a[3] ?? a[4] ?? a[5]]);
    const value = (e, anyNs, k) =>
      anyNs ? (e._attrs.find((a) => a.localName === k)?.value ?? null) : e.getAttribute(k);
    return (e) =>
      (!tag || tag === '*' || e.localName === tag || e.nodeName === tag) &&
      attrs.every(([anyNs, k, v]) => {
        const x = value(e, anyNs, k);
        return v === undefined ? x !== null : x === v;
      });
  }

  class XText extends XNode {
    constructor(data, parent, doc) {
      super(3, parent, doc, true);
      this.data = data;
    }
    get nodeValue() {
      return this.data;
    }
    get textContent() {
      return this.data;
    }
    set textContent(v) {
      this.data = String(v);
    }
    get nodeName() {
      return '#text';
    }
  }

  class XComment extends XNode {
    constructor(data, parent, doc) {
      super(8, parent, doc, true);
      this.data = data;
    }
    get nodeName() {
      return '#comment';
    }
  }

  class ProcessingInstruction extends XNode {
    constructor(target, data, parent, doc) {
      super(7, parent, doc, true);
      this.target = target;
      this.data = data;
    }
    get nodeName() {
      return this.target;
    }
  }

  class XDocumentType extends XNode {
    constructor(raw, parent, doc) {
      super(10, parent, doc, true);
      this._raw = raw;
      this.name = /^<!DOCTYPE\s+([^\s>[]+)/i.exec(raw)?.[1] ?? 'html';
    }
    get nodeName() {
      return this.name;
    }
  }

  class XElement extends XNode {
    constructor(qname, attrs, scope, parent, doc) {
      super(1, parent, doc, false);
      this._q = qname; // as written; what XMLSerializer writes
      this.nodeName = this.tagName = qname;
      const i = qname.indexOf(':');
      this.prefix = i < 0 ? null : qname.slice(0, i);
      this.localName = i < 0 ? qname : qname.slice(i + 1);
      this._attrs = attrs; // [{ name, prefix, localName, namespaceURI, value }]
      this._scope = scope; // prefix ('' = default) -> namespace URI, inherited from the parent
      this.namespaceURI = this.lookupNamespaceURI(this.prefix);
    }
    get attributes() {
      const a = this._attrs.slice();
      a.item = (i) => a[i] ?? null;
      a.getNamedItem = (name) => a.find((x) => x.name === name) ?? null;
      return a;
    }
    get id() {
      return this.getAttribute('id') ?? '';
    }
    _attr(name) {
      const a = this._attrs;
      for (let i = 0; i < a.length; i++) if (a[i].name === name) return a[i];
      return null;
    }
    _attrNS(ns, local) {
      const a = this._attrs,
        want = ns || null;
      for (let i = 0; i < a.length; i++)
        if (a[i].localName === local && a[i].namespaceURI === want) return a[i];
      return null;
    }
    getAttribute(name) {
      return this._attr(name)?.value ?? null;
    }
    getAttributeNS(ns, local) {
      return this._attrNS(ns, local)?.value ?? null;
    }
    hasAttribute(name) {
      return this._attr(name) !== null;
    }
    hasAttributeNS(ns, local) {
      return this._attrNS(ns, local) !== null;
    }
    setAttribute(name, value) {
      const a = this._attr(name);
      if (a) a.value = String(value);
      else
        this._attrs.push({
          name,
          prefix: null,
          localName: name,
          namespaceURI: null,
          value: String(value),
        });
    }
    setAttributeNS(ns, qname, value) {
      const i = qname.indexOf(':');
      const local = i < 0 ? qname : qname.slice(i + 1);
      const a = this._attrNS(ns, local);
      if (a) {
        a.value = String(value);
        return;
      }
      const prefix = i < 0 ? (ns ? this.lookupPrefix(ns) : null) : qname.slice(0, i);
      this._attrs.push({
        name: prefix ? `${prefix}:${local}` : local,
        prefix,
        localName: local,
        namespaceURI: ns || null,
        value: String(value),
      });
    }
    removeAttribute(name) {
      this._attrs = this._attrs.filter((a) => a.name !== name);
    }
    lookupNamespaceURI(prefix) {
      if (prefix === 'xml') return XML_NS;
      return this._scope[prefix || ''] || null;
    }
    lookupPrefix(ns) {
      for (let e = this; e?.nodeType === 1; e = e.parentNode) {
        const a = e._attrs;
        for (let i = 0; i < a.length; i++)
          if (a[i].prefix === 'xmlns' && a[i].value === ns) return a[i].localName;
      }
      return null;
    }
    closest(selector) {
      const t = compile(String(selector));
      for (let e = this; e?.nodeType === 1; e = e.parentNode) if (t(e)) return e;
      return null;
    }
  }

  class XDocument extends XNode {
    constructor(contentType) {
      super(9, null, null, false);
      this.contentType = contentType;
      this._v = 0; // bumped by every change of the tree's shape
    }
    get documentElement() {
      return this._kids[0] ?? null;
    }
    get doctype() {
      return this.childNodes.find((k) => k.nodeType === 10) ?? null;
    }
    get head() {
      return this.documentElement?._kids.find((e) => e.localName === 'head') ?? null;
    }
    get body() {
      return this.documentElement?._kids.find((e) => e.localName === 'body') ?? null;
    }
    lookupNamespaceURI(prefix) {
      return this.documentElement?.lookupNamespaceURI(prefix) ?? null;
    }
    lookupPrefix(ns) {
      return this.documentElement?.lookupPrefix(ns) ?? null;
    }
    createProcessingInstruction(target, data) {
      return new ProcessingInstruction(String(target), String(data), null, this);
    }
    createTextNode(data) {
      return new XText(String(data), null, this);
    }
    get nodeName() {
      return '#document';
    }
  }

  // Groups: 1 comment, 2 CDATA, 3 processing instruction, 4 doctype, 5 end tag, 6-8 start tag
  // (name, attributes, `/`), 9 text.
  const TOKEN =
    /<!--([\s\S]*?)-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?([\s\S]*?)\?>|(<!DOCTYPE(?:[^>[]|\[[\s\S]*?\])*>)|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
  const ATTR = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const ROOT_SCOPE = Object.create(null);
  const HTML_SCOPE = Object.assign(Object.create(null), { '': XHTML_NS });

  const append = (parent, node) => {
    node._i = parent.childNodes.length;
    parent.childNodes.push(node);
    if (node.nodeType === 1) parent._kids.push(node);
  };

  function parseXML(str, contentType) {
    const html = contentType === 'text/html';
    const doc = new XDocument(contentType);
    let cur = doc,
      scope = html ? HTML_SCOPE : ROOT_SCOPE;
    // A fragment without <html> goes into an html/head/body skeleton.
    let body = null;
    if (html && !/<html[\s>]/i.test(str)) {
      const root = new XElement('html', [], scope, doc, doc);
      append(doc, root);
      append(root, new XElement('head', [], scope, root, doc));
      body = new XElement('body', [], scope, root, doc);
      append(root, body);
      cur = body;
    }
    TOKEN.lastIndex = 0;
    for (let m; (m = TOKEN.exec(str)); ) {
      if (m[9] !== undefined) {
        if (cur !== doc) append(cur, new XText(decode(m[9]), cur, doc));
      } else if (m[6] !== undefined) {
        const qname = html ? m[6].toLowerCase() : m[6];
        const attrs = [];
        let elScope = scope;
        if (m[7]) {
          ATTR.lastIndex = 0;
          for (let a; (a = ATTR.exec(m[7])); ) {
            const name = html ? a[1].toLowerCase() : a[1],
              i = name.indexOf(':');
            const value = decode(a[2] ?? a[3] ?? a[4] ?? '');
            const prefix = i < 0 ? null : name.slice(0, i);
            const localName = i < 0 ? name : name.slice(i + 1);
            attrs.push({ name, prefix, localName, namespaceURI: null, value });
            if (name === 'xmlns' || prefix === 'xmlns') {
              if (elScope === scope) elScope = Object.create(scope);
              elScope[prefix ? localName : ''] = value;
            }
          }
        }
        const el = new XElement(qname, attrs, elScope, cur, doc);
        if (html) el.nodeName = el.tagName = qname.toUpperCase();
        append(cur, el);
        for (let i = 0; i < attrs.length; i++) {
          const a = attrs[i];
          a.namespaceURI =
            a.name === 'xmlns' || a.prefix === 'xmlns'
              ? XMLNS
              : a.prefix
                ? el.lookupNamespaceURI(a.prefix)
                : null;
        }
        if (!m[8] && !(html && VOID.has(qname))) {
          cur = el;
          scope = elScope;
        }
      } else if (m[5] !== undefined) {
        const name = html ? m[5].toLowerCase() : m[5];
        // close up to the matching open element (lenient about misnesting)
        for (let e = cur; e && e !== doc; e = e.parentNode)
          if (e._q === name) {
            cur = e.parentNode;
            scope = cur === doc ? ROOT_SCOPE : cur._scope;
            break;
          }
      } else if (m[1] !== undefined) append(cur, new XComment(m[1], cur, doc));
      else if (m[2] !== undefined) append(cur, new XText(m[2], cur, doc));
      else if (m[3] !== undefined) {
        const s = m[3].trim(),
          i = s.search(/\s/);
        const target = i < 0 ? s : s.slice(0, i);
        // The XML declaration is not a node.
        if (target !== 'xml')
          append(cur, new ProcessingInstruction(target, i < 0 ? '' : s.slice(i).trim(), cur, doc));
      } else if (m[4] !== undefined && cur === doc) append(doc, new XDocumentType(m[4], doc, doc));
    }
    // The fragment's leading metadata elements belong in <head>.
    if (body) {
      const head = doc.head;
      while (body.firstChild) {
        const k = body.firstChild;
        if (k.nodeType === 1 && HEAD.has(k.localName)) splice(head, head.childNodes.length, 0, [k]);
        else if (k.nodeType === 3 && !k.data.trim()) k.remove();
        else break;
      }
    }
    return doc;
  }

  // Well-formed XML that an HTML parser reads the same way: void elements and empty foreign
  // (SVG, MathML) elements self-close, other empty elements get an end tag, and text escapes
  // only `&` and `<` (CSS child combinators stay readable). In text/html documents the content
  // of <style> and <script> is written as is.
  const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const escAttr = (s) => escText(s).replace(/"/g, '&quot;');
  function serialize(node, html, out) {
    switch (node.nodeType) {
      case 1: {
        out.push('<', node._q);
        for (const a of node._attrs) out.push(' ', a.name, '="', escAttr(a.value), '"');
        const kids = node.childNodes;
        if (!kids.length && (VOID.has(node.localName) || node.namespaceURI !== XHTML_NS)) {
          out.push('/>');
          break;
        }
        out.push('>');
        const raw = html && (node.localName === 'style' || node.localName === 'script');
        for (const k of kids)
          if (raw && k.nodeType === 3) out.push(k.data);
          else serialize(k, html, out);
        out.push('</', node._q, '>');
        break;
      }
      case 3:
        out.push(escText(node.data));
        break;
      case 7:
        out.push('<?', node.target, node.data ? ` ${node.data}` : '', '?>');
        break;
      case 8:
        out.push('<!--', node.data, '-->');
        break;
      case 10:
        out.push(node._raw);
        break;
      case 9:
        for (const k of node.childNodes) serialize(k, html, out);
        break;
    }
  }

  // Installed only where the platform has none.
  globalThis.DOMParser ??= class DOMParser {
    parseFromString(str, contentType) {
      return parseXML(String(str), contentType);
    }
  };
  globalThis.XMLSerializer ??= class XMLSerializer {
    serializeToString(node) {
      const out = [];
      serialize(node, node._doc.contentType === 'text/html', out);
      return out.join('');
    }
  };
  globalThis.ProcessingInstruction ??= ProcessingInstruction;
})();
