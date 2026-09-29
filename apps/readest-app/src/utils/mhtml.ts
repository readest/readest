// Unpack an MHTML web archive (Chrome/Edge "Save as… Webpage, Single File",
// IE/Word .mht): a MIME multipart/related message whose first text/html part
// is the page and whose other parts are its resources, each addressed by its
// original URL (Content-Location) or by a cid: reference (Content-ID). The
// page is handed to makeHtmlBook and its images inlined as data: URIs, the
// shape a SingleFile save already has (issue #6413).

export interface MhtmlPage {
  html: string;
  // The page's own URL, which relative image URLs resolve against.
  location: string;
  // Absolute URL or cid: reference -> image data: URI.
  resources: Map<string, string>;
}

type Part = { headers: Map<string, string>; body: string };

// One char per byte, so base64 and quoted-printable decode byte-exactly.
const toBinaryString = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return s;
};

const parseHeaders = (block: string) => {
  const headers = new Map<string, string>();
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0)
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
};

const splitHeaders = (text: string): Part => {
  const m = /\r?\n\r?\n/.exec(text);
  if (!m) return { headers: parseHeaders(text), body: '' };
  return { headers: parseHeaders(text.slice(0, m.index)), body: text.slice(m.index + m[0].length) };
};

const param = (value: string | undefined, name: string) =>
  value
    ?.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i'))
    ?.slice(1)
    .find(Boolean);

const decodeBody = ({ headers, body }: Part) => {
  const encoding = headers.get('content-transfer-encoding')?.toLowerCase();
  if (encoding === 'base64') return atob(body.replace(/\s+/g, ''));
  if (encoding === 'quoted-printable') {
    return body
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  }
  return body;
};

const resolveUrl = (url: string, base?: string) => {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
};

export const parseMhtml = (bytes: Uint8Array): MhtmlPage | null => {
  // An archive opens with a message header line; a plain HTML page never does,
  // so only a header gets the whole file converted and its header block read.
  if (!/^[!-9;-~]+:/.test(toBinaryString(bytes.subarray(0, 256)))) return null;
  const top = splitHeaders(toBinaryString(bytes));
  const contentType = top.headers.get('content-type');
  const boundary = param(contentType, 'boundary');
  if (!/^multipart\/related\b/i.test(contentType ?? '') || !boundary) return null;

  // A delimiter is "--boundary" at the start of a line (RFC 2046), and the
  // line break before it belongs to the delimiter, not to the part.
  const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = `\r\n${top.body}`
    .split(new RegExp(`\\r?\\n--${escaped}(?=--|[ \\t]*\\r?\\n|$)`))
    .slice(1)
    .filter((chunk) => !chunk.startsWith('--'))
    .map((chunk) => splitHeaders(chunk.replace(/^[ \t]*\r?\n/, '')));

  const page = parts.find((p) => /^text\/html\b/i.test(p.headers.get('content-type') ?? ''));
  if (!page) throw new Error('The MHTML archive has no HTML page');

  // Relative part URLs, the page's included, resolve against the message's
  // own location (RFC 2557), which also stands in for a page without one.
  const messageLocation = top.headers.get('content-location') || undefined;
  const pageLocation = page.headers.get('content-location');
  const location = pageLocation
    ? resolveUrl(pageLocation, messageLocation)
    : (messageLocation ?? '');
  const partBase = messageLocation || location || undefined;
  const resources = new Map<string, string>();
  for (const part of parts) {
    // Only images are kept: makeHtmlBook drops the stylesheets, fonts and frames.
    const type = (part.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!type.startsWith('image/')) continue;
    const base64 =
      part.headers.get('content-transfer-encoding')?.toLowerCase() === 'base64'
        ? part.body.replace(/\s+/g, '')
        : btoa(decodeBody(part));
    const dataUri = `data:${type};base64,${base64}`;
    const partLocation = part.headers.get('content-location');
    if (partLocation) resources.set(resolveUrl(partLocation, partBase), dataUri);
    const cid = part.headers.get('content-id')?.replace(/^<|>$/g, '');
    if (cid) resources.set(`cid:${cid}`, dataUri);
  }

  const charset = param(page.headers.get('content-type'), 'charset') || 'utf-8';
  const pageBytes = Uint8Array.from(decodeBody(page), (c) => c.charCodeAt(0));
  let html: string;
  try {
    html = new TextDecoder(charset).decode(pageBytes);
  } catch {
    html = new TextDecoder().decode(pageBytes);
  }
  return { html, location, resources };
};

export const inlineMhtmlImages = (doc: Document, { location, resources }: MhtmlPage) => {
  for (const img of Array.from(doc.querySelectorAll('img[src]'))) {
    const src = img.getAttribute('src')!;
    const dataUri = resources.get(src) ?? resources.get(resolveUrl(src, location || undefined));
    if (!dataUri) continue;
    img.setAttribute('src', dataUri);
    // The archive holds the one image the page showed, not the srcset's others.
    img.removeAttribute('srcset');
  }
};
