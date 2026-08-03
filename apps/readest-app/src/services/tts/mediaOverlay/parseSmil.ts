// EPUB 3 Media Overlays SMIL parsing.
//
// A Media Overlay is a SMIL document per spine section whose <par> elements
// each pair a text fragment (`chapter.xhtml#id`) with a clip of a narration
// audio file. Those pairs are the publisher's own text-to-audio sync points,
// which is why read-along playback needs no alignment of its own.
//
// foliate-js parses SMIL too (`MediaOverlay` in epub.js), but only for its
// standalone player: it flattens pars with a `getElementsByTagName` sweep and
// keeps nothing this side needs. We parse here instead so playback can run
// through Readest's own TTS machinery, and so <seq> nesting survives (the hook
// skippability would need).

export interface SmilPar {
  // Zip path of the text document, with the fragment stripped.
  textHref: string;
  // Fragment identifier of the narrated element.
  textId: string;
  audioHref: string;
  // Seconds into the audio file.
  clipBegin: number;
  clipEnd: number;
}

const NUMBER_RE = /^\d*\.?\d+$/;
const TIMECOUNT_RE = /^(\d*\.?\d+)(h|min|ms|s)?$/;

const UNIT_SECONDS: Record<string, number> = { h: 3600, min: 60, s: 1, ms: 0.001 };

// SMIL 3.0 clock values, as EPUB Media Overlays restricts them: `hh:mm:ss.mmm`,
// `mm:ss.mmm`, or a timecount with an `h`/`min`/`s`/`ms` unit (bare = seconds).
export const parseSmilClock = (value: string | null | undefined): number | undefined => {
  if (!value) return undefined;
  const str = value.trim();
  if (!str) return undefined;

  if (str.includes(':')) {
    const parts = str.split(':');
    if (parts.length !== 2 && parts.length !== 3) return undefined;
    if (!parts.every((part) => NUMBER_RE.test(part))) return undefined;
    const numbers = parts.map(Number);
    return numbers.length === 3
      ? numbers[0]! * 3600 + numbers[1]! * 60 + numbers[2]!
      : numbers[0]! * 60 + numbers[1]!;
  }

  const match = TIMECOUNT_RE.exec(str);
  if (!match) return undefined;
  return Number(match[1]) * UNIT_SECONDS[match[2] ?? 's']!;
};

// Zip entry names are raw, so a resolved href has to be decoded to match one —
// the same treatment foliate's `resolveURL`/`decodeURIPath` pair gives manifest
// hrefs, keeping `/` and `#` encoded so they can't turn into separators.
const decodePath = (path: string): string => {
  try {
    return decodeURIComponent(path.replace(/%(2f|23)/gi, '%25$1'));
  } catch {
    return path;
  }
};

// Resolve `href` against the SMIL file's own zip path, splitting off the
// fragment. The base has to be a valid URL, so borrow a throwaway origin.
const resolveHref = (href: string, base: string): { path: string; fragment: string } | null => {
  try {
    const url = new URL(href, `https://invalid.invalid/${base}`);
    return { path: decodePath(url.pathname.slice(1)), fragment: decodePath(url.hash.slice(1)) };
  } catch {
    return null;
  }
};

// SMIL documents normally declare the SMIL namespace as their default, but some
// omit it; matching on localName covers both, as foliate's childGetter does.
const childByName = (el: Element, name: string): Element | undefined =>
  [...el.children].find((child) => child.localName === name);

const collectPars = (parent: Element, base: string, out: SmilPar[]): void => {
  for (const child of parent.children) {
    if (child.localName === 'seq') {
      collectPars(child, base, out);
      continue;
    }
    if (child.localName !== 'par') continue;

    const textSrc = childByName(child, 'text')?.getAttribute('src');
    const audio = childByName(child, 'audio');
    if (!textSrc || !audio) continue;

    const audioSrc = audio.getAttribute('src');
    if (!audioSrc) continue;

    const text = resolveHref(textSrc, base);
    const audioTarget = resolveHref(audioSrc, base);
    // A par with no fragment can't be located in the document, so it can't be
    // highlighted or navigated to.
    if (!text?.fragment || !audioTarget?.path) continue;

    const clipBegin = parseSmilClock(audio.getAttribute('clipBegin')) ?? 0;
    const clipEnd = parseSmilClock(audio.getAttribute('clipEnd'));
    if (clipEnd === undefined || clipEnd <= clipBegin) continue;

    out.push({
      textHref: text.path,
      textId: text.fragment,
      audioHref: audioTarget.path,
      clipBegin,
      clipEnd,
    });
  }
};

// Ordered narration units for one section. `smilHref` is the SMIL file's zip
// path, which every href inside it resolves against.
export const parseSmil = (xml: string, smilHref: string): SmilPar[] => {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return [];
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return [];

  const root = doc.documentElement;
  if (!root) return [];

  const pars: SmilPar[] = [];
  collectPars(childByName(root, 'body') ?? root, smilHref, pars);
  return pars;
};
