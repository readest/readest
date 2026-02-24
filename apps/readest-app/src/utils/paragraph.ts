const blockTags = new Set([
  'article',
  'aside',
  'blockquote',
  'caption',
  'details',
  'div',
  'dl',
  'dt',
  'dd',
  'figure',
  'footer',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'tr',
]);

const MAX_BLOCKS = 5000;

const INVISIBLE_TEXT_PATTERN =
  /[\s\u00a0\u1680\u180e\u2000-\u200a\u202f\u205f\u3000\u200b-\u200d\u2060\ufeff]/g;
const MEDIA_SELECTOR = 'img, svg, video, audio, canvas, math, iframe, object, embed, hr';

const hasMeaningfulText = (text?: string | null): boolean =>
  (text ?? '').replace(INVISIBLE_TEXT_PATTERN, '').length > 0;

const rangeHasContent = (range: Range): boolean => {
  try {
    const text = range.toString();
    if (hasMeaningfulText(text)) return true;
    const fragment = range.cloneContents();
    return !!fragment.querySelector?.(MEDIA_SELECTOR);
  } catch {
    return false;
  }
};

const hasDirectText = (node: Element): boolean =>
  Array.from(node.childNodes).some(
    (child) => child.nodeType === Node.TEXT_NODE && hasMeaningfulText(child.textContent),
  );

const hasBlockChild = (node: Element): boolean =>
  Array.from(node.children).some((child) => blockTags.has(child.tagName.toLowerCase()));

const yieldToMain = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });

export class ParagraphIterator {
  #blocks: Range[] = [];
  #index = -1;

  private constructor(blocks: Range[]) {
    this.#blocks = blocks;
  }

  static async createAsync(doc: Document, batchSize = 50): Promise<ParagraphIterator> {
    if (!doc?.body) {
      return new ParagraphIterator([]);
    }

    const blocks: Range[] = [];
    let last: Range | null = null;
    let count = 0;
    let processed = 0;

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);

    for (let node = walker.nextNode(); node && count < MAX_BLOCKS; node = walker.nextNode()) {
      processed++;

      if (processed % batchSize === 0) {
        await yieldToMain();
      }

      const element = node as Element;
      const name = element.tagName?.toLowerCase();
      if (name && blockTags.has(name)) {
        if (hasBlockChild(element) && !hasDirectText(element)) {
          continue;
        }
        if (last) {
          try {
            last.setEndBefore(node);
            if (rangeHasContent(last)) {
              blocks.push(last);
              count++;
            }
          } catch {
            // ignore invalid ranges
          }
        }
        try {
          last = doc.createRange();
          last.setStart(node, 0);
        } catch {
          last = null;
        }
      }
    }

    if (count >= MAX_BLOCKS) {
      console.warn('ParagraphIterator: Maximum block limit reached');
      return new ParagraphIterator(blocks);
    }

    if (!last) {
      try {
        last = doc.createRange();
        const startNode = doc.body.firstChild ?? doc.body;
        last.setStart(startNode, 0);
      } catch {
        return new ParagraphIterator(blocks);
      }
    }

    try {
      const endNode = doc.body.lastChild ?? doc.body;
      last.setEndAfter(endNode);
      if (rangeHasContent(last)) {
        blocks.push(last);
      }
    } catch {
      // ignore
    }

    return new ParagraphIterator(blocks);
  }

  get length(): number {
    return this.#blocks.length;
  }

  get currentIndex(): number {
    return this.#index;
  }

  current(): Range | null {
    return this.#blocks[this.#index] ?? null;
  }

  first(): Range | null {
    if (this.#blocks.length === 0) return null;
    this.#index = 0;
    return this.#blocks[0] ?? null;
  }

  last(): Range | null {
    if (this.#blocks.length === 0) return null;
    this.#index = this.#blocks.length - 1;
    return this.#blocks[this.#index] ?? null;
  }

  next(): Range | null {
    const newIndex = this.#index + 1;
    if (newIndex < this.#blocks.length) {
      this.#index = newIndex;
      return this.#blocks[newIndex] ?? null;
    }
    return null;
  }

  prev(): Range | null {
    const newIndex = this.#index - 1;
    if (newIndex >= 0) {
      this.#index = newIndex;
      return this.#blocks[newIndex] ?? null;
    }
    return null;
  }

  goTo(index: number): Range | null {
    if (index >= 0 && index < this.#blocks.length) {
      this.#index = index;
      return this.#blocks[index] ?? null;
    }
    return null;
  }

  findByNode(targetNode: Node | null): Range | null {
    if (!targetNode) return this.first();

    for (let i = 0; i < this.#blocks.length; i++) {
      const block = this.#blocks[i];
      try {
        if (block?.intersectsNode(targetNode)) {
          this.#index = i;
          return block;
        }
      } catch {
        continue;
      }
    }
    return this.first();
  }

  async findByRangeAsync(targetRange: Range | null, batchSize = 50): Promise<Range | null> {
    if (!targetRange) return this.first();

    for (let i = 0; i < this.#blocks.length; i++) {
      if (i > 0 && i % batchSize === 0) {
        await yieldToMain();
      }

      const block = this.#blocks[i];
      if (!block) continue;

      try {
        const startToEnd = block.compareBoundaryPoints(Range.START_TO_END, targetRange);
        const endToStart = block.compareBoundaryPoints(Range.END_TO_START, targetRange);
        if (startToEnd >= 0 && endToStart <= 0) {
          this.#index = i;
          return block;
        }
      } catch {
        continue;
      }
    }

    try {
      return this.findByNode(targetRange.startContainer);
    } catch {
      return this.first();
    }
  }
}
