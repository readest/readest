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

const rangeIsEmpty = (range: Range): boolean => {
  try {
    return !range.toString().trim();
  } catch {
    return true;
  }
};

const MAX_BLOCKS = 5000;

export function* getBlocks(doc: Document): Generator<Range> {
  if (!doc?.body) return;

  let last: Range | null = null;
  let count = 0;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);

  for (let node = walker.nextNode(); node && count < MAX_BLOCKS; node = walker.nextNode()) {
    const name = (node as Element).tagName?.toLowerCase();
    if (name && blockTags.has(name)) {
      if (last) {
        try {
          last.setEndBefore(node);
          if (!rangeIsEmpty(last)) {
            yield last;
            count++;
          }
        } catch {}
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
    return;
  }

  if (!last) {
    try {
      last = doc.createRange();
      const startNode = doc.body.firstChild ?? doc.body;
      last.setStart(startNode, 0);
    } catch {
      return;
    }
  }

  try {
    const endNode = doc.body.lastChild ?? doc.body;
    last.setEndAfter(endNode);
    if (!rangeIsEmpty(last)) yield last;
  } catch {}
}

export class ParagraphIterator {
  #blocks: Range[] = [];
  #index = -1;

  constructor(doc: Document) {
    try {
      // convert generator to array with timeout protection
      const blocks: Range[] = [];
      for (const block of getBlocks(doc)) {
        blocks.push(block);
      }
      this.#blocks = blocks;
    } catch (e) {
      console.error('ParagraphIterator: Failed to get blocks', e);
      this.#blocks = [];
    }
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
    // fallback to first
    return this.first();
  }

  findByRange(targetRange: Range | null): Range | null {
    if (!targetRange) return this.first();

    for (let i = 0; i < this.#blocks.length; i++) {
      const block = this.#blocks[i];
      if (!block) continue;
      try {
        // check if ranges overlap
        const startToEnd = block.compareBoundaryPoints(Range.START_TO_END, targetRange);
        const endToStart = block.compareBoundaryPoints(Range.END_TO_START, targetRange);
        if (startToEnd >= 0 && endToStart <= 0) {
          this.#index = i;
          return block;
        }
      } catch {
        // ranges might be in different documents
        continue;
      }
    }
    return this.findClosestToRange(targetRange);
  }

  findClosestToRange(targetRange: Range | null): Range | null {
    if (this.#blocks.length === 0) return null;
    if (!targetRange) return this.first();

    let targetRect: DOMRect;
    try {
      targetRect = targetRange.getBoundingClientRect();
    } catch {
      return this.first();
    }

    let closestIndex = 0;
    let closestDistance = Infinity;

    for (let i = 0; i < this.#blocks.length; i++) {
      const block = this.#blocks[i];
      if (!block) continue;
      try {
        const blockRect = block.getBoundingClientRect();
        const distance = Math.abs(blockRect.top - targetRect.top);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = i;
        }
      } catch {
        continue;
      }
    }

    this.#index = closestIndex;
    return this.#blocks[closestIndex] ?? null;
  }
}
