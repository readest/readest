// node --test apps/readest-lite/src/*.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../crates/tauri-runtime-blitz/src/dom-parser.js';

const OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata>
    <dc:title id="t">Fish &amp; Chips &#x2014; A&#160;Novel</dc:title>
    <meta refines="#t" property="title-type">main</meta>
  </metadata>
  <manifest>
    <item id="c1" href="xhtml/one.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;

const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');

test('elements get their namespace from the default and prefixed declarations', () => {
  const doc = parse(OPF);
  assert.equal(doc.documentElement.namespaceURI, 'http://www.idpf.org/2007/opf');
  const [title] = doc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title');
  assert.equal(title.localName, 'title');
  assert.equal(title.prefix, 'dc');
  assert.equal(doc.lookupNamespaceURI('dc'), 'http://purl.org/dc/elements/1.1/');
});

test('text decodes named and numeric entities', () => {
  const [title] = parse(OPF).getElementsByTagName('dc:title');
  assert.equal(title.textContent, 'Fish & Chips — A Novel');
});

test('attribute selectors, ids and siblings', () => {
  const doc = parse(OPF);
  assert.equal(doc.querySelector('item[properties="nav"]').getAttribute('href'), 'nav.xhtml');
  assert.equal(doc.getElementById('c1').nextElementSibling.id, 'nav');
  assert.equal(doc.querySelectorAll('item, itemref').length, 3);
  const meta = doc.querySelector('meta[refines]');
  assert.equal(meta.parentElement.localName, 'metadata');
  assert.equal(meta.closest('package'), doc.documentElement);
});

test('whitespace between inline elements is kept (nav labels)', () => {
  const doc = parse(
    '<nav><ol><li><a href="a.xhtml"><span>One</span> <i>Two</i></a></li></ol></nav>',
  );
  assert.equal(doc.querySelector('a').textContent, 'One Two');
});

test('attributes stay editable', () => {
  const el = parse('<a x="1"/>').documentElement;
  el.setAttribute('x', '2');
  el.setAttribute('y', '3');
  el.removeAttribute('x');
  assert.equal(el.getAttribute('x'), null);
  assert.equal(el.getAttribute('y'), '3');
});
