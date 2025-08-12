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
      } else if (cfiOrXPath.startsWith('/body/DocFragment[')) {
        const match = cfiOrXPath.match(/DocFragment\[(\d+)\]/);
        if (match) {
          return parseInt(match[1]!, 10) - 1;
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
    const { element, textOffset } = this.parseXPointer(xpointer);

    const range = this.document.createRange();
    if (textOffset !== undefined) {
      const textNode = this.findTextNodeAtOffset(element, textOffset);
      if (textNode) {
        range.setStart(textNode.node, textNode.offset);
        range.setEnd(textNode.node, textNode.offset);
      } else {
        // Fallback to element positioning
        range.setStart(element, 0);
        range.setEnd(element, 0);
      }
    } else {
      range.setStart(element, 0);
      range.setEnd(element, 0);
    }

    const cfi = fromRange(range);
    return this.adjustSpineIndex(cfi);
  }

  private convertRangeXPointerToCFI(startXPointer: string, endXPointer: string): string {
    const startInfo = this.parseXPointer(startXPointer);
    const endInfo = this.parseXPointer(endXPointer);

    const range = this.document.createRange();
    if (startInfo.textOffset !== undefined) {
      const startTextNode = this.findTextNodeAtOffset(startInfo.element, startInfo.textOffset);
      if (startTextNode) {
        range.setStart(startTextNode.node, startTextNode.offset);
      } else {
        range.setStart(startInfo.element, 0);
      }
    } else {
      range.setStart(startInfo.element, 0);
    }

    if (endInfo.textOffset !== undefined) {
      const endTextNode = this.findTextNodeAtOffset(endInfo.element, endInfo.textOffset);
      if (endTextNode) {
        range.setEnd(endTextNode.node, endTextNode.offset);
      } else {
        range.setEnd(endInfo.element, 0);
      }
    } else {
      range.setEnd(endInfo.element, 0);
    }

    const cfi = fromRange(range);
    return this.adjustSpineIndex(cfi);
  }

  /**
   * Parse XPointer string to extract element and text offset
   */
  private parseXPointer(xpointer: string): { element: Element; textOffset?: number } {
    const textOffsetMatch = xpointer.match(/\/text\(\)\.(\d+)$/);
    const textOffset = textOffsetMatch ? parseInt(textOffsetMatch[1]!, 10) : undefined;

    const elementPath =
      textOffset !== undefined ? xpointer.replace(/\/text\(\)\.\d+$/, '') : xpointer;

    const element = this.resolveXPointerPath(elementPath);
    if (!element) {
      throw new Error(`Cannot resolve XPointer path: ${elementPath}`);
    }

    return { element, textOffset };
  }

  private resolveXPointerPath(path: string): Element | null {
    const pathMatch = path.match(/^\/body\/DocFragment\[\d+\]\/body(.*)$/);
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
        // Format: tag[index]
        const [, tag, indexStr] = segmentWithIndexMatch;
        tagName = tag!;
        index = parseInt(indexStr!, 10);
      } else if (segmentWithoutIndexMatch) {
        // Format: tag (implicit index 0)
        const [, tag] = segmentWithoutIndexMatch;
        tagName = tag!;
        index = 0;
      } else {
        throw new Error(`Invalid XPointer segment: ${segment}`);
      }

      // Find child elements with matching tag name
      const children = Array.from(current.children).filter(
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
      // For text nodes, find the containing element
      const element = container.parentElement || this.document.documentElement;
      return this.handleTextOffsetInElement(element, container as Text, offset);
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
          return this.handleTextOffsetInElement(
            element,
            targetChild as Text,
            (targetChild as Text).textContent?.length || 0,
          );
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
   * Build XPointer path from DOM element
   */
  private buildXPointerPath(targetElement: Element): string {
    const pathParts: string[] = [];
    let current: Element | null = targetElement;

    // Build path from target back to root
    while (current && current !== this.document.documentElement) {
      const parent: Element | null = current.parentElement;
      if (!parent) break;

      const tagName = current.tagName.toLowerCase();
      // Count preceding siblings with same tag name (0-based for CREngine)
      let siblingIndex = 0;
      let totalSameTagSiblings = 0;
      for (const sibling of Array.from(parent.children)) {
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
        pathParts.unshift(`${tagName}[${siblingIndex}]`);
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
   * Handle text offset within an element by finding character position
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

    // Find the containing element for this text node
    let textParent = targetTextNode.parentElement;
    while (textParent && !this.isSignificantElement(textParent)) {
      textParent = textParent.parentElement;
    }

    if (!textParent) {
      textParent = element as HTMLElement;
    }

    const basePath = this.buildXPointerPath(textParent);
    return `${basePath}/text().${offsetInNode}`;
  }

  /**
   * Handle text offset for a specific text node within an element
   */
  private handleTextOffsetInElement(element: Element, textNode: Text, offset: number): string {
    // Find all text nodes in the element to calculate cumulative offset
    const textNodes: Text[] = [];
    this.collectTextNodes(element, textNodes);

    let cumulativeOffset = 0;
    for (const node of textNodes) {
      if (node === textNode) {
        cumulativeOffset += offset;
        break;
      }
      cumulativeOffset += (node.textContent || '').length;
    }

    return this.handleTextOffset(element, cumulativeOffset);
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

  /**
   * Check if an element is significant for XPointer path building
   */
  private isSignificantElement(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();

    // Skip inline formatting elements that don't affect structure
    const inlineElements = new Set([
      'span',
      'em',
      'strong',
      'i',
      'b',
      'u',
      'small',
      'mark',
      'sup',
      'sub',
    ]);

    return !inlineElements.has(tagName);
  }
}

export const getCFIFromXPointer = async (
  xpointer: string,
  doc?: Document,
  index?: number,
  bookDoc?: BookDoc,
) => {
  const xSpineIndex = XCFI.extractSpineIndex(xpointer);
  let converter: XCFI;
  if (index === xSpineIndex && doc) {
    converter = new XCFI(doc, index || 0);
  } else {
    const doc = await bookDoc?.sections?.[xSpineIndex]?.createDocument();
    if (!doc) throw new Error('Failed to load document for XPointer conversion.');
    converter = new XCFI(doc, xSpineIndex || 0);
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
