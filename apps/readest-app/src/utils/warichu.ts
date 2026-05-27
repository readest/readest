/**
 * Warichu (割注/夹注) — Runtime Layout
 *
 * Each chunk is placed directly in the parent container (not nested in
 * a wrapper). All nodes belonging to the same warichu share a unique
 * data-warichu-id. The first node (.warichu-head) also carries the
 * full text and paren data for relayout.
 */

let warichuIdCounter = 0;

// Per-document cache: skip relayout when column-width hasn't changed.
const envCache = new WeakMap<Document, { columnSize: number; columnStride: number }>();

export function layoutWarichu(doc: Document): void {
  const pendingElements = Array.from(doc.querySelectorAll('.warichu-pending'));
  if (!pendingElements.length) return;

  const env = getEnv(doc);
  if (!env) return;

  // Update cache so subsequent relayout calls can detect changes
  envCache.set(doc, { columnSize: env.columnSize, columnStride: env.columnStride });

  for (const el of pendingElements) {
    const span = el as HTMLElement;
    const { text, html, openParen, closeParen } = getData(span);
    if (!text) continue;

    const wid = 'w' + warichuIdCounter++;

    // Measure at the pending span's current visible position
    const firstChunkChars = measureFirstChunk(span, env, openParen);

    // Build nodes
    const nodes = buildNodes(
      doc,
      wid,
      text,
      html,
      openParen,
      closeParen,
      firstChunkChars,
      env.fullLineChars,
    );

    // Replace the pending span with the array of nodes
    span.replaceWith(...nodes);
  }
}

/**
 * Re-layout warichu after resize — but only if column-width actually changed.
 */
export function relayoutWarichu(doc: Document): void {
  const heads = Array.from(doc.querySelectorAll('.warichu-head'));
  if (!heads.length) return;

  const env = getEnv(doc);
  if (!env) return;

  // Skip relayout if column-width hasn't changed since last layout
  const cached = envCache.get(doc);
  if (cached && cached.columnSize === env.columnSize && cached.columnStride === env.columnStride) {
    return;
  }
  envCache.set(doc, { columnSize: env.columnSize, columnStride: env.columnStride });

  for (const h of heads) {
    const head = h as HTMLElement;
    const wid = head.dataset['warichuId'] || '';
    const text = head.dataset['text'] || '';
    const html = head.dataset['html'] || '';
    const openParen = head.dataset['open'] || '';
    const closeParen = head.dataset['close'] || '';
    if (!wid || !text) continue;

    const parentEl = head.parentElement;
    if (!parentEl) continue;

    // Find all nodes with this warichu id
    const allNodes = Array.from(parentEl.querySelectorAll(`[data-warichu-id="${wid}"]`));

    // Keep the head node, remove the rest. We'll re-insert after the head.
    for (let i = 1; i < allNodes.length; i++) {
      allNodes[i]!.remove();
    }

    // Clear head content to make it a tiny inline probe for measurement
    head.className = 'warichu-head';
    head.removeAttribute('style');
    head.textContent = '\u200B';
    head.style.display = 'inline';
    head.style.fontSize = '0.5em';
    head.style.lineHeight = '1.1';

    const firstChunkChars = measureFirstChunk(head, env, openParen);

    // Build new nodes (the first will replace the head)
    const nodes = buildNodes(
      doc,
      wid,
      text,
      html,
      openParen,
      closeParen,
      firstChunkChars,
      env.fullLineChars,
    );

    // Insert all new nodes after the head, then remove the head
    const refNode = head.nextSibling;
    for (const node of nodes) {
      parentEl.insertBefore(node, refNode);
    }
    head.remove();
  }
}

// ── Core measurement ──────────────────────────────────────────────────

function measureFirstChunk(el: HTMLElement, env: LayoutEnv, _openParen: string): number {
  const { isVertical } = env;
  const doc = el.ownerDocument;
  const parent = el.parentNode;
  if (!parent) return env.fullLineChars;

  // Insert warichu-chunk probes one by one before the warichu element.
  // When a chunk lands in a different column (its cross-axis position shifts),
  // we know the previous chunk was the last that fit in the current column.
  const testChunks: HTMLElement[] = [];
  let fitChars = 0;
  let firstCrossPos: number | null = null;

  for (let n = 1; n <= Math.ceil(env.fullLineChars / CHARS_PER_CHUNK) + 2; n++) {
    const chunk = doc.createElement('span');
    chunk.className = 'warichu-chunk';
    chunk.style.visibility = 'hidden';
    const l1 = doc.createElement('span');
    l1.className = 'warichu-line';
    l1.textContent = '国'.repeat(CHARS_PER_CHUNK);
    chunk.appendChild(l1);
    chunk.appendChild(doc.createElement('br'));
    const l2 = doc.createElement('span');
    l2.className = 'warichu-line';
    l2.textContent = '国'.repeat(CHARS_PER_CHUNK);
    chunk.appendChild(l2);

    parent.insertBefore(chunk, el);
    testChunks.push(chunk);

    const rect = chunk.getBoundingClientRect();
    // Cross-axis: in vertical-rl columns are side by side horizontally,
    // so cross-axis = left. In horizontal-tb, cross-axis = top.
    const crossPos = isVertical ? rect.left : rect.top;

    if (firstCrossPos === null) {
      firstCrossPos = crossPos;
    } else if (Math.abs(crossPos - firstCrossPos) > 2) {
      // Jumped to a different column
      fitChars = (n - 1) * CHARS_PER_CHUNK;
      break;
    }
    fitChars = n * CHARS_PER_CHUNK;
  }

  // Clean up
  for (const c of testChunks) c.remove();

  return Math.max(2, fitChars);
}

// ── Build nodes ───────────────────────────────────────────────────────

// Maximum characters per line in a single physical chunk. Keeping this
// small ensures each inline-block chunk has a tiny inline-axis size,
// allowing CSS column boundaries to break between adjacent chunks
// instead of pushing an oversized block to the next column.
const CHARS_PER_CHUNK = 2;

// Characters that must not appear at the start of a line (kinsoku).
const KINSOKU_NO_START = new Set([
  '，',
  '。',
  '、',
  '）',
  '）',
  '」',
  '』',
  '】',
  '〕',
  '］',
  '！',
  '？',
  '：',
  '；',
  '．',
  '‥',
  '…',
  '・',
]);

function buildNodes(
  doc: Document,
  wid: string,
  text: string,
  html: string,
  openParen: string,
  closeParen: string,
  firstChunkChars: number,
  fullLineChars: number,
): Node[] {
  const nodes: Node[] = [];
  const totalChars = text.length;
  const useHtml = html.length > 0;

  // Open paren
  if (openParen) {
    const op = doc.createElement('span');
    op.className = 'warichu-open';
    op.dataset['warichuId'] = wid;
    op.textContent = openParen;
    nodes.push(op);
  }

  // ── Phase 1: generate (t1, t2) pairs grouped by segment (= column) ──
  // Track both plain text positions and corresponding HTML slices.
  const allPairs: { t1: string; t2: string; h1: string; h2: string }[] = [];
  const segBounds: { start: number; end: number }[] = [];

  let off = 0;
  let isFirstSeg = true;
  while (off < totalChars) {
    const maxPerLine = isFirstSeg ? firstChunkChars : fullLineChars;
    isFirstSeg = false;
    const remaining = totalChars - off;
    const segLen = remaining <= maxPerLine * 2 ? remaining : maxPerLine * 2;
    const segText = text.slice(off, off + segLen);

    const mid = Math.ceil(segText.length / 2);
    const topLine = segText.slice(0, mid);
    const botLine = segText.slice(mid);

    // Get corresponding HTML slices
    const topHtml = useHtml ? sliceHtml(html, off, off + mid) : '';
    const botHtml = useHtml ? sliceHtml(html, off + mid, off + segLen) : '';

    off += segLen;

    const segStart = allPairs.length;
    const pairCount = Math.max(topLine.length, botLine.length);
    for (let ci = 0; ci < pairCount; ci += CHARS_PER_CHUNK) {
      const t1 = topLine.slice(ci, ci + CHARS_PER_CHUNK);
      const t2 = botLine.slice(ci, ci + CHARS_PER_CHUNK);
      const h1 = useHtml ? sliceHtmlRelative(topHtml, topLine, ci, ci + CHARS_PER_CHUNK) : '';
      const h2 = useHtml ? sliceHtmlRelative(botHtml, botLine, ci, ci + CHARS_PER_CHUNK) : '';
      if (t1 || t2) {
        allPairs.push({ t1, t2, h1, h2 });
      }
    }
    segBounds.push({ start: segStart, end: allPairs.length - 1 });
  }

  // ── Phase 2: kinsoku at column (segment) boundaries ──
  for (let si = 0; si < segBounds.length; si++) {
    const { start, end } = segBounds[si]!;
    const first = allPairs[start];
    if (!first) continue;

    if (first.t1.length > 0 && KINSOKU_NO_START.has(first.t1[0]!) && si > 0) {
      const prevEnd = segBounds[si - 1]!.end;
      const ch = first.t1[0]!;
      allPairs[prevEnd]!.t2 += ch;
      allPairs[prevEnd]!.h2 += ch;
      first.t1 = first.t1.slice(1);
      first.h1 = removeFirstVisibleChar(first.h1);
    }

    if (first.t2.length > 0 && KINSOKU_NO_START.has(first.t2[0]!)) {
      if (start === end && first.t1.length > 1) {
        // Single-chunk segment: moving the kinsoku char to the end of t1
        // would leave t2 empty (e.g. "長東"/"。" → "長東。"/"").
        // Instead pull the last char of t1 down so the kinsoku char is
        // no longer at the start of t2.  e.g. "長東"/"。" → "長"/"東。".
        const lastChar = first.t1[first.t1.length - 1]!;
        first.t1 = first.t1.slice(0, -1);
        first.t2 = lastChar + first.t2;
        if (first.h1) {
          first.h1 = removeLastVisibleChar(first.h1);
        }
        first.h2 = lastChar + first.h2;
      } else {
        // Multi-chunk segment or t1 has only 1 char: push the kinsoku
        // char to the end of the last chunk's top line.
        const ch = first.t2[0]!;
        allPairs[end]!.t1 += ch;
        allPairs[end]!.h1 += ch;
        first.t2 = first.t2.slice(1);
        first.h2 = removeFirstVisibleChar(first.h2);
      }
    }
  }

  // ── Phase 3: create DOM nodes ──
  let isFirstHead = true;
  for (const { t1, t2, h1, h2 } of allPairs) {
    if (!t1 && !t2) continue;

    const chunk = doc.createElement('span');
    chunk.className = 'warichu-chunk';
    chunk.dataset['warichuId'] = wid;

    if (isFirstHead) {
      chunk.classList.add('warichu-head');
      chunk.dataset['text'] = text;
      chunk.dataset['html'] = html;
      chunk.dataset['open'] = openParen;
      chunk.dataset['close'] = closeParen;
      isFirstHead = false;
    }

    const l1 = doc.createElement('span');
    l1.className = 'warichu-line';
    if (useHtml && h1) {
      l1.innerHTML = h1;
    } else {
      l1.textContent = t1 || '\u200B';
    }
    chunk.appendChild(l1);

    chunk.appendChild(doc.createElement('br'));
    const l2 = doc.createElement('span');
    l2.className = 'warichu-line';
    if (useHtml && h2) {
      l2.innerHTML = h2;
    } else {
      l2.textContent = t2 || '\u200B';
    }
    chunk.appendChild(l2);

    nodes.push(chunk);
  }

  // Close paren
  if (closeParen) {
    const cp = doc.createElement('span');
    cp.className = 'warichu-close';
    cp.dataset['warichuId'] = wid;
    cp.textContent = closeParen;
    nodes.push(cp);
  }

  return nodes;
}

// ── Helpers ───────────────────────────────────────────────────────────

interface LayoutEnv {
  isVertical: boolean;
  oneCharInline: number;
  columnSize: number;
  columnStride: number; // column-width + column-gap
  fullLineChars: number;
  marginStart: number;
}

function getData(el: HTMLElement) {
  return {
    text: el.dataset['text'] || '',
    html: el.dataset['html'] || '',
    openParen: el.dataset['open'] || '',
    closeParen: el.dataset['close'] || '',
  };
}

function getEnv(doc: Document): LayoutEnv | null {
  const win = doc.defaultView;
  if (!win) return null;

  const bodyStyle = win.getComputedStyle(doc.body);
  const htmlStyle = win.getComputedStyle(doc.documentElement);
  const writingMode = bodyStyle.writingMode || htmlStyle.writingMode || 'horizontal-tb';
  const isVertical = writingMode.includes('vertical');

  const probe = doc.createElement('span');
  probe.style.fontSize = '0.5em';
  probe.style.lineHeight = '1.1';
  probe.style.visibility = 'hidden';
  probe.style.position = 'absolute';
  probe.style.whiteSpace = 'nowrap';
  probe.textContent = '国';
  doc.body.appendChild(probe);
  const probeRect = probe.getBoundingClientRect();
  const oneCharInline = isVertical ? probeRect.height : probeRect.width;
  doc.body.removeChild(probe);

  const rootStyle = win.getComputedStyle(doc.documentElement);
  let columnSize = 0;

  const cwProp = rootStyle.getPropertyValue('column-width');
  if (cwProp && cwProp !== 'auto') {
    columnSize = parseFloat(cwProp);
  }
  if (!columnSize || columnSize <= 0) {
    if (isVertical) {
      const v = rootStyle.getPropertyValue('--available-height');
      if (v) columnSize = parseFloat(v);
    } else {
      const v = rootStyle.getPropertyValue('--available-width');
      if (v) columnSize = parseFloat(v);
    }
  }
  if (!columnSize || columnSize <= 0) {
    return null;
  }

  // Read column-gap for stride calculation
  const cgProp = rootStyle.getPropertyValue('column-gap');
  const columnGap = cgProp ? parseFloat(cgProp) : 0;
  const columnStride = columnSize + (columnGap > 0 ? columnGap : 0);

  let marginStart = 0;
  if (isVertical) {
    const v = rootStyle.getPropertyValue('--page-margin-top');
    if (v) marginStart = parseFloat(v);
  } else {
    const v = rootStyle.getPropertyValue('--page-margin-left');
    if (v) marginStart = parseFloat(v);
  }

  // Measure fullLineChars by placing actual warichu-chunk inline-blocks
  // and detecting when one jumps to a different column (cross-axis shift).
  const testContainer = doc.createElement('div');
  testContainer.style.visibility = 'hidden';
  doc.body.appendChild(testContainer);

  let fullLineChars = 2;
  const maxChunks = Math.ceil(columnSize / oneCharInline / CHARS_PER_CHUNK) + 2;
  let firstCrossPos: number | null = null;

  for (let n = 1; n <= maxChunks; n++) {
    const chunk = doc.createElement('span');
    chunk.className = 'warichu-chunk';
    const l1 = doc.createElement('span');
    l1.className = 'warichu-line';
    l1.textContent = '国'.repeat(CHARS_PER_CHUNK);
    chunk.appendChild(l1);
    chunk.appendChild(doc.createElement('br'));
    const l2 = doc.createElement('span');
    l2.className = 'warichu-line';
    l2.textContent = '国'.repeat(CHARS_PER_CHUNK);
    chunk.appendChild(l2);
    testContainer.appendChild(chunk);

    const rect = chunk.getBoundingClientRect();
    const crossPos = isVertical ? rect.left : rect.top;

    if (firstCrossPos === null) {
      firstCrossPos = crossPos;
    } else if (Math.abs(crossPos - firstCrossPos) > 2) {
      fullLineChars = Math.max(2, (n - 1) * CHARS_PER_CHUNK);
      break;
    }
    fullLineChars = n * CHARS_PER_CHUNK;
  }

  testContainer.remove();

  return { isVertical, oneCharInline, columnSize, columnStride, fullLineChars, marginStart };
}

// ── HTML slicing helpers ──────────────────────────────────────────────

/**
 * Slice an HTML string by visible character positions [start, end).
 * Tags are preserved and properly opened/closed. Tags that were already open
 * before `start` are re-emitted at the beginning of the slice so the result
 * stays well-formed. HTML entities (e.g. `&amp;`) are treated as one visible
 * character.
 */
export function sliceHtml(html: string, start: number, end: number): string {
  let visibleIdx = 0;
  let i = 0;
  let result = '';
  const openTags: string[] = [];
  let entered = false;

  const enterSlice = () => {
    if (entered) return;
    entered = true;
    for (const t of openTags) result += `<${t}>`;
  };

  while (i < html.length && visibleIdx < end) {
    if (html[i] === '<') {
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) break;
      const tag = html.slice(i, tagEnd + 1);
      const isClosing = tag.startsWith('</');
      const isSelfClosing = tag.endsWith('/>');
      if (visibleIdx >= start) {
        enterSlice();
        result += tag;
      }
      if (!isClosing && !isSelfClosing) {
        const tagName = tag.match(/^<(\w+)/)?.[1] || '';
        if (tagName) openTags.push(tagName);
      } else if (isClosing) {
        const tagName = tag.match(/^<\/(\w+)/)?.[1] || '';
        const lastOpen = openTags.lastIndexOf(tagName);
        if (lastOpen !== -1) openTags.splice(lastOpen, 1);
      }
      i = tagEnd + 1;
    } else {
      const charLen = entityLengthAt(html, i);
      if (visibleIdx >= start && visibleIdx < end) {
        enterSlice();
        result += html.slice(i, i + charLen);
      }
      visibleIdx++;
      i += charLen;
    }
  }

  // Close any unclosed tags
  for (let t = openTags.length - 1; t >= 0; t--) {
    result += `</${openTags[t]}>`;
  }

  return result;
}

/**
 * Length of the visible character starting at `i` — 1 for normal chars,
 * or the entity length (e.g. 5 for `&amp;`) when an entity starts here.
 */
function entityLengthAt(html: string, i: number): number {
  if (html[i] !== '&') return 1;
  const semi = html.indexOf(';', i + 1);
  if (semi === -1 || semi - i >= 10) return 1;
  // Validate entity body to avoid swallowing arbitrary `&...;` text
  const body = html.slice(i + 1, semi);
  return /^#?[a-zA-Z0-9]+$/.test(body) ? semi - i + 1 : 1;
}

/**
 * Slice a sub-HTML string relative to a plain text line.
 * `lineHtml` is the HTML for the full line, `lineText` is the plain text.
 * Returns the HTML corresponding to lineText[start:end].
 */
function sliceHtmlRelative(lineHtml: string, lineText: string, start: number, end: number): string {
  if (!lineHtml) return lineText.slice(start, end);
  // Map from the line's text positions to the full HTML
  const actualEnd = Math.min(end, lineText.length);
  return sliceHtml(lineHtml, start, actualEnd);
}

/**
 * Remove the first visible (non-tag) character from an HTML string.
 * HTML entities (e.g. `&amp;`) are treated as one visible character and
 * removed in their entirety.
 */
export function removeFirstVisibleChar(html: string): string {
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) break;
      i = end + 1;
    } else {
      // Found first visible char — remove it (full entity if applicable)
      const charLen = entityLengthAt(html, i);
      return html.slice(0, i) + html.slice(i + charLen);
    }
  }
  return html;
}

/**
 * Remove the last visible (non-tag) character from an HTML string.
 * HTML entities (e.g. `&amp;`) are treated as one visible character and
 * removed in their entirety.
 */
export function removeLastVisibleChar(html: string): string {
  let i = html.length - 1;
  while (i >= 0) {
    if (html[i] === '>') {
      const start = html.lastIndexOf('<', i);
      if (start === -1) break;
      i = start - 1;
    } else if (html[i] === ';') {
      // Possible entity end — look back for `&` and validate the body.
      const amp = html.lastIndexOf('&', i);
      if (amp !== -1 && i - amp < 10) {
        const body = html.slice(amp + 1, i);
        if (/^#?[a-zA-Z0-9]+$/.test(body)) {
          return html.slice(0, amp) + html.slice(i + 1);
        }
      }
      return html.slice(0, i) + html.slice(i + 1);
    } else {
      // Found last visible char — remove it
      return html.slice(0, i) + html.slice(i + 1);
    }
  }
  return html;
}
