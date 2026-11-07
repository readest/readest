// A small XML DOM for foliate-js's epub.js on Blitz + QuickJS, which has no DOMParser: container.xml,
// the OPF, the NCX and the EPUB 3 nav document are parsed into plain JS nodes. Covers what epub.js
// reads: localName/namespaceURI/nodeName, (NS) attributes, children and siblings, textContent,
// getElementsByTagName(NS), getElementById, lookupNamespaceURI, and querySelector(All) for simple
// selectors (`tag`, `[attr]`, `[attr="v"]`, `tag[attr="v"]`, comma lists). Lenient: never reports
// a parsererror. Chapters don't come through here; they load into a Blitz iframe.
//
// Built for an interpreter (QuickJS on armv7): namespaces resolve through a scope chain while
// parsing, every node knows its index in its parent, element children are kept in their own list,
// and entities are decoded only in text that has an `&`. The tree's shape is fixed once parsed
// (epub.js only reads it); attributes stay editable.

const XMLNS = 'http://www.w3.org/2000/xmlns/';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
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
    else collectText(n, out);
  }
};

const NONE = Object.freeze([]); // children of a text node

class XNode {
  constructor(type, parent, doc) {
    this.nodeType = type;
    this.parentNode = parent;
    this.ownerDocument = doc;
    this.childNodes = type === 3 ? NONE : [];
    this._kids = type === 3 ? NONE : []; // element children
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
  get innerText() {
    return this.textContent;
  }
  hasChildNodes() {
    return this.childNodes.length > 0;
  }
  // Descendant elements in document order, computed once (the tree's shape doesn't change).
  _all() {
    if (this._desc) return this._desc;
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

// Comma list of `tag`, `*`, `ns|tag` (namespace prefix ignored), each followed by `[attr]` /
// `[attr="v"]` / `[attr='v']`. Compiled once per selector string.
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
  const m = sel.match(/^((?:[\w*-]+\|)?[\w*.:-]+)?((?:\[[^\]]+\])*)$/);
  if (!m) return () => false;
  const tag = m[1]?.replace(/^[\w*-]+\|/, '');
  const attrs = [
    ...(m[2] ?? '').matchAll(
      /\[\s*(?:[\w*-]+\|)?([\w:.-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]/g,
    ),
  ].map((a) => [a[1], a[2] ?? a[3] ?? a[4]]);
  return (e) =>
    (!tag || tag === '*' || e.localName === tag || e.nodeName === tag) &&
    attrs.every(([k, v]) => (v === undefined ? e.hasAttribute(k) : e.getAttribute(k) === v));
}

class XText extends XNode {
  constructor(data, parent, doc) {
    super(3, parent, doc);
    this.data = data;
  }
  get nodeValue() {
    return this.data;
  }
  get textContent() {
    return this.data;
  }
  get nodeName() {
    return '#text';
  }
}

class XElement extends XNode {
  constructor(qname, attrs, scope, parent, doc) {
    super(1, parent, doc);
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
  getAttribute(name) {
    return this._attr(name)?.value ?? null;
  }
  getAttributeNS(ns, local) {
    const a = this._attrs,
      want = ns || null;
    for (let i = 0; i < a.length; i++)
      if (a[i].localName === local && a[i].namespaceURI === want) return a[i].value;
    return null;
  }
  hasAttribute(name) {
    return this._attr(name) !== null;
  }
  hasAttributeNS(ns, local) {
    return this.getAttributeNS(ns, local) !== null;
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
    super(9, null, null);
    this.contentType = contentType;
  }
  get documentElement() {
    return this._kids[0] ?? null;
  }
  lookupNamespaceURI(prefix) {
    return this.documentElement?.lookupNamespaceURI(prefix) ?? null;
  }
  lookupPrefix(ns) {
    return this.documentElement?.lookupPrefix(ns) ?? null;
  }
  get nodeName() {
    return '#document';
  }
}

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^>[]|\[[\s\S]*?\])*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
const ATTR = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const ROOT_SCOPE = Object.create(null);

const append = (parent, node) => {
  node._i = parent.childNodes.length;
  parent.childNodes.push(node);
  if (node.nodeType === 1) parent._kids.push(node);
};

export function parseXML(str, contentType) {
  const doc = new XDocument(contentType);
  let cur = doc,
    scope = ROOT_SCOPE;
  TOKEN.lastIndex = 0;
  for (let m; (m = TOKEN.exec(str)); ) {
    if (m[6] !== undefined) {
      if (cur !== doc) append(cur, new XText(decode(m[6]), cur, doc));
    } else if (m[3] !== undefined) {
      const attrs = [];
      let elScope = scope;
      if (m[4]) {
        ATTR.lastIndex = 0;
        for (let a; (a = ATTR.exec(m[4])); ) {
          const name = a[1],
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
      const el = new XElement(m[3], attrs, elScope, cur, doc);
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
      if (!m[5]) {
        cur = el;
        scope = elScope;
      }
    } else if (m[2] !== undefined) {
      // close up to the matching open element (lenient about misnesting)
      for (let e = cur; e && e !== doc; e = e.parentNode)
        if (e.nodeName === m[2]) {
          cur = e.parentNode;
          scope = cur === doc ? ROOT_SCOPE : cur._scope;
          break;
        }
    } else if (m[1] !== undefined) append(cur, new XText(m[1], cur, doc));
  }
  return doc;
}

export class XMLDOMParser {
  parseFromString(str, contentType) {
    return parseXML(String(str), contentType);
  }
}
