// Feature test for surfacing Calibre custom columns (readest#4811).
//
// Calibre embeds its per-library custom columns ("user metadata") into the
// OPF when polishing / sending books, and the Readest calibre plugin embeds
// them on push. Two encodings exist (see calibre's opf2.py / opf3.py):
//
//   OPF 2: one <meta name="calibre:user_metadata:#label" content="{json}"/>
//          element per column
//   OPF 3: a single <meta property="calibre:user_metadata"> element whose
//          text is a JSON dict of all columns keyed by "#label"
//
// The per-column JSON carries the value in `#value#` (series index in
// `#extra#`); datetimes are wrapped as
// {"__class__": "datetime.datetime", "__value__": "<ISO>"} and unset dates
// are 0101-01-01. Embedded files include EVERY column of the library, so
// empty values must be dropped at parse time.
import { describe, expect, it } from 'vitest';

import { parseEpubMetadataFromXML } from 'foliate-js/epub.js';
import { BookMetadata } from '@/libs/document';

// foliate-js is plain JS; its inferred metadata type does not carry the
// dynamically attached calibreColumns field (same cast as tauriEpubBridge.ts).
const parse = parseEpubMetadataFromXML as unknown as (xml: string) => { metadata: BookMetadata };

const opf2 = (metas: string) => `<?xml version='1.0' encoding='utf-8'?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:identifier id="uuid_id" opf:scheme="uuid">11111111-2222-3333-4444-555555555555</dc:identifier>
    <dc:language>en</dc:language>
    ${metas}
  </metadata>
  <manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c"/></spine>
</package>`;

const opf3 = (metas: string) => `<?xml version='1.0' encoding='utf-8'?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0" prefix="calibre: https://calibre-ebook.com">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:identifier id="id">urn:uuid:11111111-2222-3333-4444-555555555555</dc:identifier>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
    ${metas}
  </metadata>
  <manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c"/></spine>
</package>`;

const RECOMMENDS_OPF2 = `<meta name="calibre:user_metadata:#recommends" content='{"table": "custom_column_5", "column": "value", "datatype": "text", "is_multiple": ",", "kind": "field", "name": "Recommends", "search_terms": ["#recommends"], "label": "recommends", "colnum": 5, "display": {"is_names": false}, "is_custom": true, "is_category": true, "#value#": ["TOD", "Grandma"], "#extra#": null}'/>`;

describe('Calibre custom columns from OPF 2 legacy metas', () => {
  it('parses per-column metas into metadata.calibreColumns', () => {
    const xml = opf2(`${RECOMMENDS_OPF2}
      <meta name="calibre:user_metadata:#myrating" content='{"datatype": "rating", "name": "My Rating", "label": "myrating", "#value#": 8, "#extra#": null}'/>`);
    const { metadata } = parse(xml);
    expect(metadata.calibreColumns).toEqual([
      {
        label: 'recommends',
        name: 'Recommends',
        datatype: 'text',
        value: ['TOD', 'Grandma'],
      },
      { label: 'myrating', name: 'My Rating', datatype: 'rating', value: 8 },
    ]);
  });

  it('drops empty-valued columns (embedded files carry every library column)', () => {
    const xml = opf2(`${RECOMMENDS_OPF2}
      <meta name="calibre:user_metadata:#emptytext" content='{"datatype": "text", "name": "Empty Text", "label": "emptytext", "#value#": null}'/>
      <meta name="calibre:user_metadata:#emptylist" content='{"datatype": "text", "name": "Empty List", "label": "emptylist", "is_multiple": ",", "#value#": []}'/>
      <meta name="calibre:user_metadata:#emptystr" content='{"datatype": "comments", "name": "Empty Str", "label": "emptystr", "#value#": ""}'/>
      <meta name="calibre:user_metadata:#zerorating" content='{"datatype": "rating", "name": "Zero Rating", "label": "zerorating", "#value#": 0}'/>`);
    const { metadata } = parse(xml);
    expect(metadata.calibreColumns?.map((c) => c.label)).toEqual(['recommends']);
  });

  it('ignores malformed column JSON and non-column calibre metas', () => {
    const xml = opf2(`<meta name="calibre:user_metadata:#broken" content='{not json'/>
      <meta name="calibre:user_metadata:nothash" content='{"datatype": "text", "name": "No Hash", "#value#": "x"}'/>
      ${RECOMMENDS_OPF2}`);
    const { metadata } = parse(xml);
    expect(metadata.calibreColumns?.map((c) => c.label)).toEqual(['recommends']);
  });

  it('leaves calibreColumns undefined when no user metadata is embedded', () => {
    const { metadata } = parse(opf2(''));
    expect(metadata.calibreColumns).toBeUndefined();
  });
});

describe('Calibre custom columns from the OPF 3 property meta', () => {
  it('parses the single user_metadata dict, unwrapping datetime values', () => {
    const dict = JSON.stringify({
      '#read': { name: 'Read', label: 'read', datatype: 'bool', '#value#': true, '#extra#': null },
      '#lastread': {
        name: 'Last Read',
        label: 'lastread',
        datatype: 'datetime',
        '#value#': { __class__: 'datetime.datetime', __value__: '2024-03-01T10:00:00+00:00' },
        '#extra#': null,
      },
      '#saga': {
        name: 'My Saga',
        label: 'saga',
        datatype: 'series',
        '#value#': 'Cool Saga',
        '#extra#': 2.0,
      },
      '#solo': {
        name: 'Solo Tag',
        label: 'solo',
        datatype: 'text',
        is_multiple: ',',
        '#value#': ['Only'],
        '#extra#': null,
      },
      '#undated': {
        name: 'Undated',
        label: 'undated',
        datatype: 'datetime',
        '#value#': { __class__: 'datetime.datetime', __value__: '0101-01-01T00:00:00+00:00' },
        '#extra#': null,
      },
      '#unset': { name: 'Unset', label: 'unset', datatype: 'text', '#value#': null },
    });
    const xml = opf3(`<meta property="calibre:user_metadata">${dict}</meta>`);
    const { metadata } = parse(xml);
    expect(metadata.calibreColumns).toEqual([
      { label: 'read', name: 'Read', datatype: 'bool', value: true },
      {
        label: 'lastread',
        name: 'Last Read',
        datatype: 'datetime',
        value: '2024-03-01T10:00:00+00:00',
      },
      { label: 'saga', name: 'My Saga', datatype: 'series', value: 'Cool Saga', extra: 2 },
      // a single-element multi-value column must stay an array
      { label: 'solo', name: 'Solo Tag', datatype: 'text', value: ['Only'] },
    ]);
  });

  it('prefers the OPF 3 dict over legacy per-column metas, like calibre does', () => {
    const dict = JSON.stringify({
      '#new': { name: 'New', label: 'new', datatype: 'text', '#value#': 'from-opf3' },
    });
    const xml = opf3(`<meta property="calibre:user_metadata">${dict}</meta>
      <meta name="calibre:user_metadata:#old" content='{"datatype": "text", "name": "Old", "label": "old", "#value#": "from-opf2"}'/>`);
    const { metadata } = parse(xml);
    expect(metadata.calibreColumns?.map((c) => c.label)).toEqual(['new']);
  });
});
