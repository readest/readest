import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { strToU8, Zip, ZipDeflate, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as CFI from 'foliate-js/epubcfi.js';
import { isCfiInLocation } from '@/utils/cfi';

// CarPlay with the phone locked (#7566): iOS suspends the reader WebView, so
// Read Aloud starts in Swift. ColdEpubText.swift reads the EPUB's text and
// gives each spoken chunk the CFI the reader resumes from. It only needs
// Foundation and Compression, so it compiles and runs on macOS; elsewhere
// (Linux CI) there is no swiftc and the suite is skipped.
const SOURCE = resolve(
  process.cwd(),
  'src-tauri/plugins/tauri-plugin-native-tts/ios/Sources/ColdEpubText.swift',
);

const DRIVER = `import Foundation
let args = CommandLine.arguments
if args[1] == "--resume" {
  let cfi = ColdEpubText.resumeCfi(
    location: args[2].isEmpty ? nil : args[2], ttsLocation: args[3].isEmpty ? nil : args[3])
  print(cfi ?? "")
  exit(0)
}
let speech = try ColdEpubText.read(
  url: URL(fileURLWithPath: args[1]), resumeCfi: args.count > 2 ? args[2] : nil)
let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
print(String(data: try encoder.encode(speech), encoding: .utf8)!)
`;

const hasSwiftc =
  process.platform === 'darwin' && spawnSync('xcrun', ['--find', 'swiftc']).status === 0;

interface Speech {
  startSection: number;
  language: string | null;
  hasMediaOverlays: boolean;
  segments: { text: string; sectionIndex: number; cfi: string }[];
}

const CONTAINER = `<?xml version="1.0"?><!DOCTYPE container SYSTEM "https://example.invalid/container.dtd"><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
const OPF = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:language>fr-CA</dc:language></metadata><manifest><item id="one" href="one%20a.xhtml" media-type="application/xhtml+xml"/><item id="two" href="text/../two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`;
const sectionOne = (firstText: string) =>
  `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter One</h1><p>${firstText}</p></body></html>`;
const SECTION_TWO = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head><body><h1>Chapter Two</h1><p>Second section text.</p></body></html>`;

let dir = '';
let binary = '';
let count = 0;

const epubFiles = (firstText: string, opf = OPF): Record<string, string> => ({
  mimetype: 'application/epub+zip',
  'META-INF/container.xml': CONTAINER,
  'OEBPS/content.opf': opf,
  'OEBPS/one a.xhtml': sectionOne(firstText),
  'OEBPS/two.xhtml': SECTION_TWO,
});

// zipSync stores `mimetype` and deflates the rest, with sizes in the local
// headers.
const createEpub = (firstText = 'First section text.', opf = OPF, stored = false) => {
  const files = epubFiles(firstText, opf);
  const path = join(dir, `book-${count++}.epub`);
  writeFileSync(
    path,
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, text]) => [
          name,
          [strToU8(text), { level: stored || name === 'mimetype' ? 0 : 6 }],
        ]),
      ),
    ),
  );
  return path;
};

// The streaming writer leaves the local header sizes at 0 and puts them in a
// data descriptor after each entry, as many EPUB tools do.
const createStreamedEpub = () => {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  for (const [name, text] of Object.entries(epubFiles('First section text.'))) {
    const entry = new ZipDeflate(name, { level: 6 });
    zip.add(entry);
    entry.push(strToU8(text), true);
  }
  zip.end();
  const path = join(dir, `book-${count++}.epub`);
  writeFileSync(path, Buffer.concat(chunks));
  return path;
};

// Rewrites a size the central directory declares for `entry`: the decoded
// size (offset 24) or the stored, compressed one (offset 20).
const declareSize = (
  epub: string,
  entry: string,
  size: (actual: number) => number,
  offset = 24,
) => {
  const bytes = readFileSync(epub);
  const name = Buffer.from(entry);
  for (let i = bytes.length - 46; i >= 0; i--) {
    if (
      bytes.readUInt32LE(i) === 0x02014b50 &&
      bytes.subarray(i + 46, i + 46 + name.length).equals(name)
    ) {
      bytes.writeUInt32LE(size(bytes.readUInt32LE(i + offset)), i + offset);
      writeFileSync(epub, bytes);
      return epub;
    }
  }
  throw new Error(`${entry} not in ${epub}`);
};

// Makes the entry's DEFLATE stream invalid: a first block of reserved type.
const corruptStream = (epub: string, entry: string) => {
  const bytes = readFileSync(epub);
  const name = Buffer.from(entry);
  for (let i = 0; i + 30 < bytes.length; i++) {
    if (
      bytes.readUInt32LE(i) === 0x04034b50 &&
      bytes.subarray(i + 30, i + 30 + name.length).equals(name)
    ) {
      bytes[i + 30 + bytes.readUInt16LE(i + 26) + bytes.readUInt16LE(i + 28)] = 0x07;
      writeFileSync(epub, bytes);
      return epub;
    }
  }
  throw new Error(`${entry} not in ${epub}`);
};

const readError = (epub: string) => {
  const run = spawnSync(binary, [epub], { encoding: 'utf-8' });
  return run.status === 0 ? 'read without error' : run.stderr;
};

const read = (epub: string, cfi?: string): Speech => {
  const run = spawnSync(binary, cfi ? [epub, cfi] : [epub], { encoding: 'utf-8' });
  if (run.status !== 0) throw new Error(run.stderr || `exit ${run.status}`);
  return JSON.parse(run.stdout) as Speech;
};

const sectionText = (epub: string) => read(epub).segments.filter((s) => s.sectionIndex === 0);

// Resolve a CFI the way the reader does (foliate-js), against the section
// parsed as XHTML, and return the text that follows it.
const textAtCfi = (xhtml: string, cfi: string) => {
  const doc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
  const parts = CFI.parse(cfi);
  (parts.parent ?? parts).shift();
  const range = CFI.toRange(doc, parts) as Range;
  const after = doc.createRange();
  after.setStart(range.startContainer, range.startOffset);
  after.setEndAfter(doc.body.lastChild!);
  return after.toString().replace(/\s+/g, ' ').trim();
};

describe.skipIf(!hasSwiftc)('ColdEpubText.swift', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'cold-epub-'));
    const driver = join(dir, 'main.swift');
    writeFileSync(driver, DRIVER);
    binary = join(dir, 'cold-epub');
    const build = spawnSync('xcrun', ['swiftc', '-o', binary, SOURCE, driver], {
      encoding: 'utf-8',
    });
    if (build.status !== 0) throw new Error(build.stderr);
  }, 180_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reads the spine from the saved CFI section', () => {
    const speech = read(createEpub(), 'epubcfi(/6/4!/4/2/1:0)');
    expect(speech.startSection).toBe(1);
    expect(speech.segments.map((s) => s.text)).toEqual(['Chapter Two', 'Second section text.']);
    expect(speech.segments.every((s) => s.sectionIndex === 1)).toBe(true);
    expect(speech.segments[0]!.cfi).toBe('epubcfi(/6/4!/4/2/1:0)');
    expect(speech.segments[1]!.cfi).toBe('epubcfi(/6/4!/4/4/1:0)');
  });

  it('reads the whole book with no saved position, and its language', () => {
    const speech = read(createEpub());
    expect(speech.startSection).toBe(0);
    expect(speech.language).toBe('fr-CA');
    expect(speech.segments.map((s) => s.text)).toEqual([
      'Chapter One',
      'First section text.',
      'Chapter Two',
      'Second section text.',
    ]);
  });

  it('reads entries whose sizes are in data descriptors', () => {
    expect(read(createStreamedEpub()).segments.map((s) => s.text)).toEqual([
      'Chapter One',
      'First section text.',
      'Chapter Two',
      'Second section text.',
    ]);
  });

  it('resumes at the saved text offset inside a section', () => {
    const speech = read(createEpub(), 'epubcfi(/6/4!/4/4/1:7)');
    expect(speech.startSection).toBe(1);
    expect(speech.segments.map((s) => s.text)).toEqual(['section text.']);
  });

  it('resumes at the start of a saved range', () => {
    const speech = read(createEpub(), 'epubcfi(/6/4!/4/4,/1:7,/1:14)');
    expect(speech.segments.map((s) => s.text)).toEqual(['section text.']);
  });

  it('bounds long chunks', () => {
    const speech = read(createEpub('A'.repeat(5_100)));
    expect(speech.segments.every((s) => s.text.length <= 2_500)).toBe(true);
  });

  it('resumes at each paragraph rather than the original saved position', () => {
    const epub = createEpub();
    const paragraph = read(epub, 'epubcfi(/6/4!/4/2/1:0)').segments.at(-1)!;
    expect(read(epub, paragraph.cfi).segments[0]!.text).toBe(paragraph.text);
  });

  it('resumes at each long chunk after whitespace normalization and inline markup', () => {
    const body = `  <em>Intro.</em>  ${'word   '.repeat(900)}<![CDATA[Ending.]]>`;
    const epub = createEpub(body);
    const chunks = sectionText(epub).slice(1);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(read(epub, chunk.cfi).segments[0]!.text).toBe(chunk.text);
    }
  });

  it('splits a long run of words between words', () => {
    const chunks = sectionText(createEpub('word '.repeat(1_000))).slice(1);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(2_500);
      expect(chunk.text).toMatch(/^word( word)*$/);
    }
  });

  it('refuses an entry that declares more than it may decode', () => {
    const epub = declareSize(createEpub(), 'OEBPS/one a.xhtml', () => 0x7fff_fff0);
    expect(readError(epub)).toMatch(/too large/);
  });

  it('refuses a stored entry larger than it may read', () => {
    // Only the stored size: the decoded size has its own case above.
    const epub = createEpub('First section text.', OPF, true);
    expect(readError(declareSize(epub, 'OEBPS/one a.xhtml', () => 0x7fff_fff0, 20))).toMatch(
      /too large/,
    );
  });

  it('refuses a chapter declared empty that has text', () => {
    const epub = declareSize(createEpub(), 'OEBPS/one a.xhtml', () => 0);
    expect(readError(epub)).toMatch(/Corrupt zip entry/);
  });

  it('refuses a corrupt stream declared empty', () => {
    const epub = declareSize(createEpub(), 'OEBPS/one a.xhtml', () => 0);
    expect(readError(corruptStream(epub, 'OEBPS/one a.xhtml'))).toMatch(/Corrupt zip entry/);
  });

  it('reads a chapter that is really empty', () => {
    const files = epubFiles('', OPF.replace('one%20a.xhtml', 'empty.xhtml'));
    files['OEBPS/empty.xhtml'] = '';
    const empty = join(dir, `book-${count++}.epub`);
    writeFileSync(
      empty,
      zipSync(
        Object.fromEntries(
          Object.entries(files).map(([name, text]) => [
            name,
            [strToU8(text), { level: name === 'mimetype' ? 0 : 6 }],
          ]),
        ),
      ),
    );
    expect(read(empty).segments.map((s) => s.text)).toEqual([
      'Chapter Two',
      'Second section text.',
    ]);
  });

  it('refuses an entry that decodes to more than it declares', () => {
    const epub = declareSize(createEpub(), 'OEBPS/one a.xhtml', (actual) => actual - 10);
    expect(readError(epub)).toMatch(/Corrupt zip entry/);
  });

  it('tells whether the book has recorded narration (Media Overlays)', () => {
    expect(read(createEpub()).hasMediaOverlays).toBe(false);
    const narrated = OPF.replace(
      '<item id="one" href="one%20a.xhtml"',
      '<item id="one" media-overlay="one-smil" href="one%20a.xhtml"',
    );
    expect(read(createEpub('First section text.', narrated)).hasMediaOverlays).toBe(true);
    // Only spine items count, as for the reader (mediaOverlay/index.ts).
    const offSpine = OPF.replace(
      '</manifest>',
      '<item id="extra" media-overlay="extra-smil" href="extra.xhtml" media-type="application/xhtml+xml"/></manifest>',
    );
    expect(read(createEpub('First section text.', offSpine)).hasMediaOverlays).toBe(false);
  });

  it('resumes at offsets inside an unbroken text node', () => {
    const epub = createEpub('A'.repeat(2500) + 'B'.repeat(2500) + 'C'.repeat(100));
    const chunks = sectionText(epub).slice(1);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(read(epub, chunk.cfi).segments[0]!.text).toBe(chunk.text);
    }
  });

  it('keeps CFI offsets across adjacent text and CDATA nodes', () => {
    const body = 'Before.\n<![CDATA[Middle.\n]]>After.';
    const epub = createEpub(body);
    const chunks = sectionText(epub).slice(1);
    expect(chunks.map((c) => c.text)).toEqual(['Before.', 'Middle.', 'After.']);
    expect(chunks[1]!.cfi).toBe('epubcfi(/6/2!/2/4/1:8)');
    expect(chunks[2]!.cfi).toBe('epubcfi(/6/2!/2/4/1:16)');
    for (const chunk of chunks) {
      expect(read(epub, chunk.cfi).segments[0]!.text).toBe(chunk.text);
    }
  });

  // jsdom's Range gives a CDATA node no length, so this check leaves CDATA
  // out; foliate itself treats CDATA as text (the cases above).
  it('gives every chunk a CFI the reader resolves to the same text', () => {
    const body = `One <b>two</b> three.<br/>Four <i>five <u>six</u></i> seven. ${'word   '.repeat(900)}<em>End.</em> Last.`;
    const chunks = sectionText(createEpub(body));
    expect(chunks.length).toBeGreaterThan(4);
    for (const chunk of chunks) {
      expect(textAtCfi(sectionOne(body), chunk.cfi).startsWith(chunk.text)).toBe(true);
    }
  });

  it('still reads a section that uses HTML entities', () => {
    const texts = sectionText(createEpub('Hello&nbsp;world &amp; more.')).map((s) => s.text);
    expect(texts.join(' ')).toMatch(/Hello\s+world & more\./);
  });

  // The reader resumes Read Aloud at ttsLocation only when it lies on the
  // saved page (useTTSControl), otherwise at the page itself; a cold start
  // must pick the same place.
  it('resumes where the reader would: ttsLocation only when it is on the saved page', () => {
    const page = 'epubcfi(/6/4!/4/2,/1:0,/3:100)';
    const cases: [string, string][] = [
      [page, 'epubcfi(/6/4!/4/2/1:20)'],
      [page, 'epubcfi(/6/4!/4/2/3:100)'],
      [page, 'epubcfi(/6/4!/4/2,/1:20,/1:40)'],
      [page, 'epubcfi(/6/4[chap]!/4/2/1:5)'],
      [page, 'epubcfi(/6/4!/4/2/3:101)'],
      [page, 'epubcfi(/6/4!/4/6/1:0)'],
      [page, 'epubcfi(/6/2!/4/2/1:5)'],
      [page, 'epubcfi(/6/14!/4/2/1:5)'],
      [page, 'epubcfi(/6/4!/4/2/1:0)'],
      [page, 'epubcfi(/6/4!/4/2/1)'],
      ['epubcfi(/6/4!/4/2/1:7)', 'epubcfi(/6/4!/4/2/1:7)'],
      ['epubcfi(/6/4!/4/2/1:7)', 'epubcfi(/6/4!/4/2/1:9)'],
      [page, ''],
      ['', 'epubcfi(/6/4!/4/2/1:20)'],
      ['', ''],
    ];
    for (const [location, ttsLocation] of cases) {
      const expected =
        location && ttsLocation
          ? isCfiInLocation(ttsLocation, location)
            ? ttsLocation
            : location
          : location || ttsLocation;
      const run = spawnSync(binary, ['--resume', location, ttsLocation], { encoding: 'utf-8' });
      expect(run.status, run.stderr).toBe(0);
      expect([location, ttsLocation, run.stdout.trim()]).toEqual([location, ttsLocation, expected]);
    }
  });
});
