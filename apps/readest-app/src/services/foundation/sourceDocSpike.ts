export interface SourceDocSection {
  id: string;
  title: string;
  ordinal: number;
  level?: number;
  parentId?: string | null;
}

export interface SourceDocBlock {
  id: string;
  sectionId: string;
  ordinal: number;
  type: 'heading' | 'paragraph' | 'code' | 'table' | 'list' | 'math';
  sourceText: string;
  semanticText: string;
  renderSelector: string;
}

export interface SourceDocFixture {
  id: string;
  versionId?: string;
  title: string;
  sourceName?: string;
  sourceFormat?: 'markdown' | 'source_doc';
  contentHash?: string;
  sections: SourceDocSection[];
  blocks: SourceDocBlock[];
}

export interface SourceDocAnchor {
  blockId: string;
  endBlockId: string;
  selectedBlockIds: string[];
  sectionId: string;
  exactQuote: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
}

export interface SourceDocCitation {
  id?: string;
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
  title: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  messages: SourceDocMessage[];
}

interface DocumentRecord {
  id: string;
  title: string;
  sourceFormat: 'markdown' | 'source_doc';
  createdAt: string;
  updatedAt: string;
}

interface DocumentVersionRecord {
  id: string;
  documentId: string;
  contentSha256: string;
  sourceName: string;
  byteSize: number;
  parserVersion: string;
  importedAt: string;
}

interface SectionRecord extends SourceDocSection {
  documentVersionId: string;
  level: number;
  parentId: string | null;
  renderKey: string;
}

interface BlockRecord extends SourceDocBlock {
  documentVersionId: string;
  textSha256: string;
}

interface AnchorRecord extends SourceDocAnchor {
  id: string;
  documentVersionId: string;
  kind: 'selection';
  createdAt: string;
}

interface ThreadRecord {
  id: string;
  anchorId: string;
  title: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

interface MessageRecord {
  id: string;
  threadId: string;
  sequenceNo: number;
  role: 'user' | 'assistant';
  content: string;
  state: 'complete';
  createdAt: string;
  updatedAt: string;
}

interface CitationRecord {
  id: string;
  messageId: string;
  anchorId: string;
  ordinal: number;
}

export interface AnnotationSchemaV1 {
  schemaVersion: 1;
  currentDocumentVersionId: string;
  documents: DocumentRecord[];
  documentVersions: DocumentVersionRecord[];
  sections: SectionRecord[];
  blocks: BlockRecord[];
  anchors: AnchorRecord[];
  threads: ThreadRecord[];
  messages: MessageRecord[];
  citations: CitationRecord[];
}

export interface SourceDocThreadGroup {
  blockId: string;
  count: number;
  threads: SourceDocThread[];
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
  versionId: 'source-doc-foundation-v1-version',
  title: '紧致性与极值：底座验证文档',
  sourceName: 'NL-270 内置测试文档',
  sourceFormat: 'source_doc',
  contentHash: 'foundation-v1',
  sections: [
    { id: 'section-01', title: '第一章：局部到全局', ordinal: 0, level: 1 },
    { id: 'section-02', title: '第二章：证明结构', ordinal: 1, level: 1 },
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

const LEGACY_STORAGE_KEY = 'readest:foundation-spike:v1';
const SCHEMA_STORAGE_KEY = 'readest:annotation-schema:v1';
const CONTEXT_LENGTH = 16;
const PARSER_VERSION = 'markdown-alpha-2';
const FIXED_REPLIES = [
  '从所选原文看，这个问题的关键是把局部条件和最终结论连接起来；另一处原文给出了补充步骤。',
  '可以先按定义理解所选句子，再对照另一章节的论证。当前回答来自本地固定候选，不代表模型判断。',
  '这段话强调了条件、过程与结论的关系。建议结合下方两条原文证据逐句核对。',
] as const;

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid
    ? `${prefix}-${uuid}`
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function markdownToSemanticText(source: string, type?: SourceDocBlock['type']): string {
  const plain = source
    .replace(/^```[^\n]*\n?/gm, '')
    .replace(/^```$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (type === 'table') {
    return plain
      .split('\n')
      .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
      .flatMap((line) => line.replace(/^\s*\||\|\s*$/g, '').split(/\s*\|\s*/))
      .map((cell) => cell.trim())
      .join('');
  }
  return type === 'list' ? plain.replace(/\n/g, '') : plain;
}

function mapRemovedCharactersOffset(previous: string, next: string, offset: number): number {
  let previousOffset = 0;
  let nextOffset = 0;
  while (previousOffset < offset && nextOffset < next.length) {
    if (previous[previousOffset] === next[nextOffset]) nextOffset += 1;
    previousOffset += 1;
  }
  return nextOffset;
}

function migrateMarkdownSemantics(schema: AnnotationSchemaV1): boolean {
  let migrated = false;
  for (const version of schema.documentVersions) {
    const document = schema.documents.find((item) => item.id === version.documentId);
    if (document?.sourceFormat !== 'markdown' || version.parserVersion === PARSER_VERSION) continue;
    const oldTextByBlock = new Map<string, string>();
    for (const block of schema.blocks.filter((item) => item.documentVersionId === version.id)) {
      oldTextByBlock.set(block.id, block.semanticText);
      block.semanticText = markdownToSemanticText(block.sourceText, block.type);
    }
    for (const anchor of schema.anchors.filter((item) => item.documentVersionId === version.id)) {
      const firstBlock = schema.blocks.find((item) => item.id === anchor.blockId);
      const lastBlock = schema.blocks.find((item) => item.id === anchor.endBlockId);
      const oldFirstText = oldTextByBlock.get(anchor.blockId);
      const oldLastText = oldTextByBlock.get(anchor.endBlockId);
      if (!firstBlock || !lastBlock || oldFirstText === undefined || oldLastText === undefined)
        continue;
      anchor.startOffset = mapRemovedCharactersOffset(
        oldFirstText,
        firstBlock.semanticText,
        anchor.startOffset,
      );
      anchor.endOffset = mapRemovedCharactersOffset(
        oldLastText,
        lastBlock.semanticText,
        anchor.endOffset,
      );
      anchor.exactQuote = anchor.selectedBlockIds
        .flatMap((blockId, index) => {
          const block = schema.blocks.find((item) => item.id === blockId);
          if (!block) return [];
          return block.semanticText.slice(
            index === 0 ? anchor.startOffset : 0,
            index === anchor.selectedBlockIds.length - 1
              ? anchor.endOffset
              : block.semanticText.length,
          );
        })
        .join('\n');
      anchor.prefix = firstBlock.semanticText.slice(
        Math.max(0, anchor.startOffset - CONTEXT_LENGTH),
        anchor.startOffset,
      );
      anchor.suffix = lastBlock.semanticText.slice(
        anchor.endOffset,
        anchor.endOffset + CONTEXT_LENGTH,
      );
    }
    version.parserVersion = PARSER_VERSION;
    migrated = true;
  }
  return migrated;
}

export function parseMarkdownDocument(sourceName: string, markdown: string): SourceDocFixture {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw new Error('Markdown 文件不能为空');
  const contentHash = stableHash(normalized);
  const documentId = `markdown-${stableHash(sourceName.toLowerCase())}`;
  const versionId = `${documentId}-${contentHash}`;
  const sections: SourceDocSection[] = [];
  const blocks: SourceDocBlock[] = [];
  const chunks: string[] = [];
  const lines = normalized.split('\n');
  for (let index = 0; index < lines.length; ) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith('```')) {
      const chunk = [line];
      index += 1;
      while (index < lines.length) {
        chunk.push(lines[index]!);
        const closed = lines[index]!.startsWith('```');
        index += 1;
        if (closed) break;
      }
      chunks.push(chunk.join('\n'));
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      chunks.push(line);
      index += 1;
      continue;
    }
    if (/^(?:[-*+] |\d+\. )/.test(line)) {
      const chunk = [line];
      index += 1;
      while (index < lines.length && /^(?:[-*+] |\d+\. )/.test(lines[index]!)) {
        chunk.push(lines[index]!);
        index += 1;
      }
      chunks.push(chunk.join('\n'));
      continue;
    }
    const chunk = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !/^#{1,6}\s+|^```|^(?:[-*+] |\d+\. )/.test(lines[index]!)
    ) {
      chunk.push(lines[index]!);
      index += 1;
    }
    chunks.push(chunk.join('\n'));
  }
  let currentSectionId = `${versionId}-section-0`;
  let sectionOrdinal = 0;
  let title = sourceName.replace(/\.(md|markdown)$/i, '') || '未命名 Markdown';

  for (const rawChunk of chunks) {
    const sourceText = rawChunk.replace(/^\n/, '').trim();
    if (!sourceText) continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(sourceText);
    let type: SourceDocBlock['type'] = 'paragraph';
    if (heading) {
      type = 'heading';
      currentSectionId = `${versionId}-section-${sectionOrdinal}`;
      sections.push({
        id: currentSectionId,
        title: heading[2]!.trim(),
        ordinal: sectionOrdinal,
        level: heading[1]!.length,
      });
      if (blocks.length === 0) title = heading[2]!.trim();
      sectionOrdinal += 1;
    } else if (sourceText.startsWith('```')) {
      type = 'code';
    } else if (/^(?:[-*+] |\d+\. )/.test(sourceText)) {
      type = 'list';
    } else if (sourceText.includes('|') && sourceText.includes('\n')) {
      type = 'table';
    } else if (/^\$\$[\s\S]*\$\$$/.test(sourceText)) {
      type = 'math';
    }
    if (sections.length === 0) {
      sections.push({ id: currentSectionId, title, ordinal: sectionOrdinal, level: 0 });
      sectionOrdinal += 1;
    }
    const semanticText =
      type === 'code'
        ? sourceText
            .replace(/^```[^\n]*\n?/, '')
            .replace(/```$/, '')
            .trim()
        : markdownToSemanticText(sourceText, type);
    const ordinal = blocks.length;
    const id = `${versionId}-block-${ordinal}-${stableHash(sourceText)}`;
    blocks.push({
      id,
      sectionId: currentSectionId,
      ordinal,
      type,
      sourceText,
      semanticText,
      renderSelector: id,
    });
  }

  return {
    id: documentId,
    versionId,
    title,
    sourceName,
    sourceFormat: 'markdown',
    contentHash,
    sections,
    blocks,
  };
}

export function createSelectionAnchor(
  selectedBlock: SourceDocBlock,
  startOffset: number,
  endOffset: number,
): SourceDocAnchor {
  if (startOffset < 0 || endOffset <= startOffset || endOffset > selectedBlock.semanticText.length)
    throw new Error('Selection offsets are outside the source block');
  return {
    blockId: selectedBlock.id,
    endBlockId: selectedBlock.id,
    selectedBlockIds: [selectedBlock.id],
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

export function createRangeAnchor(
  document: SourceDocFixture,
  startBlockId: string,
  startOffset: number,
  endBlockId: string,
  endOffset: number,
): SourceDocAnchor {
  const startIndex = document.blocks.findIndex((item) => item.id === startBlockId);
  const endIndex = document.blocks.findIndex((item) => item.id === endBlockId);
  if (startIndex < 0 || endIndex < startIndex) throw new Error('Selection block range is invalid');
  const selectedBlocks = document.blocks.slice(startIndex, endIndex + 1);
  const firstBlock = selectedBlocks[0]!;
  const lastBlock = selectedBlocks.at(-1)!;
  if (
    startOffset < 0 ||
    startOffset >= firstBlock.semanticText.length ||
    endOffset <= 0 ||
    endOffset > lastBlock.semanticText.length ||
    (firstBlock.id === lastBlock.id && endOffset <= startOffset)
  )
    throw new Error('Selection offsets are outside the source block range');
  const exactQuote = selectedBlocks
    .map((item, index) =>
      item.semanticText.slice(
        index === 0 ? startOffset : 0,
        index === selectedBlocks.length - 1 ? endOffset : item.semanticText.length,
      ),
    )
    .join('\n');
  return {
    blockId: firstBlock.id,
    endBlockId: lastBlock.id,
    selectedBlockIds: selectedBlocks.map((item) => item.id),
    sectionId: firstBlock.sectionId,
    exactQuote,
    prefix: firstBlock.semanticText.slice(Math.max(0, startOffset - CONTEXT_LENGTH), startOffset),
    suffix: lastBlock.semanticText.slice(endOffset, endOffset + CONTEXT_LENGTH),
    startOffset,
    endOffset,
  };
}

export function validateCitation(document: SourceDocFixture, citation: SourceDocCitation): boolean {
  return (
    document.blocks
      .find((item) => item.id === citation.blockId)
      ?.semanticText.includes(citation.exactQuote) ?? false
  );
}

export function generateStubAnswer(
  document: SourceDocFixture,
  anchor: SourceDocAnchor,
  _question: string,
  random: () => number = Math.random,
): Pick<SourceDocMessage, 'content' | 'citations'> {
  const selected = document.blocks.find((item) => item.id === anchor.blockId);
  if (!selected) throw new Error('Selected block does not exist');
  const supporting =
    document.blocks.find(
      (item) =>
        item.id !== selected.id &&
        item.sectionId !== selected.sectionId &&
        item.type === 'paragraph',
    ) ??
    document.blocks.find((item) => item.id !== selected.id && item.type === 'paragraph') ??
    selected;
  const replyIndex = Math.min(
    FIXED_REPLIES.length - 1,
    Math.floor(random() * FIXED_REPLIES.length),
  );
  return {
    content: FIXED_REPLIES[replyIndex]!,
    citations: [
      {
        blockId: selected.id,
        exactQuote: selected.semanticText.slice(
          anchor.startOffset,
          anchor.blockId === anchor.endBlockId ? anchor.endOffset : selected.semanticText.length,
        ),
      },
      { blockId: supporting.id, exactQuote: supporting.semanticText },
    ],
  };
}

function emptySchema(document: SourceDocFixture): AnnotationSchemaV1 {
  const now = new Date().toISOString();
  const versionId = document.versionId ?? `${document.id}-version`;
  return {
    schemaVersion: 1,
    currentDocumentVersionId: versionId,
    documents: [
      {
        id: document.id,
        title: document.title,
        sourceFormat: document.sourceFormat ?? 'source_doc',
        createdAt: now,
        updatedAt: now,
      },
    ],
    documentVersions: [
      {
        id: versionId,
        documentId: document.id,
        contentSha256:
          document.contentHash ??
          stableHash(document.blocks.map((item) => item.sourceText).join('\n')),
        sourceName: document.sourceName ?? document.title,
        byteSize: document.blocks.reduce((size, item) => size + item.sourceText.length, 0),
        parserVersion: document.sourceFormat === 'markdown' ? PARSER_VERSION : 'source-doc-1',
        importedAt: now,
      },
    ],
    sections: document.sections.map((section) => ({
      ...section,
      documentVersionId: versionId,
      level: section.level ?? 1,
      parentId: section.parentId ?? null,
      renderKey: section.id,
    })),
    blocks: document.blocks.map((item) => ({
      ...item,
      documentVersionId: versionId,
      textSha256: stableHash(item.sourceText),
    })),
    anchors: [],
    threads: [],
    messages: [],
    citations: [],
  };
}

export class SourceDocSpikeStore {
  constructor(private readonly storage: Storage) {}

  private saveSchema(schema: AnnotationSchemaV1): void {
    try {
      this.storage.setItem(SCHEMA_STORAGE_KEY, JSON.stringify(schema));
    } catch (error) {
      console.warn('Unable to persist annotation schema', error);
    }
  }

  loadSchema(): AnnotationSchemaV1 {
    const schema = emptySchema(SOURCE_DOC_FIXTURE);
    try {
      const serialized = this.storage.getItem(SCHEMA_STORAGE_KEY);
      if (serialized) {
        const parsed = JSON.parse(serialized) as AnnotationSchemaV1;
        if (migrateMarkdownSemantics(parsed)) this.saveSchema(parsed);
        return parsed;
      }
      const legacy = this.storage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy) as Partial<SourceDocThread> & {
          anchor: SourceDocAnchor;
          messages: SourceDocMessage[];
        };
        const anchor = {
          ...parsed.anchor,
          endBlockId: parsed.anchor.endBlockId ?? parsed.anchor.blockId,
          selectedBlockIds: parsed.anchor.selectedBlockIds ?? [parsed.anchor.blockId],
        };
        this.insertThread(
          schema,
          SOURCE_DOC_FIXTURE,
          anchor,
          parsed.messages,
          parsed.id ?? createId('thread'),
          parsed.title,
        );
      }
    } catch (error) {
      console.warn('Unable to load annotation schema', error);
    }
    this.saveSchema(schema);
    return schema;
  }

  loadCurrentDocument(): SourceDocFixture {
    const schema = this.loadSchema();
    const version = schema.documentVersions.find(
      (item) => item.id === schema.currentDocumentVersionId,
    )!;
    const document = schema.documents.find((item) => item.id === version.documentId)!;
    return {
      id: document.id,
      versionId: version.id,
      title: document.title,
      sourceName: version.sourceName,
      sourceFormat: document.sourceFormat,
      contentHash: version.contentSha256,
      sections: schema.sections
        .filter((item) => item.documentVersionId === version.id)
        .sort((left, right) => left.ordinal - right.ordinal),
      blocks: schema.blocks
        .filter((item) => item.documentVersionId === version.id)
        .sort((left, right) => left.ordinal - right.ordinal),
    };
  }

  importMarkdown(sourceName: string, markdown: string): SourceDocFixture {
    const imported = parseMarkdownDocument(sourceName, markdown);
    const schema = this.loadSchema();
    const addition = emptySchema(imported);
    schema.documents = [
      ...schema.documents.filter((item) => item.id !== imported.id),
      ...addition.documents,
    ];
    if (!schema.documentVersions.some((item) => item.id === imported.versionId)) {
      schema.documentVersions.push(...addition.documentVersions);
      schema.sections.push(...addition.sections);
      schema.blocks.push(...addition.blocks);
    }
    schema.currentDocumentVersionId = imported.versionId!;
    this.saveSchema(schema);
    return imported;
  }

  private insertThread(
    schema: AnnotationSchemaV1,
    document: SourceDocFixture,
    anchor: SourceDocAnchor,
    messages: SourceDocMessage[],
    threadId: string,
    title?: string,
  ): void {
    const now = new Date().toISOString();
    const versionId = document.versionId ?? schema.currentDocumentVersionId;
    const anchorId = createId('anchor');
    schema.anchors.push({
      ...anchor,
      id: anchorId,
      documentVersionId: versionId,
      kind: 'selection',
      createdAt: now,
    });
    schema.threads.push({
      id: threadId,
      anchorId,
      title:
        title ||
        messages.find((item) => item.role === 'user')?.content.slice(0, 40) ||
        anchor.exactQuote.slice(0, 40),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    messages.forEach((message, sequenceNo) => {
      schema.messages.push({
        id: message.id,
        threadId,
        sequenceNo,
        role: message.role,
        content: message.content,
        state: 'complete',
        createdAt: now,
        updatedAt: now,
      });
      this.insertCitations(schema, document, message);
    });
  }

  private insertCitations(
    schema: AnnotationSchemaV1,
    document: SourceDocFixture,
    message: SourceDocMessage,
  ): void {
    const now = new Date().toISOString();
    message.citations.forEach((citation, ordinal) => {
      const target = document.blocks.find((item) => item.id === citation.blockId);
      if (!target) return;
      const anchorId = createId('anchor');
      const startOffset = Math.max(0, target.semanticText.indexOf(citation.exactQuote));
      schema.anchors.push({
        id: anchorId,
        documentVersionId: document.versionId ?? schema.currentDocumentVersionId,
        blockId: target.id,
        endBlockId: target.id,
        selectedBlockIds: [target.id],
        sectionId: target.sectionId,
        kind: 'selection',
        exactQuote: citation.exactQuote,
        prefix: '',
        suffix: '',
        startOffset,
        endOffset: startOffset + citation.exactQuote.length,
        createdAt: now,
      });
      schema.citations.push({
        id: citation.id ?? createId('citation'),
        messageId: message.id,
        anchorId,
        ordinal,
      });
    });
  }

  private hydrateThread(schema: AnnotationSchemaV1, record: ThreadRecord): SourceDocThread | null {
    const storedAnchor = schema.anchors.find((item) => item.id === record.anchorId);
    if (!storedAnchor) return null;
    const {
      id: _id,
      documentVersionId: _documentVersionId,
      kind: _kind,
      createdAt: _createdAt,
      ...anchor
    } = storedAnchor;
    const messages = schema.messages
      .filter((item) => item.threadId === record.id)
      .sort((left, right) => left.sequenceNo - right.sequenceNo)
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        citations: schema.citations
          .filter((item) => item.messageId === message.id)
          .sort((left, right) => left.ordinal - right.ordinal)
          .flatMap((citation) => {
            const citationAnchor = schema.anchors.find((item) => item.id === citation.anchorId);
            return citationAnchor
              ? [
                  {
                    id: citation.id,
                    blockId: citationAnchor.blockId,
                    exactQuote: citationAnchor.exactQuote,
                  },
                ]
              : [];
          }),
      }));
    return {
      id: record.id,
      anchor,
      title: record.title,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      messages,
    };
  }

  listThreads(): SourceDocThread[] {
    const schema = this.loadSchema();
    return schema.threads
      .filter((record) => {
        const anchor = schema.anchors.find((item) => item.id === record.anchorId);
        return anchor?.documentVersionId === schema.currentDocumentVersionId;
      })
      .map((record) => this.hydrateThread(schema, record))
      .filter((thread): thread is SourceDocThread => thread !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  listThreadGroups(): SourceDocThreadGroup[] {
    const groups = new Map<string, SourceDocThread[]>();
    for (const thread of this.listThreads())
      groups.set(thread.anchor.blockId, [...(groups.get(thread.anchor.blockId) ?? []), thread]);
    return [...groups].map(([blockId, threads]) => ({ blockId, count: threads.length, threads }));
  }

  getThread(threadId: string): SourceDocThread | null {
    return this.listThreads().find((item) => item.id === threadId) ?? null;
  }

  load(): SourceDocThread | null {
    return this.listThreads()[0] ?? null;
  }

  ask(
    document: SourceDocFixture,
    anchor: SourceDocAnchor,
    question: string,
    threadId?: string,
  ): SourceDocThread {
    const schema = this.loadSchema();
    let record = threadId ? schema.threads.find((item) => item.id === threadId) : undefined;
    if (!record) {
      const id = createId('thread');
      this.insertThread(schema, document, anchor, [], id, question.slice(0, 40));
      record = schema.threads.find((item) => item.id === id)!;
    }
    const now = new Date().toISOString();
    const sequence = schema.messages.filter((item) => item.threadId === record.id).length;
    const userMessage: SourceDocMessage = {
      id: createId('message'),
      role: 'user',
      content: question,
      citations: [],
    };
    const answer = generateStubAnswer(document, anchor, question);
    const assistantMessage: SourceDocMessage = {
      id: createId('message'),
      role: 'assistant',
      content: answer.content,
      citations: answer.citations,
    };
    for (const [offset, message] of [userMessage, assistantMessage].entries()) {
      schema.messages.push({
        id: message.id,
        threadId: record.id,
        sequenceNo: sequence + offset,
        role: message.role,
        content: message.content,
        state: 'complete',
        createdAt: now,
        updatedAt: now,
      });
      this.insertCitations(schema, document, message);
    }
    record.updatedAt = now;
    this.saveSchema(schema);
    return this.hydrateThread(schema, record)!;
  }

  renameThread(threadId: string, title: string): void {
    const schema = this.loadSchema();
    const thread = schema.threads.find((item) => item.id === threadId);
    if (!thread || !title.trim()) return;
    thread.title = title.trim();
    thread.updatedAt = new Date().toISOString();
    this.saveSchema(schema);
  }

  editMessage(messageId: string, content: string): void {
    const schema = this.loadSchema();
    const message = schema.messages.find((item) => item.id === messageId);
    if (!message || !content.trim()) return;
    message.content = content.trim();
    message.updatedAt = new Date().toISOString();
    const thread = schema.threads.find((item) => item.id === message.threadId);
    if (thread) thread.updatedAt = message.updatedAt;
    this.saveSchema(schema);
  }

  setThreadArchived(threadId: string, archived: boolean): void {
    const schema = this.loadSchema();
    const thread = schema.threads.find((item) => item.id === threadId);
    if (!thread) return;
    thread.status = archived ? 'archived' : 'active';
    thread.updatedAt = new Date().toISOString();
    this.saveSchema(schema);
  }

  deleteThread(threadId: string): void {
    this.deleteThreads([threadId]);
  }

  deleteThreads(threadIds: string[]): void {
    if (threadIds.length === 0) return;
    const schema = this.loadSchema();
    const targetIds = new Set(threadIds);
    const threads = schema.threads.filter((item) => targetIds.has(item.id));
    if (threads.length === 0) return;
    const messageIds = new Set(
      schema.messages.filter((item) => targetIds.has(item.threadId)).map((item) => item.id),
    );
    const citationAnchorIds = new Set(
      schema.citations
        .filter((item) => messageIds.has(item.messageId))
        .map((item) => item.anchorId),
    );
    schema.citations = schema.citations.filter((item) => !messageIds.has(item.messageId));
    schema.messages = schema.messages.filter((item) => !targetIds.has(item.threadId));
    schema.threads = schema.threads.filter((item) => !targetIds.has(item.id));
    const threadAnchorIds = new Set(threads.map((item) => item.anchorId));
    schema.anchors = schema.anchors.filter(
      (item) => !threadAnchorIds.has(item.id) && !citationAnchorIds.has(item.id),
    );
    this.saveSchema(schema);
  }

  clear(): void {
    try {
      this.storage.removeItem(SCHEMA_STORAGE_KEY);
      this.storage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) {
      console.warn('Unable to clear annotation schema', error);
    }
  }
}
