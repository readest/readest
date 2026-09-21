export interface SourceDocSection {
  id: string;
  title: string;
  ordinal: number;
}

export interface SourceDocBlock {
  id: string;
  sectionId: string;
  ordinal: number;
  type: 'heading' | 'paragraph' | 'code' | 'table' | 'math';
  sourceText: string;
  semanticText: string;
  renderSelector: string;
}

export interface SourceDocFixture {
  id: string;
  title: string;
  sections: SourceDocSection[];
  blocks: SourceDocBlock[];
}

export interface SourceDocAnchor {
  blockId: string;
  sectionId: string;
  exactQuote: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
}

export interface SourceDocCitation {
  blockId: string;
  exactQuote: string;
}

export interface SourceDocMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: SourceDocCitation[];
}

export interface SourceDocThread {
  id: string;
  anchor: SourceDocAnchor;
  messages: SourceDocMessage[];
}

const block = (
  id: string,
  sectionId: string,
  ordinal: number,
  type: SourceDocBlock['type'],
  sourceText: string,
): SourceDocBlock => ({
  id,
  sectionId,
  ordinal,
  type,
  sourceText,
  semanticText: sourceText,
  renderSelector: id,
});

export const SOURCE_DOC_FIXTURE: SourceDocFixture = {
  id: 'source-doc-foundation-v1',
  title: '紧致性与极值：底座验证文档',
  sections: [
    { id: 'section-01', title: '第一章：局部到全局', ordinal: 0 },
    { id: 'section-02', title: '第二章：证明结构', ordinal: 1 },
  ],
  blocks: [
    block('block-01', 'section-01', 0, 'heading', '第一章：局部到全局'),
    block(
      'block-02',
      'section-01',
      1,
      'paragraph',
      '在分析学中，紧致性把局部信息提升为全局控制，并允许我们从无限过程里抽取收敛子列。',
    ),
    block(
      'block-03',
      'section-01',
      2,
      'paragraph',
      '对连续函数而言，紧致集上的像仍然紧致，因此函数能够取得最大值和最小值。',
    ),
    block(
      'block-04',
      'section-01',
      3,
      'math',
      '若 K 紧致且 f: K → R 连续，则存在 x₋, x₊ ∈ K 使 f(x₋) ≤ f(x) ≤ f(x₊)。',
    ),
    block(
      'block-05',
      'section-01',
      4,
      'code',
      'const maximum = values.reduce((left, right) => Math.max(left, right));',
    ),
    block(
      'block-06',
      'section-01',
      5,
      'table',
      '条件 | 作用\n紧致性 | 保证收敛子列\n连续性 | 保持极限',
    ),
    block('block-07', 'section-02', 6, 'heading', '第二章：证明结构'),
    block(
      'block-08',
      'section-02',
      7,
      'paragraph',
      '证明从一个极大化序列开始：选择 xₙ，使 f(xₙ) 逐渐逼近上确界。',
    ),
    block(
      'block-09',
      'section-02',
      8,
      'paragraph',
      '紧致性保证该序列存在收敛子列 xₙₖ → x，且极限 x 仍属于 K。',
    ),
    block(
      'block-10',
      'section-02',
      9,
      'paragraph',
      '连续性给出 f(xₙₖ) → f(x)，所以 f(x) 等于原序列逼近的上确界。',
    ),
    block(
      'block-11',
      'section-02',
      10,
      'paragraph',
      '最小值情形完全类似，也可以对函数 −f 应用最大值结论。',
    ),
    block(
      'block-12',
      'section-02',
      11,
      'paragraph',
      '本夹具用于验证稳定块、文本选择、连续追问、结构化引用和回跳，不代表真实模型回答。',
    ),
  ],
};

const STORAGE_KEY = 'readest:foundation-spike:v1';
const CONTEXT_LENGTH = 16;

export function createSelectionAnchor(
  selectedBlock: SourceDocBlock,
  startOffset: number,
  endOffset: number,
): SourceDocAnchor {
  if (
    startOffset < 0 ||
    endOffset <= startOffset ||
    endOffset > selectedBlock.semanticText.length
  ) {
    throw new Error('Selection offsets are outside the source block');
  }

  return {
    blockId: selectedBlock.id,
    sectionId: selectedBlock.sectionId,
    exactQuote: selectedBlock.semanticText.slice(startOffset, endOffset),
    prefix: selectedBlock.semanticText.slice(
      Math.max(0, startOffset - CONTEXT_LENGTH),
      startOffset,
    ),
    suffix: selectedBlock.semanticText.slice(endOffset, endOffset + CONTEXT_LENGTH),
    startOffset,
    endOffset,
  };
}

export function validateCitation(document: SourceDocFixture, citation: SourceDocCitation): boolean {
  const target = document.blocks.find((item) => item.id === citation.blockId);
  return target?.semanticText.includes(citation.exactQuote) ?? false;
}

export function generateStubAnswer(
  document: SourceDocFixture,
  anchor: SourceDocAnchor,
  question: string,
): Pick<SourceDocMessage, 'content' | 'citations'> {
  const selected = document.blocks.find((item) => item.id === anchor.blockId);
  if (!selected) throw new Error('Selected block does not exist');
  const supporting = document.blocks.find(
    (item) => item.sectionId !== selected.sectionId && item.type === 'paragraph',
  );
  if (!supporting) throw new Error('Supporting block does not exist');

  return {
    content: `这是确定性底座回答。问题“${question}”已绑定到所选原文，并通过另一章节的证明步骤补充依据。`,
    citations: [
      { blockId: selected.id, exactQuote: anchor.exactQuote },
      { blockId: supporting.id, exactQuote: supporting.semanticText },
    ],
  };
}

export class SourceDocSpikeStore {
  constructor(private readonly storage: Storage) {}

  load(): SourceDocThread | null {
    const serialized = this.storage.getItem(STORAGE_KEY);
    if (!serialized) return null;
    return JSON.parse(serialized) as SourceDocThread;
  }

  ask(document: SourceDocFixture, anchor: SourceDocAnchor, question: string): SourceDocThread {
    const existing = this.load();
    const thread: SourceDocThread =
      existing && existing.anchor.blockId === anchor.blockId
        ? existing
        : { id: `thread-${anchor.blockId}`, anchor, messages: [] };
    const sequence = thread.messages.length;
    const answer = generateStubAnswer(document, anchor, question);
    const updated: SourceDocThread = {
      ...thread,
      anchor,
      messages: [
        ...thread.messages,
        { id: `message-${sequence}`, role: 'user', content: question, citations: [] },
        {
          id: `message-${sequence + 1}`,
          role: 'assistant',
          content: answer.content,
          citations: answer.citations,
        },
      ],
    };
    this.storage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  }

  clear(): void {
    this.storage.removeItem(STORAGE_KEY);
  }
}
