/**
 * Converter between EPUB CFI and CREngine XPointer
 * Converts between Readest (foliate-js) CFI format and KOReader CREngine XPointer format
 */

import { BookDoc } from '@/libs/document';
import { BookFormat } from '@/types/book';
import { parse, fake, collapse, fromRange, toRange, toElement } from 'foliate-js/epubcfi.js';

type XPointer = {
  xpointer: string;
  pos0?: string;
  pos1?: string;
};

/** Where an XPointer lands: an exact text node position when the pointer
 * names one, else a cumulative text offset within `element` (or its start). */
type XPointerTarget = {
  element: Element;
  textOffset?: number;
  point?: { node: Text; offset: number };
};

/**
 * crengine reads FB2 natively, so an FB2 XPointer starts at the FictionBook
 * root and keeps the FB2 tag names: `/FictionBook/body[1]/section[3]/p[9]`.
 * `root` is the section document's element that `path` names: a child of the
 * first <body>, which foliate makes a section of its own, or a notes <body>.
 */
type FB2Anchor = { kind: 'fb2'; root: Element; path: string };

/**
 * crengine reads a MOBI book (the Mobipocket format, not KF8) as one HTML
 * document, so its XPointers start at `/html/body`, or `/html/body/body` when
 * a `<guide>` in `<head>` made crengine open a body before the book's own.
 * foliate splits the book into a section at each `<mbp:pagebreak>`. `root` is
 * the section's `<body>`, whose children crengine numbers across the whole
 * book: `before` counts each tag in the earlier sections, `total` in the book.
 */
type MobiAnchor = {
  kind: 'mobi';
  root: Element;
  path: string;
  before: Map<string, number>;
  total: Map<string, number>;
};

type Anchor = FB2Anchor | MobiAnchor;

export class XCFI {
  private document: Document;
  private spineItemIndex: number;
  private anchor?: Anchor;

  constructor(htmlDocument: Document, spineIndex: number = 0, anchor?: Anchor) {
    this.document = htmlDocument;
    this.spineItemIndex = spineIndex;
    this.anchor = anchor;
  }

  /**
   * The FB2 tag foliate converted an element from: foliate renames the tags
   * (`title` -> `header`, `epigraph` -> `blockquote`, `v` -> `div`, ...) but
   * keeps the original name as the element's first class.
   */
  static fb2TagName(element: Element): string {
    if (element.localName === 'img') return 'image';
    return element.classList[0] ?? element.localName;
  }

  private tagOf(element: Element): string {
    return this.anchor?.kind === 'fb2' ? XCFI.fb2TagName(element) : element.tagName.toLowerCase();
  }

  static extractSpineIndex(cfiOrXPath: string): number {
    try {
      if (cfiOrXPath.startsWith('epubcfi(')) {
        const collapsed = collapse(parse(cfiOrXPath));
        const spineStep = collapsed[0]?.[1]?.index;
        if (spineStep === undefined) {
          throw new Error('Cannot extract spine index from CFI');
        }

        // Convert CFI spine step to 0-based index
        // CFI uses even numbers starting from 2: 2, 4, 6, 8, ...
        // Convert to 0-based: (step - 2) / 2 = 0, 1, 2, 3, ...
        return Math.floor((spineStep - 2) / 2);
      } else if (cfiOrXPath.startsWith('/body/DocFragment')) {
        // Note that all indices in XPointer/XPath are 1-based
        // but the text() offsets are 0-based. crengine omits the [N] when
        // the book has a single spine item: /body/DocFragment/body/...
        const match = cfiOrXPath.match(/^\/body\/DocFragment(?:\[(\d+)\])?\//);
        if (match) {
          return match[1] ? parseInt(match[1], 10) - 1 : 0;
        }
        throw new Error('Cannot extract spine index from XPath');
      } else {
        throw new Error('Unsupported format for spine index extraction');
      }
    } catch (error) {
      throw new Error(`Cannot extract spine index from CFI/XPointer: ${cfiOrXPath} - ${error}`);
    }
  }

  xPointerToCFI(startXPointer: string, endXPointer?: string): string {
    try {
      if (endXPointer) {
        return this.convertRangeXPointerToCFI(startXPointer, endXPointer);
      }

      return this.convertPointXPointerToCFI(startXPointer);
    } catch (error) {
      throw new Error(`Failed to convert XPointer ${startXPointer}: ${error}`);
    }
  }

  cfiToXPointer(cfi: string): XPointer {
    try {
      const parts = parse(cfi);
      if (parts.parent) {
        const index = fake.toIndex(parts.parent.shift()); // Remove the spine step
        if (index !== this.spineItemIndex) {
          throw new Error(
            `CFI spine index ${index} does not match converter spine index ${this.spineItemIndex}`,
          );
        }
        const range = toRange(this.document, parts);
        const startXPointer = this.rangePointToXPointer(range.startContainer, range.startOffset);
        const endXPointer = this.rangePointToXPointer(range.endContainer, range.endOffset);

        return {
          xpointer: startXPointer,
          pos0: startXPointer,
          pos1: endXPointer,
        };
      }

      const collapsed = collapse(parts);
      const index = fake.toIndex(parts.shift());
      if (index !== this.spineItemIndex) {
        throw new Error(
          `CFI spine index ${index} does not match converter spine index ${this.spineItemIndex}`,
        );
      }
      const element = toElement(this.document, parts[0]) as Element;
      if (!element) {
        throw new Error(`Element not found for CFI: ${cfi}`);
      }
      const lastPart =
        collapsed[collapsed.length - 1]?.[collapsed[collapsed.length - 1].length - 1];
      const textOffset = lastPart?.offset;

      const xpointer =
        textOffset !== undefined
          ? this.handleTextOffset(element, textOffset)
          : this.buildXPointerPath(element);

      return { xpointer };
    } catch (error) {
      throw new Error(`Failed to convert CFI ${cfi}: ${error}`);
    }
  }

  validateCFI(cfi: string): boolean {
    try {
      parse(cfi);
      this.cfiToXPointer(cfi);
      return true;
    } catch {
      return false;
    }
  }

  validateXPointer(xpointer: string, pos1?: string): boolean {
    try {
      this.xPointerToCFI(xpointer, pos1);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Convert a single point XPointer to CFI
   */
  private convertPointXPointerToCFI(xpointer: string): string {
    const { node, offset } = this.anchorPoint(this.parseXPointer(xpointer));
    const range = this.document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset);
    return this.adjustSpineIndex(fromRange(range));
  }

  private convertRangeXPointerToCFI(startXPointer: string, endXPointer: string): string {
    const start = this.anchorPoint(this.parseXPointer(startXPointer));
    const end = this.anchorPoint(this.parseXPointer(endXPointer));
    const range = this.document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return this.adjustSpineIndex(fromRange(range));
  }

  /** DOM position for a parsed XPointer, falling back to the element start. */
  private anchorPoint(target: XPointerTarget): { node: Node; offset: number } {
    if (target.point) return target.point;
    if (target.textOffset !== undefined) {
      const found = this.findTextNodeAtOffset(target.element, target.textOffset);
      if (found) return found;
    }
    return { node: target.element, offset: 0 };
  }

  /**
   * Parse XPointer string to extract element and text offset
   *
   * Supports three KOReader text reference formats:
   * - `/text().N`      — offset N in the element's only text child (crengine
   *                      omits the `[K]` when there is a single text child)
   * - `/text()[K].N`   — Kth direct text node child (1-based), offset N within that node
   * - `/tag[idx].N`    — offset N directly on the last path element (no explicit
   *                      `text()` step); CREngine emits this when the target
   *                      point falls at the very start of an element's text
   *                      content, e.g. `div[1].0`. Semantically equivalent to
   *                      `/tag[idx]/text().N`.
   */
  private parseXPointer(xpointer: string): XPointerTarget {
    // Format: /text()[K].N — indexed text node with offset
    const indexedTextMatch = xpointer.match(/\/text\(\)\[(\d+)\]\.(\d+)$/);
    if (indexedTextMatch) {
      const textNodeIndex = parseInt(indexedTextMatch[1]!, 10); // 1-based
      const offsetInNode = parseInt(indexedTextMatch[2]!, 10);
      const elementPath = xpointer.replace(/\/text\(\)\[\d+\]\.\d+$/, '');

      const element = this.resolveXPointerPath(elementPath);
      if (!element) {
        throw new Error(`Cannot resolve XPointer path: ${elementPath}`);
      }

      return { element, point: this.textChildPoint(element, textNodeIndex, offsetInNode) };
    }

    // Format: /text().N — the element's only text child, offset N inside it
    const textOffsetMatch = xpointer.match(/\/text\(\)\.(\d+)$/);
    if (textOffsetMatch) {
      const offsetInNode = parseInt(textOffsetMatch[1]!, 10);
      const elementPath = xpointer.replace(/\/text\(\)\.\d+$/, '');

      const element = this.resolveXPointerPath(elementPath);
      if (!element) {
        throw new Error(`Cannot resolve XPointer path: ${elementPath}`);
      }

      const children = XCFI.crengineTextChildren(element);
      const node = children.find((t) => t.data.trim().length > 0) ?? children[0];
      // No direct text at all: keep the cumulative reading as a best effort.
      if (!node) return { element, textOffset: offsetInNode };
      return { element, point: { node, offset: XCFI.nodeOffset(node, offsetInNode) } };
    }

    // Format: /tag[idx].N — offset directly on the last element segment, with
    // no `text()` step at all. Must be checked before the plain-path fallback
    // since the trailing `.N` is not a valid tag/index segment on its own.
    const elementOffsetMatch = xpointer.match(/^(.*\/[\w-]+(?:\[\d+\])?)\.(\d+)$/);
    if (elementOffsetMatch) {
      const elementPath = elementOffsetMatch[1]!;
      const textOffset = parseInt(elementOffsetMatch[2]!, 10);

      const element = this.resolveXPointerPath(elementPath);
      if (!element) {
        throw new Error(`Cannot resolve XPointer path: ${elementPath}`);
      }

      return { element, textOffset };
    }

    // No offset suffix: point at the start of the element itself.
    const element = this.resolveXPointerPath(xpointer);
    if (!element) {
      throw new Error(`Cannot resolve XPointer path: ${xpointer}`);
    }

    return { element };
  }

  private static readonly WHITESPACE = /[ \t\n\r\f]/;
  /** Tags whose built-in crengine style is `white-space: pre` (fb2def.h). */
  private static readonly PRE_TAGS = new Set([
    'pre',
    'code',
    'listing',
    'plaintext',
    'xmp',
    'textarea',
  ]);
  /** Block containers, where crengine drops leading whitespace-only text. */
  private static readonly BLOCK_TAGS = new Set([
    'body',
    'div',
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'dl',
    'dt',
    'dd',
    'blockquote',
    'pre',
    'section',
    'article',
    'aside',
    'header',
    'footer',
    'nav',
    'main',
    'figure',
    'figcaption',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'td',
    'th',
    'caption',
    'address',
    'details',
    'summary',
    'form',
    'fieldset',
    'center',
  ]);

  /** Inside `pre`/`code` and friends crengine keeps whitespace verbatim. */
  private static preservesWhitespace(node: Node): boolean {
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (XCFI.PRE_TAGS.has(el.tagName.toLowerCase())) return true;
    }
    return false;
  }

  /**
   * Direct text children as crengine keeps them (ldomDocumentWriter::OnText):
   * a whitespace-only text node that opens a block is dropped, whitespace
   * between or after inline children survives as a single space. Pinned
   * against the real engine with apps/readest.koplugin/scripts/xpointer-oracle.lua.
   */
  private static crengineTextChildren(element: Element): Text[] {
    const dropsLeadingBlank =
      XCFI.BLOCK_TAGS.has(element.tagName.toLowerCase()) &&
      !XCFI.preservesWhitespace(element.firstChild ?? element);
    return Array.from(element.childNodes).filter((node, i): node is Text => {
      if (node.nodeType !== Node.TEXT_NODE) return false;
      const text = (node as Text).data;
      if (text.length === 0) return false;
      return !(dropsLeadingBlank && i === 0 && text.trim() === '');
    });
  }

  /** crengine offset -> raw DOM offset inside `node` (see toRawOffset). */
  private static nodeOffset(node: Text, crengineOffset: number): number {
    if (XCFI.preservesWhitespace(node)) return Math.min(crengineOffset, node.data.length);
    return XCFI.toRawOffset(node.data, crengineOffset);
  }

  /** raw DOM offset inside `node` -> crengine offset (see toCollapsedOffset). */
  private static crengineOffset(node: Text, rawOffset: number): number {
    if (XCFI.preservesWhitespace(node)) return rawOffset;
    return XCFI.toCollapsedOffset(node.data, rawOffset);
  }

  /**
   * crengine collapses each whitespace run inside a text node to one space and
   * counts offsets in that collapsed text; the DOM counts the raw source.
   */
  private static toCollapsedOffset(text: string, rawOffset: number): number {
    let collapsed = 0;
    for (let i = 0; i < rawOffset && i < text.length; i++) {
      if (!XCFI.isRunContinuation(text, i)) collapsed++;
    }
    return collapsed + Math.max(0, rawOffset - text.length);
  }

  private static toRawOffset(text: string, collapsedOffset: number): number {
    let collapsed = 0;
    for (let i = 0; i < text.length; i++) {
      if (XCFI.isRunContinuation(text, i)) continue;
      if (collapsed === collapsedOffset) return i;
      collapsed++;
    }
    return text.length;
  }

  private static isRunContinuation(text: string, i: number): boolean {
    return i > 0 && XCFI.WHITESPACE.test(text[i]!) && XCFI.WHITESPACE.test(text[i - 1]!);
  }

  /**
   * Resolve text()[K].N to a DOM position. K is the 1-based index among the
   * direct text children crengine keeps and N is the offset within that text
   * node's whitespace-collapsed text.
   */
  private textChildPoint(
    element: Element,
    textNodeIndex: number,
    offsetInNode: number,
  ): { node: Text; offset: number } {
    const children = XCFI.crengineTextChildren(element);
    const node = children[textNodeIndex - 1];
    if (!node) {
      throw new Error(
        `Text node index ${textNodeIndex} out of bounds (found ${children.length} direct text nodes)`,
      );
    }
    return { node, offset: XCFI.nodeOffset(node, offsetInNode) };
  }

  private resolveXPointerPath(path: string): Element | null {
    let current: Element;
    let segments: string[];
    if (this.anchor?.kind === 'mobi') {
      const pathMatch = path.match(/^\/html\/body(?:\/body)?(.*)$/);
      if (!pathMatch) throw new Error(`Invalid MOBI XPointer format: ${path}`);
      current = this.anchor.root;
      segments = pathMatch[1]!.split('/').filter(Boolean);
    } else if (this.anchor) {
      // The pointer's leading steps name the anchor (`body` or `body[1]` alike).
      current = this.anchor.root;
      segments = path.split('/').filter(Boolean);
      segments = segments.slice(this.anchor.path.split('/').filter(Boolean).length);
    } else {
      const pathMatch = path.match(/^\/body\/DocFragment(?:\[\d+\])?\/body(.*)$/);
      if (!pathMatch) {
        throw new Error(`Invalid XPointer format: ${path}`);
      }
      current = this.document.body;
      segments = pathMatch[1]!.split('/').filter(Boolean);
    }

    for (const [depth, segment] of segments.entries()) {
      // Match both formats: tag[index] or just tag
      const segmentWithIndexMatch = segment.match(/^([\w-]+)\[(\d+)\]$/);
      const segmentWithoutIndexMatch = segment.match(/^([\w-]+)$/);

      let tagName: string;
      let index: number;

      if (segmentWithIndexMatch) {
        // Format: tag[index] (1-based index)
        const [, tag, indexStr] = segmentWithIndexMatch;
        tagName = tag!;
        index = Math.max(0, parseInt(indexStr!, 10) - 1);
      } else if (segmentWithoutIndexMatch) {
        // Format: tag (implicit index 0)
        const [, tag] = segmentWithoutIndexMatch;
        tagName = tag!;
        index = 0;
      } else {
        throw new Error(`Invalid XPointer segment: ${segment}`);
      }
      // A MOBI section's top-level elements are numbered across the book.
      if (depth === 0 && this.anchor?.kind === 'mobi') {
        index -= this.anchor.before.get(tagName.toLowerCase()) ?? 0;
        if (index < 0) throw new Error(`Element ${segment} is in an earlier section`);
      }

      // Find child elements with matching tag name. effectiveChildren drops
      // cfi-inert nodes and hoists cfi-skip wrappers, so a layout-only wrapper
      // doesn't shift indices relative to KOReader's wrapper-less DOM.
      const children = this.effectiveChildren(current).filter(
        (child) => this.tagOf(child) === tagName?.toLowerCase(),
      );

      if (index >= children.length) {
        throw new Error(`Element index ${index} out of bounds for tag ${tagName}`);
      }

      current = children[index]!;
    }

    return current;
  }

  /**
   * Find text node and offset within element based on cumulative character offset
   */
  private findTextNodeAtOffset(
    element: Element,
    offset: number,
  ): { node: Text; offset: number } | null {
    const textNodes: Text[] = [];
    this.collectTextNodes(element, textNodes);

    let currentOffset = 0;

    for (const textNode of textNodes) {
      const nodeText = textNode.textContent || '';
      const nodeLength = nodeText.length;

      if (currentOffset + nodeLength >= offset) {
        return {
          node: textNode,
          offset: offset - currentOffset,
        };
      }

      currentOffset += nodeLength;
    }

    // If offset is beyond all text, return the last text node at its end
    if (textNodes.length > 0) {
      const lastNode = textNodes[textNodes.length - 1]!;
      return {
        node: lastNode,
        offset: (lastNode.textContent || '').length,
      };
    }

    return null;
  }

  private adjustSpineIndex(cfi: string): string {
    const cfiMatch = cfi.match(/^epubcfi\((.+)\)$/);
    if (!cfiMatch) {
      throw new Error(`Invalid CFI format: ${cfi}`);
    }

    const innerCfi = cfiMatch[1]!;
    const spineStep = (this.spineItemIndex + 1) * 2; // Convert 0-based to CFI format

    if (innerCfi.match(/^\/6\/\d+!/)) {
      const adjustedInner = innerCfi.replace(/^\/6\/\d+!/, `/6/${spineStep}!`);
      return `epubcfi(${adjustedInner})`;
    } else {
      const adjustedInner = `/6/${spineStep}!${innerCfi}`;
      return `epubcfi(${adjustedInner})`;
    }
  }

  /**
   * Convert a range point (container + offset) to XPointer
   */
  private rangePointToXPointer(container: Node, offset: number): string {
    if (container.nodeType === Node.TEXT_NODE) {
      return this.textNodeXPointer(container as Text, offset);
    } else if (container.nodeType === Node.ELEMENT_NODE) {
      const element = container as Element;
      if (offset === 0) {
        if (element.childNodes.length > 0) {
          const firstChild = element.childNodes[0] as Element;
          if (firstChild.nodeType === Node.ELEMENT_NODE) {
            return this.buildXPointerPath(element.childNodes[0] as Element);
          }
        }
        return this.buildXPointerPath(element);
      } else {
        // Offset points to a child node
        const childNodes = Array.from(element.childNodes);
        const targetChild = childNodes[offset - 1] || childNodes[childNodes.length - 1];

        if (targetChild?.nodeType === Node.ELEMENT_NODE) {
          return this.buildXPointerPath(targetChild as Element);
        } else if (targetChild?.nodeType === Node.TEXT_NODE) {
          return this.textNodeXPointer(targetChild as Text, (targetChild as Text).data.length);
        } else {
          return this.buildXPointerPath(element);
        }
      }
    } else {
      // Fallback to document element
      return this.buildXPointerPath(this.document.documentElement);
    }
  }

  /**
   * Check if an element is injected by Readest at runtime and should be
   * invisible to XPointer path building / resolution (e.g. skip-link div).
   */
  private static isCfiInert(element: Element): boolean {
    return element.hasAttribute('cfi-inert');
  }

  /**
   * A cfi-skip element (e.g. the layout-only scroll wrapper applyScrollableStyle
   * adds around a table/equation) must be transparent to XPointer paths: KOReader's
   * CREngine DOM has no such wrapper, so its children must keep the indices they'd
   * have without it. Unlike cfi-inert (drops the node AND its subtree), cfi-skip
   * hoists the node's children into its parent. Must match epubcfi.js's cfi-skip
   * handling so CFI ↔ XPointer round-trips through the same logical structure.
   */
  private static isCfiSkip(element: Element): boolean {
    return element.hasAttribute('cfi-skip');
  }

  /** Nearest ancestor-or-self element that is not a cfi-skip wrapper. */
  private static skipTransparentParent(element: Element): Element {
    let el: Element = element;
    while (XCFI.isCfiSkip(el) && el.parentElement) el = el.parentElement;
    return el;
  }

  /**
   * Element children of `parent` as XPointer sees them: cfi-inert nodes removed and
   * cfi-skip wrappers spliced out (their own children hoisted in place, recursively).
   */
  private effectiveChildren(parent: Element): Element[] {
    const result: Element[] = [];
    for (const child of Array.from(parent.children)) {
      if (XCFI.isCfiInert(child)) continue;
      if (this.anchor?.kind === 'mobi' && isFileposAnchor(child)) continue;
      if (XCFI.isCfiSkip(child)) result.push(...this.effectiveChildren(child));
      else result.push(child);
    }
    return result;
  }

  /**
   * Build XPointer path from DOM element
   */
  private buildXPointerPath(targetElement: Element): string {
    const pathParts: string[] = [];
    let current: Element | null = targetElement;
    if (this.anchor && !this.anchor.root.contains(targetElement)) return this.anchor.path;
    const top = this.anchor?.root ?? this.document.documentElement;

    // Build path from target back to root
    while (current && current !== top) {
      // A cfi-skip wrapper contributes no path segment: it is hoisted away, so
      // just continue from its parent (matches KOReader's wrapper-less DOM).
      if (XCFI.isCfiSkip(current)) {
        current = current.parentElement;
        continue;
      }
      const parent: Element | null = current.parentElement;
      if (!parent) break;

      const tagName = this.tagOf(current);
      // Count preceding siblings with the same tag name among the effective
      // (cfi-inert removed, cfi-skip hoisted) children of the nearest non-skip
      // ancestor, so a layout-only wrapper doesn't shift the index.
      const container = XCFI.skipTransparentParent(parent);
      const siblings = this.effectiveChildren(container);
      let siblingIndex = 0;
      let totalSameTagSiblings = 0;
      for (const sibling of siblings) {
        if (this.tagOf(sibling) === tagName) {
          if (sibling === current) {
            siblingIndex = totalSameTagSiblings;
          }
          totalSameTagSiblings++;
        }
      }
      // A MOBI section's top-level elements are numbered across the book.
      if (this.anchor?.kind === 'mobi' && container === this.anchor.root) {
        siblingIndex += this.anchor.before.get(tagName) ?? 0;
        totalSameTagSiblings = this.anchor.total.get(tagName) ?? totalSameTagSiblings;
      }

      // Format as tag[index] (0-based for CREngine)
      // Omit [0] if there's only one element with this tag name
      if (totalSameTagSiblings === 1) {
        pathParts.unshift(tagName);
      } else {
        pathParts.unshift(`${tagName}[${siblingIndex + 1}]`); // Convert to 1-based index for XPointer
      }
      current = parent;
    }

    if (this.anchor) return [this.anchor.path, ...pathParts].join('/');

    let xpointer = `/body/DocFragment[${this.spineItemIndex + 1}]`;
    if (pathParts.length > 0 && pathParts[0]!.startsWith('body')) {
      pathParts.shift();
    }
    xpointer += '/body';

    if (pathParts.length > 0) {
      xpointer += '/' + pathParts.join('/');
    }

    return xpointer;
  }

  /**
   * Handle text offset within an element by finding character position.
   * Produces KOReader-compatible text()[K].N format where K is the 1-based
   * index of the direct text node child within its parent element.
   */
  private handleTextOffset(element: Element, cfiOffset: number): string {
    const textNodes: Text[] = [];
    this.collectTextNodes(element, textNodes);

    let totalChars = 0;
    let targetTextNode: Text | null = null;
    let offsetInNode = 0;

    for (const textNode of textNodes) {
      const nodeText = textNode.textContent || '';
      const nodeLength = nodeText.length;

      if (totalChars + nodeLength >= cfiOffset) {
        targetTextNode = textNode;
        offsetInNode = cfiOffset - totalChars;
        break;
      }

      totalChars += nodeLength;
    }

    if (!targetTextNode) {
      // Offset beyond text content, use element end
      return this.buildXPointerPath(element);
    }

    return this.textNodeXPointer(targetTextNode, offsetInNode);
  }

  /**
   * XPointer of a position inside a specific text node, in KOReader's form:
   * the node's direct parent gives the path (correct even when inline
   * elements split the text), the index counts the text children crengine
   * keeps and the offset counts its whitespace-collapsed text.
   */
  private textNodeXPointer(textNode: Text, offsetInNode: number): string {
    const textParent = textNode.parentElement || this.document.documentElement;
    const basePath = this.buildXPointerPath(textParent);
    const siblings = XCFI.crengineTextChildren(textParent);
    const index = siblings.indexOf(textNode);
    // Dropped whitespace belongs at the block start, before any inline content.
    if (index < 0) return basePath;
    const collapsed = XCFI.crengineOffset(textNode, offsetInNode);

    // Omit [1] when there is only one direct text node (matches KOReader format)
    if (siblings.length <= 1) {
      return `${basePath}/text().${collapsed}`;
    }
    return `${basePath}/text()[${index + 1}].${collapsed}`;
  }

  /**
   * Collect all text nodes in document order
   */
  private collectTextNodes(element: Element, textNodes: Text[]): void {
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent || '';
        if (text.length > 0) {
          textNodes.push(child as Text);
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        this.collectTextNodes(child as Element, textNodes);
      }
    }
  }
}

/**
 * The spine section of a CREngine XPointer is CALCULATED, never estimated:
 * `DocFragment[N]` is foliate section `N - 1`.
 *
 * CREngine guarantees that 1:1 mapping by construction. Its EPUB importer
 * (crengine/src/epubfmt.cpp, "Create a DocFragment for each and all items in
 * the EPUB's <spine>") walks the spine once and emits exactly one DocFragment
 * per item, wrapping an SVG spine item in a `SpineSvgWrapper` and standing in a
 * `SpineItemUnsupported` dummy for anything it cannot parse — expressly so that
 * indices never shift and existing XPointers stay valid.
 *
 * The one documented exception is a book pinned to a DOM version older than
 * 20240114, where `relaxed_spine` is false and only spine items with
 * media-type `application/xhtml+xml` get a fragment. That mapping is also
 * exactly computable (index into the XHTML-only subsequence) if a report ever
 * turns up; KOReader itself migrates old books off those DOM versions.
 *
 * Do NOT second-guess the section with the server-reported reading percentage.
 * #5111 added such a "drift anchor" — re-anchoring to whichever section the
 * percentage falls into under foliate's byte-size table — on the theory that
 * CREngine's numbering drifts. Per the source above it does not. What #4444
 * actually showed was a parse gap (fixed in `parseXPointer`) whose fallback to
 * the raw percentage moved the reader, and the anchor was later gated off for
 * every server that reported it. Left on for real KOReader it corrupted valid
 * locators: CREngine's percentage comes from its own pagination, so on a book
 * with heavy back matter (#5980: Notes + Index are 44% of spine bytes) it sits
 * a whole chapter away from where the byte-size table puts it.
 */
export const getCFIFromXPointer = (
  xpointer: string,
  doc?: Document,
  index?: number,
  bookDoc?: BookDoc,
) => convertXPointer(xpointer, undefined, doc, index, bookDoc);

/** CFI of a KOReader range (a highlight's pos0..pos1), read in its own section. */
export const getCFIFromXPointerRange = (start: string, end: string, bookDoc?: BookDoc) =>
  convertXPointer(start, end, undefined, undefined, bookDoc);

const convertXPointer = async (
  xpointer: string,
  endXPointer: string | undefined,
  doc?: Document,
  index?: number,
  bookDoc?: BookDoc,
) => {
  if (xpointer.startsWith('/FictionBook')) {
    if (!bookDoc) throw new Error('FB2 XPointer conversion needs the book.');
    const fb2Index = await getFB2SectionIndex(xpointer, bookDoc);
    const sectionDoc =
      index === fb2Index && doc ? doc : await bookDoc.sections?.[fb2Index]?.createDocument();
    if (!sectionDoc) throw new Error('Failed to load document for XPointer conversion.');
    const anchor = await getFB2Anchor(sectionDoc, fb2Index, bookDoc);
    return new XCFI(sectionDoc, fb2Index, anchor).xPointerToCFI(xpointer, endXPointer);
  }
  if (xpointer.startsWith('/html/')) {
    if (!bookDoc || !isMobiBook(bookDoc)) throw new Error('Not a MOBI book: ' + xpointer);
    const mobiIndex = await getMobiSectionIndex(xpointer, bookDoc);
    const sectionDoc =
      index === mobiIndex && doc ? doc : await bookDoc.sections[mobiIndex]?.createDocument();
    if (!sectionDoc) throw new Error('Failed to load document for XPointer conversion.');
    const anchor = await getMobiAnchor(sectionDoc, mobiIndex, bookDoc);
    return new XCFI(sectionDoc, mobiIndex, anchor).xPointerToCFI(xpointer, endXPointer);
  }

  const xSpineIndex = XCFI.extractSpineIndex(xpointer);
  let converter: XCFI;
  if (index === xSpineIndex && doc) {
    converter = new XCFI(doc, index);
  } else {
    const sectionDoc = await bookDoc?.sections?.[xSpineIndex]?.createDocument();
    if (!sectionDoc) throw new Error('Failed to load document for XPointer conversion.');
    converter = new XCFI(sectionDoc, xSpineIndex);
  }

  const cfi = converter.xPointerToCFI(xpointer, endXPointer);
  return cfi;
};

/** `format` picks the XPointer form: crengine reads FB2 and MOBI natively (see Anchor). */
export const getXPointerFromCFI = async (
  cfi: string,
  doc?: Document,
  index?: number,
  bookDoc?: BookDoc,
  format?: BookFormat,
): Promise<XPointer> => {
  const xSpineIndex = XCFI.extractSpineIndex(cfi);
  const sectionDoc =
    index === xSpineIndex && doc ? doc : await bookDoc?.sections?.[xSpineIndex]?.createDocument();
  if (!sectionDoc) throw new Error('Failed to load document for CFI conversion.');

  let anchor: Anchor | undefined;
  if (format === 'FB2' || format === 'FBZ') {
    if (!bookDoc) throw new Error('FB2 XPointer conversion needs the book.');
    anchor = await getFB2Anchor(sectionDoc, xSpineIndex, bookDoc);
  } else if (bookDoc && isMobiBook(bookDoc)) {
    anchor = await getMobiAnchor(sectionDoc, xSpineIndex, bookDoc);
  }
  return new XCFI(sectionDoc, xSpineIndex, anchor).cfiToXPointer(cfi);
};

/**
 * foliate makes a section of each child of the first FB2 <body> (an image, the
 * body's title and epigraphs, then its sections) and one more per notes body.
 * crengine counts each tag apart (`section[N]` skips the title before it), so
 * the mapping needs the FB2 tag of every first-body section, read once per book.
 */
const fb2RootTags = new WeakMap<BookDoc, Promise<string[]>>();

const getFB2Root = (doc: Document): Element => {
  const root = Array.from(doc.body.children).find((el) => !el.hasAttribute('cfi-inert'));
  if (!root) throw new Error('FB2 section has no content.');
  return root;
};

const getFB2RootTags = (bookDoc: BookDoc): Promise<string[]> => {
  let tags = fb2RootTags.get(bookDoc);
  if (!tags) {
    const sections = bookDoc.sections.filter((section) => section.linear !== 'no');
    tags = Promise.all(
      sections.map(async (section) => XCFI.fb2TagName(getFB2Root(await section.createDocument()))),
    );
    fb2RootTags.set(bookDoc, tags);
  }
  return tags;
};

const getFB2Anchor = async (doc: Document, index: number, bookDoc: BookDoc): Promise<FB2Anchor> => {
  const root = getFB2Root(doc);
  const tags = await getFB2RootTags(bookDoc);
  if (index >= tags.length) {
    return { kind: 'fb2', root, path: `/FictionBook/body[${index - tags.length + 2}]` };
  }
  const tag = tags[index]!;
  const nth = tags.slice(0, index + 1).filter((t) => t === tag).length;
  const step = tags.filter((t) => t === tag).length > 1 ? `${tag}[${nth}]` : tag;
  const body = tags.length < bookDoc.sections.length ? 'body[1]' : 'body';
  return { kind: 'fb2', root, path: `/FictionBook/${body}/${step}` };
};

const getFB2SectionIndex = async (xpointer: string, bookDoc: BookDoc): Promise<number> => {
  const match = xpointer.match(/^\/FictionBook\/body(?:\[(\d+)\])?(?:\/([\w-]+)(?:\[(\d+)\])?)?/);
  if (!match) throw new Error(`Unsupported FB2 XPointer: ${xpointer}`);
  const tags = await getFB2RootTags(bookDoc);
  const body = match[1] ? parseInt(match[1], 10) : 1;
  if (body > 1) {
    const index = tags.length + body - 2;
    if (index >= bookDoc.sections.length) throw new Error(`FB2 body ${body} not found`);
    return index;
  }
  const [, , tag, nth] = match;
  let count = 0;
  const index = tags.findIndex((t) => t === tag && ++count === (nth ? parseInt(nth, 10) : 1));
  if (index < 0) throw new Error(`FB2 XPointer section not found: ${xpointer}`);
  return index;
};

/** The empty `<a id="fileposN">` foliate adds for each MOBI link target; crengine has none. */
const isFileposAnchor = (element: Element): boolean =>
  element.localName === 'a' && element.id.startsWith('filepos') && !element.hasChildNodes();

/**
 * A book foliate opened with its MOBI reader for the Mobipocket format (MOBI6
 * in foliate), the part crengine reads. Its KF8 reader keeps the KF8 header;
 * crengine doesn't read KF8, so such a book keeps the DocFragment form.
 */
const isMobiBook = (bookDoc: BookDoc): boolean => {
  const headers = (bookDoc as { mobi?: { headers?: { kf8?: unknown } } }).mobi?.headers;
  return !!headers && !headers.kf8;
};

/** Per section, how many top-level elements of each tag it holds, read once per book. */
type MobiLayout = { path: string; counts: Map<string, number>[] };
const mobiLayouts = new WeakMap<BookDoc, Promise<MobiLayout>>();

const getMobiLayout = (bookDoc: BookDoc): Promise<MobiLayout> => {
  let layout = mobiLayouts.get(bookDoc);
  if (!layout) {
    layout = (async () => {
      // One section at a time, so each parsed document can be collected before
      // the next is parsed.
      const counts: Map<string, number>[] = [];
      let guide = false;
      for (const [i, section] of bookDoc.sections.entries()) {
        const doc = await section.createDocument();
        const count = new Map<string, number>();
        for (const child of Array.from(doc.body.children)) {
          // The HTML parser moves a <head><guide> into <body>, where crengine
          // instead opened a body of its own before the book's <body>.
          if (i === 0 && child.localName === 'guide') guide = true;
          if (child.hasAttribute('cfi-inert') || isFileposAnchor(child)) continue;
          count.set(child.localName, (count.get(child.localName) ?? 0) + 1);
        }
        counts.push(count);
      }
      return { path: guide ? '/html/body/body' : '/html/body', counts };
    })();
    mobiLayouts.set(bookDoc, layout);
  }
  return layout;
};

const getMobiAnchor = async (
  doc: Document,
  index: number,
  bookDoc: BookDoc,
): Promise<MobiAnchor> => {
  const { path, counts } = await getMobiLayout(bookDoc);
  const before = new Map<string, number>();
  const total = new Map<string, number>();
  counts.forEach((count, i) => {
    for (const [tag, n] of count) {
      total.set(tag, (total.get(tag) ?? 0) + n);
      if (i < index) before.set(tag, (before.get(tag) ?? 0) + n);
    }
  });
  return { kind: 'mobi', root: doc.body, path, before, total };
};

const getMobiSectionIndex = async (xpointer: string, bookDoc: BookDoc): Promise<number> => {
  const match = xpointer.match(/^\/html\/body(?:\/body)?(?:\/([\w-]+)(?:\[(\d+)\])?)?/);
  if (!match) throw new Error(`Unsupported MOBI XPointer: ${xpointer}`);
  const [, tag, nth] = match;
  if (!tag) return 0;
  const { counts } = await getMobiLayout(bookDoc);
  let seen = 0;
  const target = nth ? parseInt(nth, 10) : 1;
  const index = counts.findIndex((count) => (seen += count.get(tag) ?? 0) >= target);
  if (index < 0) throw new Error(`MOBI XPointer section not found: ${xpointer}`);
  return index;
};

// Koreader sometimes cannot recognize totally valid XPointer.
// Workaround this by cleaning up any trailing /text().N segments.
// Also remove any trailing .N suffixes after node steps.
// This has neglectable effect on position accuracy as the XPointer still point to the correct element
// while offset within the text node is usually ignored by pagination.
export const normalizeProgressXPointer = (xpointer: string): string => {
  const tailingTextOffset = /\/text\(\).*$/;
  if (xpointer.match(tailingTextOffset)) {
    xpointer = xpointer.replace(tailingTextOffset, '');
  }
  const suffixNodeOffset = /\.\d+$/;
  if (xpointer.match(suffixNodeOffset)) {
    xpointer = xpointer.replace(suffixNodeOffset, '');
  }
  return xpointer;
};
