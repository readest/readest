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

// A chapter as epub.js's loadReplaced sees it: parse, rewrite links, serialize for the iframe.
const CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet href="old.css" type="text/css"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xlink="http://www.w3.org/1999/xlink">
<head><title>One</title><style>p > a { content: "&amp;" }</style><link rel="stylesheet" href="a.css"/></head>
<body><!-- note --><p epub:type="x">Fish &amp; &lt;chips&gt;<br/><a id="n1"/></p>
<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="i.png"/></svg></body>
</html>`;

test('a chapter keeps its processing instructions, doctype and comments, and they can be replaced', () => {
  const doc = new DOMParser().parseFromString(CHAPTER, 'application/xhtml+xml');
  const pi = doc.firstChild;
  assert.ok(pi instanceof ProcessingInstruction);
  assert.equal(pi.target, 'xml-stylesheet');
  assert.equal(pi.data, 'href="old.css" type="text/css"');
  pi.replaceWith(doc.createProcessingInstruction(pi.target, 'href="new.css" type="text/css"'));
  assert.equal(doc.firstChild.data, 'href="new.css" type="text/css"');
  assert.equal(doc.firstChild.nextSibling.nodeType, 10);
  assert.equal(doc.documentElement.localName, 'html');
});

test('namespace-wildcard and :not() selectors, setAttributeNS and textContent edits', () => {
  const doc = new DOMParser().parseFromString(CHAPTER, 'application/xhtml+xml');
  const XLINK = 'http://www.w3.org/1999/xlink';
  const [image] = doc.querySelectorAll('[*|href]:not([href])');
  assert.equal(image.localName, 'image');
  assert.equal(doc.querySelectorAll('[*|href]').length, 2);
  image.setAttributeNS(XLINK, 'href', 'blob:x/1');
  assert.equal(image.getAttributeNS(XLINK, 'href'), 'blob:x/1');
  const style = doc.querySelector('style');
  style.textContent = `${style.textContent} b { color: red }`;
  assert.equal(style.textContent, 'p > a { content: "&" } b { color: red }');
});

test('XMLSerializer writes well-formed XML that the HTML parser reads the same way', () => {
  const doc = new DOMParser().parseFromString(CHAPTER, 'application/xhtml+xml');
  doc.querySelector('link').setAttribute('href', 'blob:x/"2"');
  assert.equal(
    new XMLSerializer().serializeToString(doc),
    `<?xml-stylesheet href="old.css" type="text/css"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xlink="http://www.w3.org/1999/xlink">
<head><title>One</title><style>p > a { content: "&amp;" }</style><link rel="stylesheet" href="blob:x/&quot;2&quot;"/></head>
<body><!-- note --><p epub:type="x">Fish &amp; &lt;chips><br/><a id="n1"></a></p>
<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="i.png"/></svg></body>
</html>`,
  );
});

test('text/html: head and body, void elements, upper-case tag names', () => {
  const doc = new DOMParser().parseFromString(
    '<link rel="stylesheet" href="f.css"><style>a{}</style><p>a<br>b</p>',
    'text/html',
  );
  assert.deepEqual(
    [...doc.head.children].map((e) => e.tagName),
    ['LINK', 'STYLE'],
  );
  assert.deepEqual(
    [...doc.body.children].map((e) => e.tagName),
    ['P'],
  );
  assert.equal(doc.body.firstElementChild.childNodes.length, 3);
  assert.equal(doc.documentElement.namespaceURI, 'http://www.w3.org/1999/xhtml');
});
