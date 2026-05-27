import type { Transformer } from './types';

const extractParens = (text: string): { open: string; content: string; close: string } => {
  let open = '';
  let close = '';
  let content = text;
  const openParens = ['（', '(', '〔', '［', '【'];
  const closeParens = ['）', ')', '〕', '］', '】'];
  for (let i = 0; i < openParens.length; i++) {
    if (content.startsWith(openParens[i]!)) {
      open = openParens[i]!;
      content = content.slice(open.length);
      break;
    }
  }
  for (let i = 0; i < closeParens.length; i++) {
    if (content.endsWith(closeParens[i]!)) {
      close = closeParens[i]!;
      content = content.slice(0, -close.length);
      break;
    }
  }
  return { open, content, close };
};

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// Tags that are safe to keep — they don't change font size or layout dimensions.
const SAFE_TAGS = new Set([
  'b',
  'i',
  'em',
  'strong',
  'u',
  's',
  'strike',
  'del',
  'ins',
  'mark',
  'span',
  'a',
]);

// Style properties that affect font size — strip these from inline styles.
const SIZE_STYLE_PROPS =
  /font-size|font-family|line-height|display|position|margin|padding|width|height/i;

/**
 * Strip tags that affect font size/layout, keep safe styling tags.
 * Returns { html: sanitized HTML string, text: plain text for measurement }.
 */
const sanitizeInnerHTML = (innerHtml: string): { html: string; text: string } => {
  // Use a temporary element to parse the HTML properly
  const tmp = document.createElement('div');
  tmp.innerHTML = innerHtml;

  const processNode = (node: Node): { html: string; text: string } => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent || '';
      return {
        html: t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        text: t,
      };
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return { html: '', text: '' };
    }

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // Recursively process children
    let childHtml = '';
    let childText = '';
    for (const child of Array.from(el.childNodes)) {
      const r = processNode(child);
      childHtml += r.html;
      childText += r.text;
    }

    // Tags that change font size or disrupt layout — unwrap (keep children only)
    if (!SAFE_TAGS.has(tag)) {
      return { html: childHtml, text: childText };
    }

    // For safe tags, keep the element but strip size-affecting style properties
    let attrs = '';
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'style') {
        // Filter out size-affecting properties
        const filtered = attr.value
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s && !SIZE_STYLE_PROPS.test(s.split(':')[0] || ''))
          .join('; ');
        if (filtered) {
          attrs += ` style="${escapeAttr(filtered)}"`;
        }
      } else if (attr.name === 'class' || attr.name === 'id' || attr.name === 'lang') {
        attrs += ` ${attr.name}="${escapeAttr(attr.value)}"`;
      }
      // Skip other attributes (href, tabindex, etc.)
    }

    return {
      html: `<${tag}${attrs}>${childHtml}</${tag}>`,
      text: childText,
    };
  };

  let html = '';
  let text = '';
  for (const child of Array.from(tmp.childNodes)) {
    const r = processNode(child);
    html += r.html;
    text += r.text;
  }

  return { html: html.trim(), text: text.trim() };
};

const WARICHU_SPAN_REGEX =
  /<span\s+[^>]*class\s*=\s*["'][^"']*\bwarichuu?\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
const WARICHU_ELEMENT_REGEX = /<warichu(?:\s[^>]*)?>([\s\S]*?)<\/warichu>/gi;

export const warichuTransformer: Transformer = {
  name: 'warichu',
  transform: async (ctx) => {
    let result = ctx.content;
    if (!/warichuu?|<warichu/i.test(result)) return result;

    const replace = (_: string, innerText: string) => {
      const { html, text } = sanitizeInnerHTML(innerText);
      if (!text) return '';
      const { open, content, close } = extractParens(text);
      // Also extract parens from the HTML version, keeping tags intact
      const htmlParens = extractHtmlParens(html, open, close);
      return (
        `<span class="warichu-pending"` +
        ` data-open="${escapeAttr(open)}"` +
        ` data-close="${escapeAttr(close)}"` +
        ` data-text="${escapeAttr(content)}"` +
        ` data-html="${escapeAttr(htmlParens)}"` +
        `>${open}${content}${close}</span>`
      );
    };

    result = result.replace(WARICHU_SPAN_REGEX, replace);
    result = result.replace(WARICHU_ELEMENT_REGEX, replace);
    return result;
  },
};

/**
 * Remove the open/close parens from the HTML string, preserving internal tags.
 * We strip the first `open.length` visible characters from the start and
 * the last `close.length` visible characters from the end.
 */
function extractHtmlParens(html: string, open: string, close: string): string {
  let result = html;
  if (open) {
    result = stripVisibleChars(result, open.length, 'start');
  }
  if (close) {
    result = stripVisibleChars(result, close.length, 'end');
  }
  return result;
}

/**
 * Strip `count` visible (non-tag) characters from the start or end of an HTML string.
 */
function stripVisibleChars(html: string, count: number, from: 'start' | 'end'): string {
  if (count <= 0) return html;

  if (from === 'end') {
    // Reverse approach: strip from the end
    const reversed = reverseHtml(html);
    const stripped = stripVisibleChars(reversed, count, 'start');
    return reverseHtml(stripped);
  }

  // Strip `count` visible characters from the start
  let stripped = 0;
  let i = 0;
  while (i < html.length && stripped < count) {
    if (html[i] === '<') {
      // Skip over tag
      const end = html.indexOf('>', i);
      if (end === -1) break;
      i = end + 1;
    } else if (html[i] === '&') {
      // HTML entity — counts as 1 visible char
      const semi = html.indexOf(';', i);
      if (semi !== -1 && semi - i < 10) {
        i = semi + 1;
      } else {
        i++;
      }
      stripped++;
    } else {
      i++;
      stripped++;
    }
  }
  return html.slice(i);
}

/** Reverse an HTML string by reversing visible characters while keeping tags in place. */
function reverseHtml(html: string): string {
  // Simple approach: extract segments of [tag | char], reverse the chars
  const segments: { type: 'tag' | 'char'; value: string }[] = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) {
        segments.push({ type: 'char', value: html[i]! });
        i++;
      } else {
        segments.push({ type: 'tag', value: html.slice(i, end + 1) });
        i = end + 1;
      }
    } else if (html[i] === '&') {
      const semi = html.indexOf(';', i);
      if (semi !== -1 && semi - i < 10) {
        segments.push({ type: 'char', value: html.slice(i, semi + 1) });
        i = semi + 1;
      } else {
        segments.push({ type: 'char', value: html[i]! });
        i++;
      }
    } else {
      segments.push({ type: 'char', value: html[i]! });
      i++;
    }
  }
  // Reverse: keep tags at their relative positions but reverse char order
  const chars = segments.filter((s) => s.type === 'char').reverse();
  let ci = 0;
  return segments
    .map((s) => {
      if (s.type === 'tag') return s.value;
      return chars[ci++]?.value || '';
    })
    .join('');
}
