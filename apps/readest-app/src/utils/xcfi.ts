/**
 * Converter between EPUB CFI and CREngine XPointer
 * Converts between Readest (foliate-js) CFI format and KOReader CREngine XPointer format
 */

import { BookDoc } from '@/libs/document';
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

export class XCFI {
  private document: Document;
  private spineItemIndex: number;

  constructor(htmlDocument: Document, spineIndex: number = 0) {
    this.document = htmlDocument;
    this.spineItemIndex = spineIndex;
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
    const elementOffsetMatch = xpointer.match(/^(.*\/\w+(?:\[\d+\])?)\.(\d+)$/);
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
    const pathMatch = path.match(/^\/body\/DocFragment(?:\[\d+\])?\/body(.*)$/);
    if (!pathMatch) {
      throw new Error(`Invalid XPointer format: ${path}`);
    }

    const elementPath = pathMatch[1]!;
    let current: Element = this.document.body;

    if (!elementPath || elementPath === '') {
      return current;
    }

    const segments = elementPath.split('/').filter(Boolean);
    for (const segment of segments) {
      // Match both formats: tag[index] or just tag
      const segmentWithIndexMatch = segment.match(/^(\w+)\[(\d+)\]$/);
      const segmentWithoutIndexMatch = segment.match(/^(\w+)$/);

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

      // Find child elements with matching tag name. effectiveChildren drops
      // cfi-inert nodes and hoists cfi-skip wrappers, so a layout-only wrapper
      // doesn't shift indices relative to KOReader's wrapper-less DOM.
      const children = this.effectiveChildren(current).filter(
        (child) => child.tagName.toLowerCase() === tagName?.toLowerCase(),
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

    // Build path from target back to root
    while (current && current !== this.document.documentElement) {
      // A cfi-skip wrapper contributes no path segment: it is hoisted away, so
      // just continue from its parent (matches KOReader's wrapper-less DOM).
      if (XCFI.isCfiSkip(current)) {
        current = current.parentElement;
        continue;
      }
      const parent: Element | null = current.parentElement;
      if (!parent) break;

      const tagName = current.tagName.toLowerCase();
      // Count preceding siblings with the same tag name among the effective
      // (cfi-inert removed, cfi-skip hoisted) children of the nearest non-skip
      // ancestor, so a layout-only wrapper doesn't shift the index.
      const siblings = this.effectiveChildren(XCFI.skipTransparentParent(parent));
      let siblingIndex = 0;
      let totalSameTagSiblings = 0;
      for (const sibling of siblings) {
        if (sibling.tagName.toLowerCase() === tagName) {
          if (sibling === current) {
            siblingIndex = totalSameTagSiblings;
          }
          totalSameTagSiblings++;
        }
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
export const getCFIFromXPointer = async (
  xpointer: string,
  doc?: Document,
  index?: number,
  bookDoc?: BookDoc,
) => {
  const xSpineIndex = XCFI.extractSpineIndex(xpointer);
  let converter: XCFI;
  if (index === xSpineIndex && doc) {
    converter = new XCFI(doc, index);
  } else {
    const sectionDoc = await bookDoc?.sections?.[xSpineIndex]?.createDocument();
    if (!sectionDoc) throw new Error('Failed to load document for XPointer conversion.');
    converter = new XCFI(sectionDoc, xSpineIndex);
  }

  const cfi = converter.xPointerToCFI(xpointer);
  return cfi;
};

export const getXPointerFromCFI = async (
  cfi: string,
  doc?: Document,
  index?: number,
  bookDoc?: BookDoc,
): Promise<XPointer> => {
  const xSpineIndex = XCFI.extractSpineIndex(cfi);
  let converter: XCFI;
  if (index === xSpineIndex && doc) {
    converter = new XCFI(doc, index || 0);
  } else {
    const doc = await bookDoc?.sections?.[xSpineIndex]?.createDocument();
    if (!doc) throw new Error('Failed to load document for CFI conversion.');
    converter = new XCFI(doc, xSpineIndex || 0);
  }

  const xpointer = converter.cfiToXPointer(cfi);
  return xpointer;
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
