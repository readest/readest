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
      for (let t = this; t; t = t._parentTarget()) path.push(t);
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
  // path: target first, then ancestors (and document, window). Returns defaultPrevented.
  function dispatch(path, ev) {
    ev.target = path[0];
    ev._path = path;
    const prev = globalThis.event;
    globalThis.event = ev;
    for (let i = path.length - 1; i > 0 && !ev._stop; i--) {
      ev.eventPhase = 1;
      invoke(path[i], ev, true);
    }
    if (!ev._stop) {
      ev.eventPhase = 2;
      invoke(path[0], ev, true);
      if (!ev._stopNow) invoke(path[0], ev, false);
    }
    if (ev.bubbles)
      for (let i = 1; i < path.length && !ev._stop; i++) {
        ev.eventPhase = 3;
        invoke(path[i], ev, false);
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
      return p || (this.nodeType === 9 ? window : null);
    }
    get nodeType() {
      return n.kind(this._id);
    }
    get ownerDocument() {
      return this.nodeType === 9 ? null : document;
    }
    get parentNode() {
      const p = n.parent(this._id);
      return p == null ? null : wrap(p);
    }
    get parentElement() {
      const p = this.parentNode;
      return p && p.nodeType === 1 ? p : null;
    }
    get childNodes() {
      return n.children(this._id).map(wrap);
    }
    get firstChild() {
      const c = n.first(this._id);
      return c == null ? null : wrap(c);
    }
    get lastChild() {
      const c = n.last(this._id);
      return c == null ? null : wrap(c);
    }
    get nextSibling() {
      const c = n.sibling(this._id, 1);
      return c == null ? null : wrap(c);
    }
    get previousSibling() {
      const c = n.sibling(this._id, -1);
      return c == null ? null : wrap(c);
    }
    get isConnected() {
      let t = this;
      while (t.parentNode) t = t.parentNode;
      return t.nodeType === 9;
    }
    hasChildNodes() {
      return n.first(this._id) != null;
    }
    getRootNode() {
      let t = this;
      while (t.parentNode) t = t.parentNode;
      return t;
    }
    contains(other) {
      for (let t = other; t; t = t.parentNode) if (t === this) return true;
      return false;
    }
    compareDocumentPosition(other) {
      return this.contains(other) ? 20 : other.contains(this) ? 10 : 4;
    }
    appendChild(c) {
      return this.insertBefore(c, null);
    }
    insertBefore(c, ref) {
      if (c instanceof DocumentFragment) {
        for (const k of c._kids.splice(0)) this.insertBefore(k, ref);
        return c;
      }
      n.insert(this._id, c._id, ref ? ref._id : null);
      if (c.nodeType === 1 && !c._started && c.isConnected) {
        const tag = n.local(c._id);
        if (tag === 'script') startScript(c);
        else if (tag === 'link') watchSheet(c);
      }
      return c;
    }
    removeChild(c) {
      n.remove(c._id);
      return c;
    }
    replaceChild(nc, oc) {
      this.insertBefore(nc, oc);
      this.removeChild(oc);
      return oc;
    }
    remove() {
      n.remove(this._id);
    }
    get textContent() {
      return this.nodeType === 9 ? null : n.text(this._id);
    }
    set textContent(v) {
      n.setText(this._id, v == null ? '' : String(v));
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
    // Shadow roots are detached fragments: their content is kept but never rendered.
    attachShadow(init = {}) {
      const r = new DocumentFragment();
      r.host = this;
      r.mode = init.mode;
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
      if (k === 'style') {
        this.style.cssText = v;
      }
      n.setAttr(this._id, k, String(v));
    }
    removeAttribute(k) {
      k = this._an(k);
      if (k === 'style' && this._style) this._style.cssText = '';
      n.delAttr(this._id, k);
    }
    hasAttribute(k) {
      return n.getAttr(this._id, this._an(k)) != null;
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
      return n.attrNames(this._id);
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
            if (k === 'length') return n.attrNames(el._id).length;
            if (k === Symbol.iterator)
              return function* () {
                for (const name of n.attrNames(el._id)) yield attr(name);
              };
            if (k === 'item') return (i) => attr(n.attrNames(el._id)[i]) || null;
            if (k === 'getNamedItem')
              return (name) => (el.hasAttribute(name) ? attr(el._an(name)) : null);
            if (k === 'removeNamedItem')
              return (name) => {
                const a = attr(el._an(name));
                el.removeAttribute(name);
                return a;
              };
            if (typeof k === 'string' && /^[0-9]+$/.test(k)) return attr(n.attrNames(el._id)[+k]);
            return undefined;
          },
          has(_, k) {
            return (
              k === 'length' ||
              (typeof k === 'string' && /^[0-9]+$/.test(k) && +k < n.attrNames(el._id).length)
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
      n.setInnerHtml(this._id, String(html));
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
      const p = this.parentNode || document;
      return p.querySelectorAll(s).includes(this);
    }
    closest(s) {
      for (let e = this; e && e.nodeType === 1; e = e.parentNode) if (e.matches(s)) return e;
      return null;
    }
    getBoundingClientRect() {
      const [x, y, width, height] = n.rect(this._id);
      return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
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
      return this.offsetWidth;
    }
    get clientHeight() {
      return this.offsetHeight;
    }
    get scrollTop() {
      return 0;
    }
    set scrollTop(_) {}
    get scrollLeft() {
      return 0;
    }
    set scrollLeft(_) {}
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
        this.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    prepend(...nodes) {
      const f = this.firstChild;
      for (const c of nodes)
        this.insertBefore(typeof c === 'string' ? document.createTextNode(c) : c, f);
    }
  }
  class HTMLElement extends Element {
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
  class HTMLIFrameElement extends HTMLElement {}
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
    get defaultView() {
      return window;
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
      return wrap(n.createElement(HTML_NS, String(tag).toLowerCase()));
    }
    createElementNS(ns, q) {
      return wrap(n.createElement(ns || HTML_NS, String(q).replace(/^.*:/, '')));
    }
    createTextNode(s) {
      return wrap(n.createText(String(s)));
    }
    createComment(s) {
      return wrap(n.createComment(String(s)));
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
      const get = (name) => (el && el._id >= 0 ? n.computed(el._id, String(name)) : '');
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
      const ev = new cls(type, { ...init, bubbles, cancelable, view: window });
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
