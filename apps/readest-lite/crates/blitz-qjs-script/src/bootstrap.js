// The DOM in JavaScript over `__n` (node-id operations on blitz-dom). One wrapper per node,
// cached by id; listeners live on wrappers; dispatch runs capture → target → bubble.
(function () {
  'use strict';
  const n = globalThis.__n;
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const wrappers = new Map();
  const kebab = (s) =>
    s.startsWith('--')
      ? s
      : s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()).replace(/^ms-/, '-ms-');
  const define = (obj, props) => {
    for (const k of Object.keys(props))
      Object.defineProperty(obj, k, Object.getOwnPropertyDescriptor(props, k));
  };

  // ---- Events ----
  class Event {
    constructor(type, init = {}) {
      this.type = String(type);
      this.bubbles = !!init.bubbles;
      this.cancelable = !!init.cancelable;
      this.composed = !!init.composed;
      this.defaultPrevented = false;
      this.target = null;
      this.currentTarget = null;
      this.eventPhase = 0;
      this.isTrusted = false;
      this.timeStamp = n.now();
      this._stop = false;
      this._stopNow = false;
    }
    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true;
    }
    stopPropagation() {
      this._stop = true;
    }
    stopImmediatePropagation() {
      this._stop = this._stopNow = true;
    }
    get cancelBubble() {
      return this._stop;
    }
    set cancelBubble(v) {
      if (v) this._stop = true;
    }
    get returnValue() {
      return !this.defaultPrevented;
    }
    set returnValue(v) {
      if (!v) this.preventDefault();
    }
    composedPath() {
      return this._path ? this._path.slice() : [];
    }
    initEvent(type, bubbles, cancelable) {
      this.type = type;
      this.bubbles = !!bubbles;
      this.cancelable = !!cancelable;
    }
  }
  Event.NONE = 0;
  Event.CAPTURING_PHASE = 1;
  Event.AT_TARGET = 2;
  Event.BUBBLING_PHASE = 3;
  class UIEvent extends Event {
    constructor(t, i = {}) {
      super(t, i);
      this.detail = i.detail || 0;
      this.view = i.view || null;
    }
  }
  class MouseEvent extends UIEvent {
    constructor(t, i = {}) {
      super(t, i);
      for (const k of [
        'clientX',
        'clientY',
        'pageX',
        'pageY',
        'screenX',
        'screenY',
        'button',
        'buttons',
      ])
        this[k] = i[k] || 0;
      for (const k of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) this[k] = !!i[k];
      this.relatedTarget = i.relatedTarget || null;
    }
    get x() {
      return this.clientX;
    }
    get y() {
      return this.clientY;
    }
    getModifierState() {
      return false;
    }
  }
  class PointerEvent extends MouseEvent {
    constructor(t, i = {}) {
      super(t, i);
      this.pointerId = i.pointerId || 1;
      this.pointerType = i.pointerType || 'mouse';
      this.isPrimary = i.isPrimary !== false;
      this.width = 1;
      this.height = 1;
      this.pressure = i.buttons ? 0.5 : 0;
    }
  }
  class KeyboardEvent extends UIEvent {
    constructor(t, i = {}) {
      super(t, i);
      this.key = i.key || '';
      this.code = i.code || '';
      this.repeat = !!i.repeat;
      for (const k of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) this[k] = !!i[k];
    }
    getModifierState() {
      return false;
    }
  }
  class InputEvent extends UIEvent {
    constructor(t, i = {}) {
      super(t, i);
      this.data = i.data || null;
      this.inputType = i.inputType || '';
    }
  }
  class FocusEvent extends UIEvent {
    constructor(t, i = {}) {
      super(t, i);
      this.relatedTarget = i.relatedTarget || null;
    }
  }
  class PromiseRejectionEvent extends Event {
    constructor(t, i = {}) {
      super(t, i);
      this.promise = i.promise;
      this.reason = i.reason;
    }
  }
  class CustomEvent extends Event {
    constructor(t, i = {}) {
      super(t, i);
      this.detail = i.detail === undefined ? null : i.detail;
    }
  }
  class PopStateEvent extends Event {
    constructor(t, i = {}) {
      super(t, i);
      this.state = i.state === undefined ? null : i.state;
    }
  }

  class EventTarget {
    addEventListener(type, cb, opts) {
      if (!cb) return;
      const capture = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
      const once = !!(opts && typeof opts === 'object' && opts.once);
      const map = this._listeners || (this._listeners = Object.create(null));
      const list = map[type] || (map[type] = []);
      if (!list.some((l) => l.cb === cb && l.capture === capture)) list.push({ cb, capture, once });
    }
    removeEventListener(type, cb, opts) {
      const capture = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
      const list = this._listeners && this._listeners[type];
      if (list) this._listeners[type] = list.filter((l) => !(l.cb === cb && l.capture === capture));
    }
    dispatchEvent(ev) {
      const path = [];
      // An event that is not composed stops at the shadow root.
      for (let t = this; t; t = t instanceof ShadowRoot && !ev.composed ? null : t._parentTarget())
        path.push(t);
      return !dispatch(path, ev);
    }
    _parentTarget() {
      return null;
    }
  }

  let anyCalled = false;
  function invoke(target, ev, capturePhase) {
    const list = target._listeners && target._listeners[ev.type];
    const on = (ev.eventPhase === 2 || !capturePhase) && target._on && target._on[ev.type];
    if (!list && !on) return;
    ev.currentTarget = target;
    if (list) {
      for (const l of list.slice()) {
        if (ev.eventPhase !== 2 && l.capture !== capturePhase) continue;
        if (ev.eventPhase === 2 && l.capture !== capturePhase) continue;
        if (l.once) target.removeEventListener(ev.type, l.cb, l.capture);
        anyCalled = true;
        try {
          if (typeof l.cb === 'function') l.cb.call(target, ev);
          else l.cb.handleEvent(ev);
        } catch (e) {
          reportError(e);
        }
        if (ev._stopNow) return;
      }
    }
    if (on && !capturePhase) {
      anyCalled = true;
      try {
        if (on.call(target, ev) === false) ev.preventDefault();
      } catch (e) {
        reportError(e);
      }
    }
  }
  // The target each path entry sees: past a shadow root, its host (null: no shadow roots exist).
  function retargets(path) {
    if (!shadowIds.size) return null;
    const out = [];
    let t = path[0];
    for (const p of path) {
      out.push(t);
      if (p instanceof ShadowRoot) t = p.host;
    }
    return out;
  }
  // path: target first, then ancestors (and document, window). Returns defaultPrevented.
  function dispatch(path, ev) {
    const targets = retargets(path);
    const at = (i) => {
      if (targets) ev.target = targets[i];
      return path[i];
    };
    ev.target = path[0];
    ev._path = path;
    const prev = globalThis.event;
    globalThis.event = ev;
    for (let i = path.length - 1; i > 0 && !ev._stop; i--) {
      ev.eventPhase = 1;
      invoke(at(i), ev, true);
    }
    if (!ev._stop) {
      ev.eventPhase = 2;
      invoke(at(0), ev, true);
      if (!ev._stopNow) invoke(path[0], ev, false);
    }
    if (ev.bubbles)
      for (let i = 1; i < path.length && !ev._stop; i++) {
        ev.eventPhase = 3;
        invoke(at(i), ev, false);
      }
    ev.eventPhase = 0;
    ev.currentTarget = null;
    globalThis.event = prev;
    return ev.defaultPrevented;
  }

  // ---- Nodes ----
  class Node extends EventTarget {
    constructor(id) {
      super();
      this._id = id;
    }
    _parentTarget() {
      const p = this.parentNode;
      return p || (this.nodeType === 9 ? this.defaultView : null);
    }
    get nodeType() {
      return n.kind(this._id);
    }
    // Negative handles below -1 are in an iframe's document (ops.rs); -1 is a fragment.
    get ownerDocument() {
      if (this.nodeType === 9) return null;
      return this._id < -1 ? wrap(n.root(this._id)) : document;
    }
    get parentNode() {
      const p = n.parent(this._id);
      return p == null ? null : wrap(p);
    }
    get parentElement() {
      const p = this.parentNode;
      return p && p.nodeType === 1 ? p : null;
    }
    // A host's shadow root is its first native child (attachShadow), not one of its children.
    get childNodes() {
      const c = n.children(this._id).map(wrap);
      if (this._shadow) c.shift();
      return c;
    }
    get firstChild() {
      let c = n.first(this._id);
      if (this._shadow && c != null) c = n.sibling(c, 1);
      return c == null ? null : wrap(c);
    }
    get lastChild() {
      const c = n.last(this._id);
      return c == null || c === this._shadow?._id ? null : wrap(c);
    }
    get nextSibling() {
      const c = n.sibling(this._id, 1);
      return c == null ? null : wrap(c);
    }
    get previousSibling() {
      const c = n.sibling(this._id, -1);
      return c == null || shadowIds.has(c) ? null : wrap(c);
    }
    // Shadow-including: shadow trees are in the native tree under their hosts.
    get isConnected() {
      if (this._id === -1) return false;
      let id = this._id;
      for (let p = n.parent(id); p != null; p = n.parent(p)) id = p;
      return n.kind(id) === 9;
    }
    hasChildNodes() {
      return this.firstChild != null;
    }
    // Merges adjacent text nodes and drops empty ones, in the whole subtree.
    normalize() {
      for (let c = this.firstChild; c; ) {
        if (c.nodeType === 3) {
          for (let t; (t = c.nextSibling)?.nodeType === 3; ) {
            c.data += t.data;
            this.removeChild(t);
          }
          const after = c.nextSibling;
          if (!c.data) this.removeChild(c);
          c = after;
          continue;
        }
        if (c.nodeType === 1) c.normalize();
        c = c.nextSibling;
      }
    }
    getRootNode(opts) {
      let t = this;
      while (t.parentNode) t = t.parentNode;
      return opts?.composed && t instanceof ShadowRoot ? t.host.getRootNode(opts) : t;
    }
    contains(other) {
      for (let t = other; t; t = t.parentNode) if (t === this) return true;
      return false;
    }
    appendChild(c) {
      return this.insertBefore(c, null);
    }
    insertBefore(c, ref) {
      if (c instanceof DocumentFragment) {
        for (const k of c._kids.splice(0)) this.insertBefore(k, ref);
        return c;
      }
      const moved = defs.size > 0 && c.nodeType === 1 && c.isConnected;
      // Nodes stay in the document that created them (no adoption).
      if (!n.insert(this._id, c._id, ref ? ref._id : null))
        throw domError('The node belongs to another document', 'WrongDocumentError');
      if (c.nodeType !== 1 || !c.isConnected) return c;
      if (!c._started) {
        const tag = n.local(c._id);
        if (tag === 'script') startScript(c);
        else if (tag === 'link') watchSheet(c);
        else if (tag === 'iframe' && (c.hasAttribute('src') || c.hasAttribute('srcdoc')))
          loadingFrames.add(c);
      }
      if (defs.size && !moved && c._id >= 0)
        connectCustom([c._id, ...n.queryAllDeep(c._id, defSelector)]);
      return c;
    }
    removeChild(c) {
      n.remove(c._id);
      if (connectedCustom.size) disconnectCustom();
      return c;
    }
    replaceChild(nc, oc) {
      this.insertBefore(nc, oc);
      this.removeChild(oc);
      return oc;
    }
    remove() {
      n.remove(this._id);
      if (connectedCustom.size) disconnectCustom();
    }
    get textContent() {
      return this.nodeType === 9 ? null : n.text(this._id);
    }
    set textContent(v) {
      keepShadow(this, () => n.setText(this._id, v == null ? '' : String(v)));
      if (connectedCustom.size) disconnectCustom();
    }
    get nodeValue() {
      const k = this.nodeType;
      return k === 3 || k === 8 ? n.text(this._id) : null;
    }
    set nodeValue(v) {
      const k = this.nodeType;
      if (k === 3 || k === 8) n.setText(this._id, String(v));
    }
    cloneNode() {
      throw new Error('cloneNode is not implemented');
    }
    isSameNode(o) {
      return o === this;
    }
  }
  define(Node, {
    ELEMENT_NODE: 1,
    TEXT_NODE: 3,
    COMMENT_NODE: 8,
    DOCUMENT_NODE: 9,
    DOCUMENT_FRAGMENT_NODE: 11,
    DOCUMENT_POSITION_CONTAINED_BY: 16,
    DOCUMENT_POSITION_CONTAINS: 8,
  });
  Object.assign(Node.prototype, {
    ELEMENT_NODE: 1,
    TEXT_NODE: 3,
    COMMENT_NODE: 8,
    DOCUMENT_NODE: 9,
    DOCUMENT_FRAGMENT_NODE: 11,
  });

  class CharacterData extends Node {
    get data() {
      return n.text(this._id);
    }
    set data(v) {
      n.setText(this._id, String(v));
    }
    get length() {
      return this.data.length;
    }
    get nodeName() {
      return this.nodeType === 3 ? '#text' : '#comment';
    }
  }
  class Text extends CharacterData {}
  class Comment extends CharacterData {}

  class DocumentFragment extends Node {
    constructor() {
      super(-1);
      this._kids = [];
    }
    get nodeType() {
      return 11;
    }
    get nodeName() {
      return '#document-fragment';
    }
    get parentNode() {
      return null;
    }
    get childNodes() {
      return this._kids.slice();
    }
    get firstChild() {
      return this._kids[0] || null;
    }
    get lastChild() {
      return this._kids[this._kids.length - 1] || null;
    }
    insertBefore(c, ref) {
      n.remove(c._id);
      const i = ref ? this._kids.indexOf(ref) : -1;
      if (i < 0) this._kids.push(c);
      else this._kids.splice(i, 0, c);
      return c;
    }
    removeChild(c) {
      this._kids = this._kids.filter((k) => k !== c);
      return c;
    }
    get ownerDocument() {
      return document;
    }
  }

  // CSSStyleDeclaration: a Proxy so `style.fontSize = "18px"` and `style.setProperty` both
  // reach blitz-dom's inline style; reads come from what was set here.
  function makeStyle(el) {
    const vals = new Map();
    const api = {
      setProperty(name, value) {
        if (value == null || value === '') return api.removeProperty(name);
        vals.set(name, String(value));
        n.setStyle(el._id, name, String(value));
      },
      removeProperty(name) {
        const old = vals.get(name) || '';
        vals.delete(name);
        n.delStyle(el._id, name);
        return old;
      },
      getPropertyValue(name) {
        return vals.get(name) || '';
      },
      getPropertyPriority() {
        return '';
      },
      item(i) {
        return [...vals.keys()][i] || '';
      },
      get length() {
        return vals.size;
      },
      get cssText() {
        return [...vals].map(([k, v]) => `${k}: ${v};`).join(' ');
      },
      set cssText(text) {
        for (const k of [...vals.keys()]) api.removeProperty(k);
        for (const d of String(text).split(';')) {
          const i = d.indexOf(':');
          if (i > 0) api.setProperty(d.slice(0, i).trim(), d.slice(i + 1).trim());
        }
      },
    };
    return new Proxy(api, {
      get(t, k) {
        if (typeof k !== 'string' || k in t) return t[k];
        return vals.get(k === 'cssFloat' ? 'float' : kebab(k)) || '';
      },
      set(t, k, v) {
        if (k === 'cssText') {
          t.cssText = v;
          return true;
        }
        api.setProperty(k === 'cssFloat' ? 'float' : kebab(k), v);
        return true;
      },
      has(t, k) {
        return true;
      },
    });
  }

  // A host's attributes, without the one its shadow root's styles select it by.
  const attrNames = (el) => {
    const a = n.attrNames(el._id);
    return el._shadow ? a.filter((k) => k !== 'blitz-shadow-host') : a;
  };
  class Element extends Node {
    get nodeName() {
      return this.tagName;
    }
    get tagName() {
      const l = n.local(this._id);
      return this.namespaceURI === HTML_NS ? l.toUpperCase() : l;
    }
    get localName() {
      return n.local(this._id);
    }
    get namespaceURI() {
      return n.ns(this._id);
    }
    get style() {
      return this._style || (this._style = makeStyle(this));
    }
    // See "Shadow roots" below.
    attachShadow(init = {}) {
      if (this._shadow)
        throw domError('This element already hosts a shadow root', 'NotSupportedError');
      const key = String(++shadowCount);
      const id = n.createElement(this._id, HTML_NS, 'blitz-shadow-root');
      n.setAttr(id, 'style', 'display: contents');
      n.setAttr(id, 'blitz-shadow-root', key);
      n.setAttr(this._id, 'blitz-shadow-host', key);
      n.insert(this._id, id, n.first(this._id));
      const r = Object.create(ShadowRoot.prototype);
      Object.assign(r, { _id: id, _key: key, host: this, mode: init.mode });
      wrappers.set(id, r);
      shadowIds.add(id);
      this._shadow = r;
      return r;
    }
    get shadowRoot() {
      return this._shadow && this._shadow.mode === 'open' ? this._shadow : null;
    }
    // Attribute names fold to lower case on HTML elements only: SVG's are case-sensitive (viewBox).
    _an(k) {
      k = String(k);
      return this.namespaceURI === HTML_NS ? k.toLowerCase() : k;
    }
    getAttribute(k) {
      const v = n.getAttr(this._id, this._an(k));
      return v == null ? null : v;
    }
    setAttribute(k, v) {
      k = this._an(k);
      const old = this._ce?.observed.has(k) ? this.getAttribute(k) : undefined;
      if (k === 'style') {
        this.style.cssText = v;
      }
      n.setAttr(this._id, k, String(v));
      if (old !== undefined) reaction(this, 'attributeChangedCallback', k, old, String(v));
    }
    removeAttribute(k) {
      k = this._an(k);
      const old = this._ce?.observed.has(k) ? this.getAttribute(k) : null;
      if (k === 'style' && this._style) this._style.cssText = '';
      n.delAttr(this._id, k);
      if (old !== null) reaction(this, 'attributeChangedCallback', k, old, null);
    }
    hasAttribute(k) {
      return n.getAttr(this._id, this._an(k)) != null;
    }
    toggleAttribute(k, force) {
      const on = force === undefined ? !this.hasAttribute(k) : !!force;
      if (on && !this.hasAttribute(k)) this.setAttribute(k, '');
      else if (!on) this.removeAttribute(k);
      return on;
    }
    getAttributeNS(_ns, k) {
      return this.getAttribute(k);
    }
    setAttributeNS(_ns, k, v) {
      this.setAttribute(k.replace(/^.*:/, ''), v);
    }
    removeAttributeNS(_ns, k) {
      this.removeAttribute(k);
    }
    getAttributeNames() {
      return attrNames(this);
    }
    // Live, like a NamedNodeMap: React empties singletons with `while (a.length) removeAttributeNode(a[0])`.
    get attributes() {
      const el = this;
      const attr = (name) =>
        name == null
          ? undefined
          : {
              name,
              localName: name,
              value: el.getAttribute(name),
              nodeType: 2,
              namespaceURI: null,
              prefix: null,
              specified: true,
              ownerElement: el,
            };
      return new Proxy(
        {},
        {
          get(_, k) {
            if (k === 'length') return attrNames(el).length;
            if (k === Symbol.iterator)
              return function* () {
                for (const name of attrNames(el)) yield attr(name);
              };
            if (k === 'item') return (i) => attr(attrNames(el)[i]) || null;
            if (k === 'getNamedItem')
              return (name) => (el.hasAttribute(name) ? attr(el._an(name)) : null);
            if (k === 'removeNamedItem')
              return (name) => {
                const a = attr(el._an(name));
                el.removeAttribute(name);
                return a;
              };
            if (typeof k === 'string' && /^[0-9]+$/.test(k)) return attr(attrNames(el)[+k]);
            return undefined;
          },
          has(_, k) {
            return (
              k === 'length' ||
              (typeof k === 'string' && /^[0-9]+$/.test(k) && +k < attrNames(el).length)
            );
          },
        },
      );
    }
    getAttributeNode(name) {
      return this.attributes.getNamedItem(name);
    }
    removeAttributeNode(a) {
      this.removeAttribute(a.name);
      return a;
    }
    setAttributeNode(a) {
      this.setAttribute(a.name, a.value);
      return null;
    }
    get id() {
      return this.getAttribute('id') || '';
    }
    set id(v) {
      this.setAttribute('id', v);
    }
    get className() {
      return this.getAttribute('class') || '';
    }
    set className(v) {
      this.setAttribute('class', v);
    }
    get classList() {
      const el = this;
      const get = () => el.className.split(/\s+/).filter(Boolean);
      return {
        add: (...c) => {
          el.className = [...new Set([...get(), ...c])].join(' ');
        },
        remove: (...c) => {
          el.className = get()
            .filter((x) => !c.includes(x))
            .join(' ');
        },
        toggle: (c, f) => {
          const has = get().includes(c);
          const on = f === undefined ? !has : f;
          if (on) el.classList.add(c);
          else el.classList.remove(c);
          return on;
        },
        contains: (c) => get().includes(c),
      };
    }
    get dataset() {
      const el = this;
      return new Proxy(
        {},
        {
          get: (_, k) => el.getAttribute('data-' + kebab(String(k))) ?? undefined,
          set: (_, k, v) => {
            el.setAttribute('data-' + kebab(String(k)), v);
            return true;
          },
        },
      );
    }
    get children() {
      return this.childNodes.filter((c) => c.nodeType === 1);
    }
    get firstElementChild() {
      return this.children[0] || null;
    }
    get lastElementChild() {
      const c = this.children;
      return c[c.length - 1] || null;
    }
    get nextElementSibling() {
      let s = this.nextSibling;
      while (s && s.nodeType !== 1) s = s.nextSibling;
      return s;
    }
    get previousElementSibling() {
      let s = this.previousSibling;
      while (s && s.nodeType !== 1) s = s.previousSibling;
      return s;
    }
    get childElementCount() {
      return this.children.length;
    }
    set innerHTML(html) {
      keepShadow(this, () => n.setInnerHtml(this._id, String(html)));
      if (connectedCustom.size) disconnectCustom();
      if (defs.size && this.isConnected) connectCustom(n.queryAllDeep(this._id, defSelector));
    }
    get innerHTML() {
      return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : '')).join('');
    }
    querySelector(s) {
      const r = n.query(this._id, s);
      return r == null ? null : wrap(r);
    }
    querySelectorAll(s) {
      return n.queryAll(this._id, s).map(wrap);
    }
    getElementsByTagName(t) {
      return this.querySelectorAll(t);
    }
    getElementsByClassName(c) {
      return this.querySelectorAll(
        c
          .split(/\s+/)
          .filter(Boolean)
          .map((x) => '.' + x)
          .join(''),
      );
    }
    matches(s) {
      const p = this.parentNode || this.ownerDocument;
      return p.querySelectorAll(s).includes(this);
    }
    closest(s) {
      for (let e = this; e && e.nodeType === 1; e = e.parentNode) if (e.matches(s)) return e;
      return null;
    }
    getBoundingClientRect() {
      const [x, y, width, height] = n.rect(this._id);
      return new DOMRect(x, y, width, height);
    }
    getClientRects() {
      return [this.getBoundingClientRect()];
    }
    get offsetWidth() {
      return n.rect(this._id)[2];
    }
    get offsetHeight() {
      return n.rect(this._id)[3];
    }
    get clientWidth() {
      return n.sizes(this._id)[0];
    }
    get clientHeight() {
      return n.sizes(this._id)[1];
    }
    get scrollWidth() {
      return n.sizes(this._id)[2];
    }
    get scrollHeight() {
      return n.sizes(this._id)[3];
    }
    get scrollTop() {
      return n.scroll(this._id)[1];
    }
    set scrollTop(v) {
      this.scrollTo(this.scrollLeft, v);
    }
    get scrollLeft() {
      return n.scroll(this._id)[0];
    }
    set scrollLeft(v) {
      this.scrollTo(v, this.scrollTop);
    }
    // Instant (`behavior` is ignored); one `scroll` event per task, as browsers fire it per frame.
    scrollTo(x, y) {
      if (x && typeof x === 'object') ({ left: x = this.scrollLeft, top: y = this.scrollTop } = x);
      if (n.scrollTo(this._id, Number(x) || 0, Number(y) || 0) && !this._scrollEvent)
        this._scrollEvent = setTimeout(() => {
          this._scrollEvent = 0;
          this.dispatchEvent(new Event('scroll'));
        }, 0);
    }
    scroll(x, y) {
      this.scrollTo(x, y);
    }
    scrollBy(x, y) {
      if (x && typeof x === 'object') ({ left: x = 0, top: y = 0 } = x);
      this.scrollTo(this.scrollLeft + (Number(x) || 0), this.scrollTop + (Number(y) || 0));
    }
    focus() {
      document._active = this;
    }
    blur() {
      if (document._active === this) document._active = null;
    }
    click() {
      this.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    append(...nodes) {
      for (const c of nodes)
        this.appendChild(typeof c === 'string' ? docOf(this).createTextNode(c) : c);
    }
    prepend(...nodes) {
      const f = this.firstChild;
      for (const c of nodes)
        this.insertBefore(typeof c === 'string' ? docOf(this).createTextNode(c) : c, f);
    }
    replaceChildren(...nodes) {
      for (let c; (c = this.firstChild); ) this.removeChild(c);
      this.append(...nodes);
    }
  }
  class HTMLElement extends Element {
    // Only a defined custom element class constructs (`new`, createElement or an upgrade). An
    // upgrade hands it the existing wrapper, which becomes the class's object.
    // biome-ignore lint/correctness/noUnreachableSuper: returns the wrapper instead of super()'s object
    constructor() {
      const def = defsByCtor.get(new.target);
      if (!def) throw new TypeError('Illegal constructor');
      const el = upgradeTarget || wrap(n.createElement(document._id, HTML_NS, def.name));
      upgradeTarget = null;
      el._ce = def;
      // biome-ignore lint/correctness/noConstructorReturn: the subclass's `this` is the wrapper
      return Object.setPrototypeOf(el, new.target.prototype);
    }
    get title() {
      return this.getAttribute('title') || '';
    }
    set title(v) {
      this.setAttribute('title', v);
    }
    get hidden() {
      return this.hasAttribute('hidden');
    }
    set hidden(v) {
      if (v) this.setAttribute('hidden', '');
      else this.removeAttribute('hidden');
    }
    get tabIndex() {
      return Number(this.getAttribute('tabindex') || -1);
    }
    set tabIndex(v) {
      this.setAttribute('tabindex', v);
    }
  }
  // `on<event>` handler properties: libraries test `"onclick" in el` to pick event names.
  for (const t of [
    'click',
    'dblclick',
    'mousedown',
    'mouseup',
    'mousemove',
    'mouseover',
    'mouseout',
    'mouseenter',
    'mouseleave',
    'pointerdown',
    'pointerup',
    'pointermove',
    'pointerover',
    'pointerout',
    'pointerenter',
    'pointerleave',
    'pointercancel',
    'touchstart',
    'touchmove',
    'touchend',
    'touchcancel',
    'keydown',
    'keyup',
    'keypress',
    'input',
    'change',
    'submit',
    'focus',
    'blur',
    'focusin',
    'focusout',
    'scroll',
    'wheel',
    'contextmenu',
    'load',
    'error',
    'animationend',
    'transitionend',
  ]) {
    Object.defineProperty(HTMLElement.prototype, 'on' + t, {
      get() {
        return (this._on && this._on[t]) || null;
      },
      set(f) {
        (this._on || (this._on = Object.create(null)))[t] = typeof f === 'function' ? f : null;
      },
      configurable: true,
    });
  }
  const reflect = (cls, props) => {
    for (const p of props)
      Object.defineProperty(cls.prototype, p, {
        get() {
          return this.getAttribute(p.toLowerCase()) || '';
        },
        set(v) {
          this.setAttribute(p.toLowerCase(), v);
        },
        configurable: true,
      });
  };
  class HTMLInputElement extends HTMLElement {
    get value() {
      return this.getAttribute('value') || '';
    }
    set value(v) {
      this.setAttribute('value', v);
    }
    get checked() {
      return this.hasAttribute('checked');
    }
    set checked(v) {
      if (v) this.setAttribute('checked', '');
      else this.removeAttribute('checked');
    }
    get disabled() {
      return this.hasAttribute('disabled');
    }
    set disabled(v) {
      if (v) this.setAttribute('disabled', '');
      else this.removeAttribute('disabled');
    }
  }
  reflect(HTMLInputElement, ['type', 'name', 'placeholder']);
  class HTMLTextAreaElement extends HTMLInputElement {}
  class HTMLSelectElement extends HTMLInputElement {}
  class HTMLOptionElement extends HTMLInputElement {}
  class HTMLButtonElement extends HTMLElement {
    get disabled() {
      return this.hasAttribute('disabled');
    }
    set disabled(v) {
      if (v) this.setAttribute('disabled', '');
      else this.removeAttribute('disabled');
    }
  }
  reflect(HTMLButtonElement, ['type', 'name']);
  class HTMLAnchorElement extends HTMLElement {}
  reflect(HTMLAnchorElement, ['href', 'target', 'rel']);
  class HTMLImageElement extends HTMLElement {}
  reflect(HTMLImageElement, ['src', 'alt']);
  // contentDocument is the document Blitz loaded from src or srcdoc; `load` fires once it is
  // attached with its stylesheets loaded (checkFrames, after each layout).
  class HTMLIFrameElement extends HTMLElement {
    get contentDocument() {
      const h = n.subdoc(this._id);
      if (h == null) return null;
      const doc = wrap(h);
      doc._frame = this;
      return doc;
    }
    get contentWindow() {
      return this.contentDocument?.defaultView ?? null;
    }
    setAttribute(k, v) {
      super.setAttribute(k, v);
      const a = this._an(k);
      if (a === 'src' || a === 'srcdoc') loadingFrames.add(this);
    }
  }
  reflect(HTMLIFrameElement, ['src', 'srcdoc']);
  class HTMLFormElement extends HTMLElement {}
  class HTMLDivElement extends HTMLElement {}
  class HTMLSpanElement extends HTMLElement {}
  class HTMLParagraphElement extends HTMLElement {}
  class SVGElement extends Element {}
  const byTag = {
    input: HTMLInputElement,
    textarea: HTMLTextAreaElement,
    select: HTMLSelectElement,
    option: HTMLOptionElement,
    button: HTMLButtonElement,
    a: HTMLAnchorElement,
    img: HTMLImageElement,
    iframe: HTMLIFrameElement,
    form: HTMLFormElement,
    div: HTMLDivElement,
    span: HTMLSpanElement,
    p: HTMLParagraphElement,
  };
  // More element classes, for `instanceof` checks in loaders and libraries (Turbopack tests
  // HTMLScriptElement); exported on window below.
  const moreElements = {};
  const mk = (name, base = HTMLElement) =>
    (moreElements[name] = { [name]: class extends base {} }[name]);
  const HTMLMediaElement = mk('HTMLMediaElement');
  for (const [tag, name] of Object.entries({
    script: 'HTMLScriptElement',
    link: 'HTMLLinkElement',
    style: 'HTMLStyleElement',
    meta: 'HTMLMetaElement',
    head: 'HTMLHeadElement',
    body: 'HTMLBodyElement',
    html: 'HTMLHtmlElement',
    title: 'HTMLTitleElement',
    canvas: 'HTMLCanvasElement',
    label: 'HTMLLabelElement',
    ul: 'HTMLUListElement',
    ol: 'HTMLOListElement',
    li: 'HTMLLIElement',
    table: 'HTMLTableElement',
    tr: 'HTMLTableRowElement',
    td: 'HTMLTableCellElement',
    th: 'HTMLTableCellElement',
    template: 'HTMLTemplateElement',
    br: 'HTMLBRElement',
    hr: 'HTMLHRElement',
    pre: 'HTMLPreElement',
    dialog: 'HTMLDialogElement',
    source: 'HTMLSourceElement',
    h1: 'HTMLHeadingElement',
    h2: 'HTMLHeadingElement',
    h3: 'HTMLHeadingElement',
    h4: 'HTMLHeadingElement',
    h5: 'HTMLHeadingElement',
    h6: 'HTMLHeadingElement',
  }))
    byTag[tag] = moreElements[name] || mk(name);
  byTag.video = mk('HTMLVideoElement', HTMLMediaElement);
  // No 2D or WebGL context: getContext gives null, as for an unsupported context type.
  byTag.canvas.prototype.getContext = () => null;
  byTag.audio = mk('HTMLAudioElement', HTMLMediaElement);
  const reflectUrl = (cls, props) => {
    for (const p of props)
      Object.defineProperty(cls.prototype, p, {
        get() {
          const v = this.getAttribute(p.toLowerCase());
          if (v == null) return '';
          try {
            return typeof URL === 'function' ? new URL(v, location.href).href : v;
          } catch {
            return v;
          }
        },
        set(v) {
          this.setAttribute(p.toLowerCase(), v);
        },
        configurable: true,
      });
  };
  const reflectBool = (cls, props) => {
    for (const p of props)
      Object.defineProperty(cls.prototype, p, {
        get() {
          return this.hasAttribute(p.toLowerCase());
        },
        set(v) {
          if (v) this.setAttribute(p.toLowerCase(), '');
          else this.removeAttribute(p.toLowerCase());
        },
        configurable: true,
      });
  };
  const { HTMLScriptElement, HTMLLinkElement } = moreElements;
  reflectUrl(HTMLScriptElement, ['src']);
  reflect(HTMLScriptElement, [
    'type',
    'crossOrigin',
    'integrity',
    'nonce',
    'charset',
    'referrerPolicy',
    'fetchPriority',
  ]);
  reflectBool(HTMLScriptElement, ['async', 'defer', 'noModule']);
  Object.defineProperty(HTMLScriptElement.prototype, 'text', {
    get() {
      return this.textContent;
    },
    set(v) {
      this.textContent = v;
    },
    configurable: true,
  });
  reflectUrl(HTMLLinkElement, ['href']);
  reflect(HTMLLinkElement, [
    'rel',
    'as',
    'type',
    'media',
    'crossOrigin',
    'integrity',
    'fetchPriority',
  ]);

  class Document extends Node {
    get nodeName() {
      return '#document';
    }
    get documentElement() {
      return this.querySelector('html');
    }
    get head() {
      return this.querySelector('head');
    }
    get body() {
      return this.querySelector('body');
    }
    get links() {
      return this.querySelectorAll('a[href], area[href]');
    }
    get defaultView() {
      return this === document ? window : (this._view ??= frameWindow(this));
    }
    get activeElement() {
      return this._active || this.body;
    }
    get readyState() {
      return this._ready || 'loading';
    }
    get currentScript() {
      return this._script == null ? null : wrap(this._script);
    }
    get location() {
      return location;
    }
    get URL() {
      return location.href;
    }
    get documentURI() {
      return location.href;
    }
    get referrer() {
      return '';
    }
    get title() {
      const t = this.querySelector('title');
      return t ? t.textContent : '';
    }
    get visibilityState() {
      return 'visible';
    }
    get hidden() {
      return false;
    }
    get fonts() {
      return { ready: Promise.resolve(), addEventListener() {}, removeEventListener() {} };
    }
    createElement(tag) {
      const name = String(tag).toLowerCase();
      // Custom elements are the page's (one registry).
      const def = this === document && defs.get(name);
      return def ? new def.ctor() : wrap(n.createElement(this._id, HTML_NS, name));
    }
    createElementNS(ns, q) {
      return wrap(n.createElement(this._id, ns || HTML_NS, String(q).replace(/^.*:/, '')));
    }
    createTextNode(s) {
      return wrap(n.createText(this._id, String(s)));
    }
    createComment(s) {
      return wrap(n.createComment(this._id, String(s)));
    }
    createDocumentFragment() {
      return new DocumentFragment();
    }
    createEvent() {
      return new Event('');
    }
    getElementById(id) {
      const r = n.query(this._id, '#' + CSS.escape(String(id)));
      return r == null ? null : wrap(r);
    }
    querySelector(s) {
      const r = n.query(this._id, s);
      return r == null ? null : wrap(r);
    }
    querySelectorAll(s) {
      return n.queryAll(this._id, s).map(wrap);
    }
    getElementsByTagName(t) {
      return this.querySelectorAll(t);
    }
    getElementsByClassName(c) {
      return this.documentElement.getElementsByClassName(c);
    }
    getElementsByName(name) {
      return this.querySelectorAll('[name]').filter((e) => e.getAttribute('name') === String(name));
    }
    hasFocus() {
      return true;
    }
    getSelection() {
      return null;
    }
  }

  function wrap(id) {
    let w = wrappers.get(id);
    if (w) return w;
    const k = n.kind(id);
    let cls = Node;
    if (k === 9) cls = Document;
    else if (k === 3) cls = Text;
    else if (k === 8) cls = Comment;
    else if (k === 1) cls = n.ns(id) === HTML_NS ? byTag[n.local(id)] || HTMLElement : SVGElement;
    w = Object.create(cls.prototype);
    w._id = id;
    wrappers.set(id, w);
    return w;
  }

  // Scripts inserted after parsing (Turbopack's chunk loader, JSONP): `src` loads on a 0 ms timer through
  // the embedder's loader (n.loadScript) and then fires load/error; inline text runs on insertion.
  const JS_TYPES = [
    '',
    'text/javascript',
    'application/javascript',
    'text/ecmascript',
    'application/ecmascript',
    'module',
  ];
  function isJs(el) {
    return JS_TYPES.includes(
      String(el.getAttribute('type') || '')
        .trim()
        .toLowerCase(),
    );
  }
  function withCurrent(el, f) {
    const prev = document._script;
    document._script = el._id;
    try {
      return f();
    } finally {
      document._script = prev;
    }
  }
  function startScript(el) {
    el._started = true;
    if (!isJs(el)) return;
    const src = el.getAttribute('src');
    if (src == null) {
      const t = el.textContent;
      if (t)
        withCurrent(el, () => {
          try {
            (0, eval)(t);
          } catch (e) {
            reportError(e);
          }
        });
      return;
    }
    addTimer(
      () => {
        const ok = withCurrent(el, () => n.loadScript(src));
        el.dispatchEvent(new Event(ok ? 'load' : 'error'));
      },
      0,
      [],
      false,
    );
  }

  // <link rel=stylesheet> inserted after parsing fires `load` once Blitz has added its sheet,
  // checked after each layout (`__blitzAfterLayout`): React holds a commit until new stylesheets
  // load. Blitz drops failed loads silently, so a sheet still missing after SHEET_MS is an `error`.
  // Blitz fetches nothing for rel=preload; React waits on it before inserting the stylesheet itself,
  // so it "loads" on the next tick.
  const SHEET_MS = 10000;
  const pendingSheets = new Map();
  function watchSheet(el) {
    el._started = true;
    const rel = ` ${String(el.getAttribute('rel') || '').toLowerCase()} `;
    if (!el.getAttribute('href')) return;
    if (rel.includes(' preload '))
      return void addTimer(() => el.dispatchEvent(new Event('load')), 0, [], false);
    if (!rel.includes(' stylesheet ')) return;
    pendingSheets.set(el, n.now() + SHEET_MS);
    addTimer(checkSheets, SHEET_MS, [], false);
  }
  function checkSheets() {
    let fired = 0;
    for (const [el, due] of pendingSheets) {
      const loaded = n.hasSheet(el._id);
      if (!loaded && n.now() < due) continue;
      pendingSheets.delete(el);
      el.dispatchEvent(new Event(loaded ? 'load' : 'error'));
      fired++;
    }
    return fired;
  }

  // ---- Documents in iframes ----
  const docOf = (node) => (node.nodeType === 9 ? node : node.ownerDocument);
  // An iframe document's window: the page's globals, with its own document, size, listeners
  // and frameElement. Timers, rAF and getComputedStyle are the page's.
  function frameWindow(doc) {
    const w = Object.create(window);
    const size = () => n.viewport(doc._id);
    Object.defineProperties(w, {
      window: { get: () => w },
      self: { get: () => w },
      document: { value: doc },
      frameElement: { get: () => doc._frame ?? null },
      parent: { value: window },
      top: { value: window },
      innerWidth: { get: () => size()[0] },
      innerHeight: { get: () => size()[1] },
      getSelection: { value: () => doc.getSelection() },
      _listeners: { value: Object.create(null), writable: true },
      _on: { value: Object.create(null), writable: true },
    });
    return w;
  }
  const loadingFrames = new Set();
  function checkFrames() {
    let fired = 0;
    for (const f of loadingFrames) {
      if (!f.isConnected) continue;
      const id = n.subdocReady(f._id);
      if (id == null || id === f._frameDoc) continue;
      f._frameDoc = id;
      loadingFrames.delete(f);
      f.dispatchEvent(new Event('load'));
      fired++;
    }
    return fired;
  }

  // ---- DOMRect ----
  class DOMRectReadOnly {
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = +x;
      this.y = +y;
      this.width = +width;
      this.height = +height;
    }
    get left() {
      return Math.min(this.x, this.x + this.width);
    }
    get right() {
      return Math.max(this.x, this.x + this.width);
    }
    get top() {
      return Math.min(this.y, this.y + this.height);
    }
    get bottom() {
      return Math.max(this.y, this.y + this.height);
    }
    toJSON() {
      const { x, y, width, height, top, right, bottom, left } = this;
      return { x, y, width, height, top, right, bottom, left };
    }
    static fromRect(r = {}) {
      return new this(r.x, r.y, r.width, r.height);
    }
  }
  class DOMRect extends DOMRectReadOnly {}

  // ---- Tree order, Range and TreeWalker ----
  // Boundary points and traversal as the DOM specifies them, over the wrappers. A range's rects
  // are its common ancestor element's box: text geometry inside a line is not reachable yet.
  const indexOf = (node) => {
    let i = 0;
    for (let s = node.previousSibling; s; s = s.previousSibling) i++;
    return i;
  };
  const nodeLength = (node) => {
    const t = node.nodeType;
    return t === 3 || t === 8 || t === 7 ? node.data.length : node.childNodes.length;
  };
  const ancestors = (node) => {
    const out = [];
    for (let t = node; t; t = t.parentNode) out.push(t);
    return out.reverse();
  };
  // -1 when `a` comes before `b` in tree order, 1 after, 0 when they are one node, null when they
  // are in different trees.
  function treeOrder(a, b) {
    if (a === b) return 0;
    const pa = ancestors(a),
      pb = ancestors(b);
    if (pa[0] !== pb[0]) return null;
    let i = 1;
    while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++;
    if (i === pa.length) return -1; // a is an ancestor of b
    if (i === pb.length) return 1;
    return indexOf(pa[i]) < indexOf(pb[i]) ? -1 : 1;
  }
  Node.prototype.compareDocumentPosition = function (other) {
    const o = treeOrder(this, other);
    if (o === 0) return 0;
    if (o === null) return 1 | 32 | 4;
    if (this.contains(other)) return 16 | 4;
    if (other.contains(this)) return 8 | 2;
    return o < 0 ? 4 : 2;
  };
  function comparePoints(na, oa, nb, ob) {
    if (na === nb) return Math.sign(oa - ob);
    if (treeOrder(na, nb) > 0) return -comparePoints(nb, ob, na, oa);
    if (na.contains(nb)) {
      let child = nb;
      while (child.parentNode !== na) child = child.parentNode;
      return indexOf(child) < oa ? 1 : -1;
    }
    return -1;
  }
  const checkPoint = (node, offset) => {
    if (node.nodeType === 10) throw domError('The node is a doctype', 'InvalidNodeTypeError');
    if (offset > nodeLength(node)) throw domError('The offset is past the node', 'IndexSizeError');
  };

  class Range {
    constructor() {
      this.startContainer = this.endContainer = document;
      this.startOffset = this.endOffset = 0;
    }
    get collapsed() {
      return this.startContainer === this.endContainer && this.startOffset === this.endOffset;
    }
    get commonAncestorContainer() {
      let a = this.startContainer;
      while (!a.contains(this.endContainer)) a = a.parentNode;
      return a;
    }
    setStart(node, offset) {
      checkPoint(node, offset);
      this.startContainer = node;
      this.startOffset = offset;
      const o = treeOrder(node, this.endContainer);
      if (o === null || comparePoints(node, offset, this.endContainer, this.endOffset) > 0)
        this.collapse(true);
    }
    setEnd(node, offset) {
      checkPoint(node, offset);
      this.endContainer = node;
      this.endOffset = offset;
      const o = treeOrder(this.startContainer, node);
      if (o === null || comparePoints(this.startContainer, this.startOffset, node, offset) > 0)
        this.collapse(false);
    }
    setStartBefore(node) {
      this.setStart(node.parentNode, indexOf(node));
    }
    setStartAfter(node) {
      this.setStart(node.parentNode, indexOf(node) + 1);
    }
    setEndBefore(node) {
      this.setEnd(node.parentNode, indexOf(node));
    }
    setEndAfter(node) {
      this.setEnd(node.parentNode, indexOf(node) + 1);
    }
    selectNode(node) {
      const p = node.parentNode,
        i = indexOf(node);
      this.setStart(p, i);
      this.setEnd(p, i + 1);
    }
    selectNodeContents(node) {
      this.setStart(node, 0);
      this.setEnd(node, nodeLength(node));
    }
    collapse(toStart = false) {
      if (toStart) {
        this.endContainer = this.startContainer;
        this.endOffset = this.startOffset;
      } else {
        this.startContainer = this.endContainer;
        this.startOffset = this.endOffset;
      }
    }
    cloneRange() {
      const r = new Range();
      Object.assign(r, this);
      return r;
    }
    compareBoundaryPoints(how, src) {
      const [n1, o1] =
        how === 0 || how === 3
          ? [this.startContainer, this.startOffset]
          : [this.endContainer, this.endOffset];
      const [n2, o2] =
        how === 0 || how === 1
          ? [src.startContainer, src.startOffset]
          : [src.endContainer, src.endOffset];
      return comparePoints(n1, o1, n2, o2);
    }
    comparePoint(node, offset) {
      checkPoint(node, offset);
      if (comparePoints(node, offset, this.startContainer, this.startOffset) < 0) return -1;
      if (comparePoints(node, offset, this.endContainer, this.endOffset) > 0) return 1;
      return 0;
    }
    isPointInRange(node, offset) {
      if (treeOrder(node, this.startContainer) === null) return false;
      return this.comparePoint(node, offset) === 0;
    }
    intersectsNode(node) {
      const p = node.parentNode;
      if (!p) return treeOrder(node, this.startContainer) !== null;
      const i = indexOf(node);
      return (
        comparePoints(p, i, this.endContainer, this.endOffset) < 0 &&
        comparePoints(p, i + 1, this.startContainer, this.startOffset) > 0
      );
    }
    toString() {
      const { startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo } = this;
      if (sc === ec && sc.nodeType === 3) return sc.data.slice(so, eo);
      const out = [];
      const w = new TreeWalker(this.commonAncestorContainer, 0x4);
      for (let t; (t = w.nextNode()); ) {
        if (t === sc) out.push(t.data.slice(so));
        else if (t === ec) out.push(t.data.slice(0, eo));
        else if (comparePoints(t, 0, sc, so) >= 0 && comparePoints(t, t.length, ec, eo) <= 0)
          out.push(t.data);
      }
      return out.join('');
    }
    getBoundingClientRect() {
      const a = this.commonAncestorContainer;
      return (
        a.nodeType === 1 ? a : (a.parentElement ?? docOf(a).documentElement)
      ).getBoundingClientRect();
    }
    getClientRects() {
      return [this.getBoundingClientRect()];
    }
    detach() {}
  }
  Object.assign(Range, { START_TO_START: 0, START_TO_END: 1, END_TO_END: 2, END_TO_START: 3 });
  Document.prototype.createRange = function () {
    const r = new Range();
    r.startContainer = r.endContainer = this;
    return r;
  };

  const ACCEPT = 1,
    REJECT = 2,
    SKIP = 3;
  class TreeWalker {
    constructor(root, whatToShow = 0xffffffff, filter = null) {
      this.root = this.currentNode = root;
      this.whatToShow = whatToShow;
      this.filter = filter;
    }
    _accept(node) {
      if (!(this.whatToShow & (1 << (node.nodeType - 1)))) return SKIP;
      const f = this.filter;
      if (!f) return ACCEPT;
      return typeof f === 'function' ? f(node) : f.acceptNode(node);
    }
    parentNode() {
      let node = this.currentNode;
      while (node && node !== this.root) {
        node = node.parentNode;
        if (node && this._accept(node) === ACCEPT) return (this.currentNode = node);
      }
      return null;
    }
    _children(first) {
      let node = first ? this.currentNode.firstChild : this.currentNode.lastChild;
      while (node) {
        const result = this._accept(node);
        if (result === ACCEPT) return (this.currentNode = node);
        if (result === SKIP) {
          const child = first ? node.firstChild : node.lastChild;
          if (child) {
            node = child;
            continue;
          }
        }
        while (node) {
          const sibling = first ? node.nextSibling : node.previousSibling;
          if (sibling) {
            node = sibling;
            break;
          }
          const parent = node.parentNode;
          if (!parent || parent === this.root || parent === this.currentNode) return null;
          node = parent;
        }
      }
      return null;
    }
    firstChild() {
      return this._children(true);
    }
    lastChild() {
      return this._children(false);
    }
    _siblings(next) {
      let node = this.currentNode;
      if (node === this.root) return null;
      for (;;) {
        let sibling = next ? node.nextSibling : node.previousSibling;
        while (sibling) {
          node = sibling;
          const result = this._accept(node);
          if (result === ACCEPT) return (this.currentNode = node);
          sibling = next ? node.firstChild : node.lastChild;
          if (result === REJECT || !sibling)
            sibling = next ? node.nextSibling : node.previousSibling;
        }
        node = node.parentNode;
        if (!node || node === this.root || this._accept(node) === ACCEPT) return null;
      }
    }
    nextSibling() {
      return this._siblings(true);
    }
    previousSibling() {
      return this._siblings(false);
    }
    nextNode() {
      let node = this.currentNode,
        result = ACCEPT;
      for (;;) {
        while (result !== REJECT && node.firstChild) {
          node = node.firstChild;
          result = this._accept(node);
          if (result === ACCEPT) return (this.currentNode = node);
        }
        let sibling = null;
        for (let t = node; t; t = t.parentNode) {
          if (t === this.root) return null;
          sibling = t.nextSibling;
          if (sibling) break;
        }
        if (!sibling) return null;
        node = sibling;
        result = this._accept(node);
        if (result === ACCEPT) return (this.currentNode = node);
      }
    }
    previousNode() {
      let node = this.currentNode;
      while (node !== this.root) {
        let sibling = node.previousSibling;
        while (sibling) {
          node = sibling;
          let result = this._accept(node);
          while (result !== REJECT && node.lastChild) {
            node = node.lastChild;
            result = this._accept(node);
          }
          if (result === ACCEPT) return (this.currentNode = node);
          sibling = node.previousSibling;
        }
        if (node === this.root || !node.parentNode) return null;
        node = node.parentNode;
        if (this._accept(node) === ACCEPT) return (this.currentNode = node);
      }
      return null;
    }
  }
  Document.prototype.createTreeWalker = function (root, whatToShow, filter) {
    return new TreeWalker(root, whatToShow, filter);
  };

  // One range per document, kept in JS: Blitz's own text selection is not tied to it yet.
  class Selection {
    constructor() {
      this._r = null;
    }
    get rangeCount() {
      return this._r ? 1 : 0;
    }
    get anchorNode() {
      return this._r?.startContainer ?? null;
    }
    get anchorOffset() {
      return this._r?.startOffset ?? 0;
    }
    get focusNode() {
      return this._r?.endContainer ?? null;
    }
    get focusOffset() {
      return this._r?.endOffset ?? 0;
    }
    get isCollapsed() {
      return !this._r || this._r.collapsed;
    }
    get type() {
      return !this._r ? 'None' : this._r.collapsed ? 'Caret' : 'Range';
    }
    getRangeAt(i) {
      if (i !== 0 || !this._r) throw domError('There is no range at that index', 'IndexSizeError');
      return this._r;
    }
    addRange(r) {
      this._r ??= r;
    }
    removeRange(r) {
      if (this._r === r) this._r = null;
    }
    removeAllRanges() {
      this._r = null;
    }
    empty() {
      this._r = null;
    }
    collapse(node, offset = 0) {
      if (!node) return this.removeAllRanges();
      const r = docOf(node).createRange();
      r.setStart(node, offset);
      this._r = r;
    }
    setBaseAndExtent(anchor, anchorOffset, focus, focusOffset) {
      const r = docOf(anchor).createRange();
      r.setStart(anchor, anchorOffset);
      r.setEnd(focus, focusOffset);
      this._r = r;
    }
    toString() {
      return this._r?.toString() ?? '';
    }
  }
  Document.prototype.getSelection = function () {
    return (this._selection ??= new Selection());
  };

  // ---- Shadow roots ----
  // Blitz has no shadow DOM, so a shadow tree is laid out in place: its root is an element
  // (`blitz-shadow-root`, display: contents) that is its host's first native child, which Blitz
  // styles, lays out and paints. The DOM keeps it apart: a host's children leave it out,
  // queries do not enter it (ops.rs), its parentNode is null, and events cross it to the host,
  // retargeted. Its <style>s set through innerHTML are scoped by rewriting their selectors.
  // Not supported: <slot> (light children render after the shadow tree), adoptedStyleSheets;
  // and the page's styles reach into shadow trees.
  const shadowIds = new Set();
  let shadowCount = 0;
  class ShadowRoot extends DocumentFragment {
    get nextSibling() {
      return null;
    }
    get previousSibling() {
      return null;
    }
    _parentTarget() {
      return this.host;
    }
    get activeElement() {
      return null;
    }
    getElementById(id) {
      const r = n.query(this._id, `#${CSS.escape(String(id))}`);
      return r == null ? null : wrap(r);
    }
    get innerHTML() {
      return Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML').get.call(this);
    }
    set innerHTML(html) {
      const key = this._key;
      html = String(html).replace(
        /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
        (_, open, css, close) => open + scopeCss(css, key) + close,
      );
      n.setInnerHtml(this._id, html);
      if (connectedCustom.size) disconnectCustom();
      if (defs.size && this.isConnected) connectCustom(n.queryAllDeep(this._id, defSelector));
    }
  }
  for (const [proto, names] of [
    [Node.prototype, ['childNodes', 'firstChild', 'lastChild', 'insertBefore', 'removeChild']],
    [
      Element.prototype,
      [
        'children',
        'firstElementChild',
        'lastElementChild',
        'childElementCount',
        'querySelector',
        'querySelectorAll',
        'getElementsByTagName',
        'getElementsByClassName',
        'append',
        'prepend',
        'replaceChildren',
      ],
    ],
  ])
    for (const k of names)
      Object.defineProperty(ShadowRoot.prototype, k, Object.getOwnPropertyDescriptor(proto, k));

  // Replaces a host's children natively, keeping its shadow root as the first native child.
  function keepShadow(el, replace) {
    const r = el._shadow;
    if (r) n.remove(r._id);
    replace();
    if (r) n.insert(el._id, r._id, n.first(el._id));
  }

  // Index of the first of `stops` at nesting depth 0 from `i` (s.length if none), past strings
  // and comments.
  function scan(s, i, stops) {
    let depth = 0;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'") {
        for (i++; i < s.length && s[i] !== c; i++) if (s[i] === '\\') i++;
      } else if (c === '/' && s[i + 1] === '*') {
        const e = s.indexOf('*/', i + 2);
        i = e < 0 ? s.length : e + 1;
      } else if (depth === 0 && stops.includes(c)) return i;
      else if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
    }
    return s.length;
  }
  // A shadow tree's stylesheet scoped to it: `:host` and `:host(X)` select the host, any other
  // top-level selector is put under the shadow root element; nested rules follow their parents.
  function scopeCss(css, key) {
    const host = `[blitz-shadow-host="${key}"]`;
    const root = `[blitz-shadow-root="${key}"] `;
    const scopeSelector = (s) => {
      s = s.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!/^:host(?![-\w])/.test(s)) return root + s;
      const rest = s.slice(5);
      if (rest[0] !== '(') return host + rest;
      const end = scan(rest, 1, ')');
      const inner = rest.slice(1, end).trim();
      const type = /^(\*|[a-zA-Z][-\w]*)?/.exec(inner)[0];
      return type + host + inner.slice(type.length) + rest.slice(end + 1);
    };
    let out = '';
    for (let i = 0; i < css.length; ) {
      const start = i;
      i = scan(css, i, '{;');
      if (i >= css.length || css[i] === ';') {
        out += css.slice(start, i + 1);
        i++;
        continue;
      }
      const prelude = css.slice(start, i);
      const end = scan(css, i + 1, '}');
      const body = css.slice(i + 1, end);
      const p = prelude.trim();
      if (p[0] === '@')
        out += `${prelude}{${/^@(media|supports|container|layer)\b/i.test(p) ? scopeCss(body, key) : body}}`;
      else {
        const selectors = [];
        for (let j = 0; j <= prelude.length; ) {
          const k = scan(prelude, j, ',');
          selectors.push(scopeSelector(prelude.slice(j, k)));
          j = k + 1;
        }
        out += `${selectors.join(', ')} {${body}}`;
      }
      i = end + 1;
    }
    return out;
  }

  // ---- Custom elements ----
  // Autonomous custom elements (no `extends`). An element is upgraded in place when its name is
  // defined while it is in the document, when it is inserted into the document, or by
  // customElements.upgrade(). Reactions run synchronously; a move within the document fires no
  // connected/disconnected. Shadow trees are searched too (they are in the native tree).
  const defs = new Map();
  const defsByCtor = new Map();
  const pendingDefs = new Map();
  let defSelector = '';
  let upgradeTarget = null;
  // Connected custom elements with a disconnectedCallback, checked after each removal.
  const connectedCustom = new Set();
  const domError = (message, name) => Object.assign(new Error(message), { name });
  function reaction(el, cb, ...args) {
    if (typeof el[cb] !== 'function') return;
    try {
      el[cb](...args);
    } catch (e) {
      reportError(e);
    }
  }
  function upgrade(el) {
    if (el._ce || el._ceFailed || n.ns(el._id) !== HTML_NS) return;
    const def = defs.get(n.local(el._id));
    if (!def) return;
    upgradeTarget = el;
    try {
      new def.ctor();
    } catch (e) {
      el._ceFailed = true;
      reportError(e);
      return;
    } finally {
      upgradeTarget = null;
    }
    for (const a of def.observed) {
      const v = el.getAttribute(a);
      if (v !== null) reaction(el, 'attributeChangedCallback', a, null, v);
    }
    if (el.isConnected) connected(el);
  }
  function connected(el) {
    if (typeof el.disconnectedCallback === 'function') connectedCustom.add(el);
    reaction(el, 'connectedCallback');
  }
  // Elements (ids) that just entered the document: upgrade them, or tell the custom ones.
  function connectCustom(ids) {
    for (const id of ids) {
      const el = wrap(id);
      if (el._ce) connected(el);
      else upgrade(el);
    }
  }
  function disconnectCustom() {
    for (const el of connectedCustom) {
      if (el.isConnected) continue;
      connectedCustom.delete(el);
      reaction(el, 'disconnectedCallback');
    }
  }
  const customElements = {
    define(name, ctor) {
      name = String(name);
      if (!/^[a-z][-.0-9_a-z\u00b7\u00c0-\uffff]*$/.test(name) || !name.includes('-'))
        throw domError(`'${name}' is not a valid custom element name`, 'SyntaxError');
      if (typeof ctor !== 'function') throw new TypeError('The constructor is not a function');
      if (defs.has(name) || defsByCtor.has(ctor))
        throw domError(`'${name}' or its constructor is already defined`, 'NotSupportedError');
      const def = { name, ctor, observed: new Set(ctor.observedAttributes ?? []) };
      defs.set(name, def);
      defsByCtor.set(ctor, def);
      defSelector = [...defs.keys()].join(',');
      for (const id of n.queryAllDeep(document._id, name)) upgrade(wrap(id));
      pendingDefs.get(name)?.resolve(ctor);
      pendingDefs.delete(name);
    },
    get(name) {
      return defs.get(String(name))?.ctor;
    },
    getName(ctor) {
      return defsByCtor.get(ctor)?.name ?? null;
    },
    whenDefined(name) {
      name = String(name);
      if (defs.has(name)) return Promise.resolve(defs.get(name).ctor);
      let d = pendingDefs.get(name);
      if (!d) {
        d = {};
        d.promise = new Promise((resolve) => {
          d.resolve = resolve;
        });
        pendingDefs.set(name, d);
      }
      return d.promise;
    },
    upgrade(root) {
      if (!defs.size) return;
      for (const k of root instanceof DocumentFragment ? root.childNodes : [root])
        if (k.nodeType === 1)
          for (const id of [k._id, ...n.queryAllDeep(k._id, defSelector)]) upgrade(wrap(id));
    },
  };

  // ---- Window ----
  const document = wrap(n.root());
  const timers = new Map();
  let nextTimerId = 1;
  function addTimer(fn, ms, args, repeat) {
    const id = nextTimerId++;
    ms = Math.max(0, Number(ms) || 0);
    timers.set(id, { fn, args, due: n.now() + ms, every: repeat ? Math.max(ms, 1) : 0 });
    return id;
  }
  function reportError(e) {
    n.error(e && e.stack ? `${e.message}\n${e.stack}` : String(e));
  }
  const consoleFn =
    (level) =>
    (...a) =>
      n.log(
        level,
        a
          .map((x) =>
            typeof x === 'string'
              ? x
              : x instanceof Error
                ? `${x.name}: ${x.message}${x.stack ? `\n${x.stack}` : ''}`
                : (JSON.stringify(x) ?? String(x)),
          )
          .join(' '),
      );
  // location follows history.pushState/replaceState (Next's router reads it back). Loading
  // another document is not supported: assign/replace/reload only warn.
  let href = n.href;
  const hrefParts = () => {
    const m = /^([a-z][a-z0-9+.-]*:)(?:\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(href) || [];
    const host = m[2] || '';
    return {
      protocol: m[1] || '',
      host,
      pathname: m[3] || '/',
      search: m[4] || '',
      hash: m[5] || '',
    };
  };
  const navigateAway = (url) => console.warn(`location: cannot load another document (${url})`);
  const location = {
    get href() {
      return href;
    },
    set href(url) {
      navigateAway(url);
    },
    toString() {
      return href;
    },
    get protocol() {
      return hrefParts().protocol;
    },
    get host() {
      return hrefParts().host;
    },
    get hostname() {
      return hrefParts().host.replace(/:\d+$/, '');
    },
    get port() {
      return (/:(\d+)$/.exec(hrefParts().host) || [])[1] || '';
    },
    get pathname() {
      return hrefParts().pathname;
    },
    get search() {
      return hrefParts().search;
    },
    get hash() {
      return hrefParts().hash;
    },
    get origin() {
      const p = hrefParts();
      return p.host ? `${p.protocol}//${p.host}` : 'null';
    },
    assign: navigateAway,
    replace: navigateAway,
    reload() {
      navigateAway(href);
    },
  };
  const entries = [{ state: null, href }];
  let entry = 0;
  const setEntry = (state, url) => {
    if (url !== undefined && url !== null) href = new URL(String(url), href).href;
    entries[entry] = { state: state ?? null, href };
  };
  const history = {
    get length() {
      return entries.length;
    },
    get state() {
      return entries[entry].state;
    },
    scrollRestoration: 'auto',
    pushState(state, _title, url) {
      entries.length = ++entry;
      setEntry(state, url);
    },
    replaceState(state, _title, url) {
      setEntry(state, url);
    },
    go(delta = 0) {
      const to = entry + delta;
      if (!delta || to < 0 || to >= entries.length) return;
      entry = to;
      href = entries[to].href;
      setTimeout(() =>
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })),
      );
    },
    back() {
      history.go(-1);
    },
    forward() {
      history.go(1);
    },
  };
  // Observers. MutationObserver never reports; IntersectionObserver reports every target visible
  // once; ResizeObserver reports a target's size on observe and whenever it changes after a layout
  // (`__blitzAfterLayout`, called by the host after it resolves layout).
  class MutationObserver {
    constructor(cb) {
      this._cb = cb;
    }
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  class IntersectionObserver {
    constructor(cb, opts = {}) {
      this._cb = cb;
      this.root = opts.root || null;
      this.rootMargin = opts.rootMargin || '0px';
      this.thresholds = [].concat(opts.threshold ?? 0);
    }
    observe(el) {
      addTimer(
        () => {
          const r = el.getBoundingClientRect();
          this._cb(
            [
              {
                target: el,
                isIntersecting: true,
                intersectionRatio: 1,
                boundingClientRect: r,
                intersectionRect: r,
                rootBounds: null,
                time: n.now(),
              },
            ],
            this,
          );
        },
        0,
        [],
        false,
      );
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  const resizeObservers = new Set();
  class ResizeObserver {
    constructor(cb) {
      this._cb = cb;
      this._targets = new Map();
    }
    observe(el) {
      this._targets.set(el, null);
      resizeObservers.add(this);
      addTimer(() => this._check(), 0, [], false);
    }
    unobserve(el) {
      this._targets.delete(el);
    }
    disconnect() {
      this._targets.clear();
      resizeObservers.delete(this);
    }
    _check() {
      const entries = [];
      for (const [el, last] of this._targets) {
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect();
        if (last && last[0] === r.width && last[1] === r.height) continue;
        this._targets.set(el, [r.width, r.height]);
        const box = [{ inlineSize: r.width, blockSize: r.height }];
        entries.push({
          target: el,
          contentRect: {
            x: 0,
            y: 0,
            width: r.width,
            height: r.height,
            top: 0,
            left: 0,
            right: r.width,
            bottom: r.height,
          },
          borderBoxSize: box,
          contentBoxSize: box,
          devicePixelContentBoxSize: box,
        });
      }
      if (entries.length)
        try {
          this._cb(entries, this);
        } catch (e) {
          reportError(e);
        }
      return entries.length;
    }
  }

  const window = globalThis;
  Object.setPrototypeOf(window, EventTarget.prototype);
  window._parentTarget = () => null;
  // rAF callbacks run together once per frame (16 ms apart), before the host paints; they are
  // not timers, so a page polling with rAF does not hold painting back. Ids share the timers'.
  let frameCallbacks = new Map();
  let lastFrame = -Infinity;
  const raf = (cb) => {
    const id = nextTimerId++;
    frameCallbacks.set(id, cb);
    return id;
  };
  function runFrame(now) {
    const cbs = frameCallbacks;
    frameCallbacks = new Map();
    lastFrame = now;
    for (const cb of cbs.values()) {
      try {
        cb(now);
      } catch (e) {
        reportError(e);
      }
    }
  }
  define(window, {
    window,
    self: window,
    top: window,
    parent: window,
    globalThis: window,
    document,
    location,
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Readest Lite) Blitz QuickJS',
      language: 'en-US',
      languages: ['en-US'],
      platform: 'Linux',
      maxTouchPoints: 1,
      onLine: true,
    },
    history,
    customElements,
    ShadowRoot,
    Range,
    TreeWalker,
    DOMRect,
    DOMRectReadOnly,
    Selection,
    getSelection: () => document.getSelection(),
    NodeFilter: {
      FILTER_ACCEPT: 1,
      FILTER_REJECT: 2,
      FILTER_SKIP: 3,
      SHOW_ALL: 0xffffffff,
      SHOW_ELEMENT: 0x1,
      SHOW_ATTRIBUTE: 0x2,
      SHOW_TEXT: 0x4,
      SHOW_CDATA_SECTION: 0x8,
      SHOW_PROCESSING_INSTRUCTION: 0x40,
      SHOW_COMMENT: 0x80,
      SHOW_DOCUMENT: 0x100,
      SHOW_DOCUMENT_TYPE: 0x200,
      SHOW_DOCUMENT_FRAGMENT: 0x400,
    },
    performance: { now: () => n.now(), timeOrigin: Date.now() - n.now(), mark() {}, measure() {} },
    console: {
      log: consoleFn('log'),
      info: consoleFn('info'),
      debug: consoleFn('debug'),
      warn: consoleFn('warn'),
      error: consoleFn('error'),
      trace() {},
      group() {},
      groupEnd() {},
      time() {},
      timeEnd() {},
    },
    setTimeout: (fn, ms, ...args) => addTimer(fn, ms, args, false),
    setInterval: (fn, ms, ...args) => addTimer(fn, ms, args, true),
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
    requestAnimationFrame: raf,
    cancelAnimationFrame: (id) => frameCallbacks.delete(id),
    requestIdleCallback: (cb) =>
      addTimer(() => cb({ didTimeout: false, timeRemaining: () => 10 }), 1, [], false),
    cancelIdleCallback: (id) => timers.delete(id),
    // The native Promise, captured now: a Promise polyfill that schedules through queueMicrotask
    // (core-js does) would otherwise call itself forever.
    queueMicrotask: (
      (P) => (cb) =>
        P.resolve().then(cb)
    )(Promise),
    reportError,
    // Computed values from Stylo, read on access (pseudo-elements not supported).
    getComputedStyle: (el) => {
      const get = (name) => (el && el._id !== -1 ? n.computed(el._id, String(name)) : '');
      const api = {
        getPropertyValue: get,
        getPropertyPriority: () => '',
        item: () => '',
        length: 0,
        cssText: '',
      };
      return new Proxy(api, {
        get(t, k) {
          if (typeof k !== 'string' || k in t) return t[k];
          return get(k === 'cssFloat' ? 'float' : kebab(k));
        },
        set() {
          return true;
        },
      });
    },
    matchMedia: (q) => ({
      matches: false,
      media: q,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    get innerWidth() {
      return n.viewport()[0];
    },
    get innerHeight() {
      return n.viewport()[1];
    },
    get devicePixelRatio() {
      return n.viewport()[2];
    },
    get screen() {
      const [w, h] = n.viewport();
      return {
        width: w,
        height: h,
        availWidth: w,
        availHeight: h,
        colorDepth: 24,
        pixelDepth: 24,
        orientation: {
          type: w > h ? 'landscape-primary' : 'portrait-primary',
          angle: 0,
          addEventListener() {},
          removeEventListener() {},
        },
      };
    },
    MutationObserver,
    IntersectionObserver,
    ResizeObserver,
    // Called by the host after a layout: delivers ResizeObserver changes; returns how many fired.
    __blitzAfterLayout() {
      let k = pendingSheets.size ? checkSheets() : 0;
      if (loadingFrames.size) k += checkFrames();
      for (const o of resizeObservers) k += o._check();
      return k;
    },
    scrollX: 0,
    scrollY: 0,
    pageXOffset: 0,
    pageYOffset: 0,
    scrollTo() {},
    scrollBy() {},
    scroll() {},
    CSS: { escape: (s) => String(s).replace(/([^\w-])/g, '\\$1'), supports: () => false },
    Event,
    UIEvent,
    MouseEvent,
    PointerEvent,
    KeyboardEvent,
    InputEvent,
    FocusEvent,
    CustomEvent,
    PopStateEvent,
    PromiseRejectionEvent,
    EventTarget,
    Node,
    CharacterData,
    Text,
    Comment,
    DocumentFragment,
    Element,
    HTMLElement,
    Document,
    SVGElement,
    HTMLInputElement,
    HTMLTextAreaElement,
    HTMLSelectElement,
    HTMLOptionElement,
    HTMLButtonElement,
    HTMLAnchorElement,
    HTMLImageElement,
    HTMLIFrameElement,
    HTMLFormElement,
    HTMLDivElement,
    HTMLSpanElement,
    HTMLParagraphElement,
    __blitzDispatch(chain, type, bubbles, cancelable, init) {
      const p = init.kind === 'pointer';
      const cls = type.startsWith('pointer')
        ? PointerEvent
        : p
          ? MouseEvent
          : init.kind === 'key'
            ? KeyboardEvent
            : init.kind === 'input'
              ? InputEvent
              : Event;
      const ev = new cls(type, { ...init, bubbles, cancelable, composed: true, view: window });
      ev.isTrusted = true;
      const path = chain.map(wrap);
      if (path[path.length - 1] !== document) path.push(document);
      path.push(window);
      anyCalled = false;
      dispatch(path, ev);
      return (ev.defaultPrevented ? 1 : 0) | (ev._stop ? 2 : 0) | (anyCalled ? 4 : 0);
    },
    // Runs due timers; returns the next due time (ms on the document clock) or -1.
    __blitzTimers(now) {
      const due = [...timers].filter(([, t]) => t.due <= now).sort((a, b) => a[1].due - b[1].due);
      for (const [id, t] of due) {
        if (!timers.has(id)) continue;
        if (t.every) t.due = now + t.every;
        else timers.delete(id);
        try {
          if (typeof t.fn === 'function') t.fn(...t.args);
          else (0, eval)(String(t.fn));
        } catch (e) {
          reportError(e);
        }
      }
      if (frameCallbacks.size && now >= lastFrame + 16) runFrame(now);
      return window.__blitzNextTimer();
    },
    __blitzNextTimer() {
      let m = -1;
      for (const t of timers.values()) if (m < 0 || t.due < m) m = t.due;
      return m;
    },
    // When the next frame's rAF callbacks are due (-1: none queued).
    __blitzNextFrame() {
      return frameCallbacks.size ? Math.max(lastFrame + 16, 0) : -1;
    },
    // Set by the document around each parse-time script (id < 0: none).
    __blitzCurrentScript(id) {
      document._script = id < 0 ? null : id;
      if (id >= 0) wrap(id)._started = true;
    },
    __blitzLoaded() {
      document._ready = 'interactive';
      document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
      document._ready = 'complete';
      window.dispatchEvent(new Event('load'));
    },
  });
  define(window, moreElements);
})();
