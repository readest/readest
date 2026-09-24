import { Readability } from '@mozilla/readability';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { Book, BookFormat } from '@/types/book';
import { sanitizeForParsing, sanitizeHtml } from '@/utils/sanitize';
import type {
  SourceDocBlock,
  SourceDocBlockType,
  SourceDocFixture,
  SourceDocFormat,
  SourceDocLocator,
  SourceDocSection,
} from './sourceDocSpike';
import { parseMarkdownDocument } from './sourceDocSpike';

export type TxtEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030' | 'big5' | 'shift_jis';
export type HtmlImportMode = 'article' | 'full';

export interface SourceDocumentCapabilities {
  supportsStableOffsets: boolean;
  supportsCrossBlockSelection: boolean;
  supportsCrossSectionSelection: boolean;
  supportsImages: boolean;
  supportsTables: boolean;
  supportsMath: boolean;
  supportsReflow: boolean;
}

export interface SourceDocumentWarning {
  code:
    | 'encoding-low-confidence'
    | 'html-content-reduced'
    | 'remote-images-blocked'
    | 'safe-mode'
    | 'fixed-layout';
  message: string;
}

export interface SourceDocumentParseOptions {
  documentIdentity: string;
  title?: string;
  txtEncoding?: TxtEncoding;
  htmlMode?: HtmlImportMode;
  allowRemoteImages?: boolean;
}

export interface SourceDocumentParseResult {
  document: SourceDocFixture;
  warnings: SourceDocumentWarning[];
  txtEncoding?: TxtEncoding;
  htmlMode?: HtmlImportMode;
  blockedRemoteImages?: number;
}

export interface SourceDocumentAdapter {
  readonly format: SourceDocFormat;
  readonly capabilities: SourceDocumentCapabilities;
  parse(file: File, options: SourceDocumentParseOptions): Promise<SourceDocumentParseResult>;
}

const COMMON_CAPABILITIES: SourceDocumentCapabilities = {
  supportsStableOffsets: true,
  supportsCrossBlockSelection: true,
  supportsCrossSectionSelection: true,
  supportsImages: false,
  supportsTables: true,
  supportsMath: false,
  supportsReflow: true,
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const stableByteHash = (bytes: ArrayBuffer): string => {
  let hash = 2166136261;
  for (const byte of new Uint8Array(bytes)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const normalizeText = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .normalize('NFC');

const documentIds = (
  format: SourceDocFormat,
  identity: string,
  content: string,
  sourceHash = stableHash(content),
) => {
  const id = `${format}-library-${stableHash(identity)}`;
  const contentHash = sourceHash;
  return { id, versionId: `${id}-${contentHash}`, contentHash };
};

const blockTypeForElement = (element: Element): SourceDocBlockType => {
  if (/^H[1-6]$/.test(element.tagName)) return 'heading';
  if (element.matches('pre, code')) return 'code';
  if (element.matches('table')) return 'table';
  if (element.matches('ul, ol')) return 'list';
  if (element.matches('math')) return 'math';
  return 'paragraph';
};

const semanticTextForElement = (element: Element): string => {
  if (element.matches('img')) {
    return element.getAttribute('alt')?.trim() || element.getAttribute('title')?.trim() || '图片';
  }
  if (element.matches('table')) {
    return Array.from(element.querySelectorAll('tr'))
      .map((row) =>
        Array.from(row.querySelectorAll('th, td'))
          .map((cell) => cell.textContent?.trim() ?? '')
          .filter(Boolean)
          .join(' | '),
      )
      .filter(Boolean)
      .join('\n');
  }
  if (element.matches('ul, ol')) {
    return Array.from(element.querySelectorAll(':scope > li'))
      .map((item) => item.textContent?.trim() ?? '')
      .filter(Boolean)
      .join('\n');
  }
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
};

const sourceTextForBlock = (type: SourceDocBlockType, text: string): string => {
  if (type === 'heading') return `## ${text}`;
  if (type === 'code') return `\`\`\`\n${text}\n\`\`\``;
  if (type === 'list')
    return text
      .split('\n')
      .map((line) => `- ${line}`)
      .join('\n');
  return text;
};

const markdownForElement = (element: Element, type: SourceDocBlockType, text: string): string => {
  if (element.matches('img')) {
    const source = element.getAttribute('src') ?? '';
    return source ? `![${text.replace(/[\[\]]/g, '')}](${source})` : text;
  }
  return sourceTextForBlock(type, text);
};

const blocksFromDocument = (
  doc: Document,
  versionId: string,
  sectionCfi?: string,
  spineIndex?: number,
): { sections: SourceDocSection[]; blocks: SourceDocBlock[] } => {
  const sections: SourceDocSection[] = [];
  const blocks: SourceDocBlock[] = [];
  let currentSectionId = `${versionId}-section-${spineIndex ?? 0}-0`;
  let sectionOrdinal = 0;
  const candidates = Array.from(
    doc.body.querySelectorAll(
      'h1, h2, h3, h4, h5, h6, p, blockquote, pre, table, ul, ol, math, img',
    ),
  ).filter((element) => !element.parentElement?.closest('p, blockquote, pre, table, ul, ol, math'));

  for (const element of candidates) {
    const semanticText = semanticTextForElement(element);
    if (!semanticText) continue;
    const type = blockTypeForElement(element);
    if (type === 'heading' || sections.length === 0) {
      currentSectionId = `${versionId}-section-${spineIndex ?? 0}-${sectionOrdinal}`;
      sections.push({
        id: currentSectionId,
        title: type === 'heading' ? semanticText : doc.title || `第 ${sectionOrdinal + 1} 节`,
        ordinal: sectionOrdinal,
        level: type === 'heading' ? Number(element.tagName.slice(1)) : 1,
        locator: sectionCfi ? { kind: 'epub', spineIndex: spineIndex ?? 0, sectionCfi } : undefined,
      });
      sectionOrdinal += 1;
    }
    const ordinal = blocks.length;
    const sourceText = markdownForElement(element, type, semanticText);
    const locator: SourceDocLocator | undefined = sectionCfi
      ? {
          kind: 'epub',
          spineIndex: spineIndex ?? 0,
          sectionCfi,
          domPath: `${element.tagName.toLowerCase()}:${ordinal}`,
        }
      : { kind: 'html', domPath: `${element.tagName.toLowerCase()}:${ordinal}` };
    const id = `${versionId}-block-${spineIndex ?? 0}-${ordinal}-${stableHash(semanticText)}`;
    blocks.push({
      id,
      sectionId: currentSectionId,
      ordinal,
      type,
      sourceText,
      semanticText,
      renderSelector: id,
      locator,
    });
  }
  return { sections, blocks };
};

const titleFromBook = (book: BookDoc, fallback: string): string => {
  const title = book.metadata.title;
  if (typeof title === 'string') return title || fallback;
  return Object.values(title ?? {})[0] || fallback;
};

const scoreDecodedText = (text: string): number => {
  if (!text) return Number.NEGATIVE_INFINITY;
  const replacement = (text.match(/�/g) ?? []).length;
  const controls = (text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) ?? []).length;
  const readable = (text.match(/[\p{L}\p{N}\p{P}\p{Zs}\r\n]/gu) ?? []).length;
  return readable / text.length - replacement * 8 - controls * 4;
};

const decodeWith = (bytes: ArrayBuffer, encoding: TxtEncoding): string =>
  normalizeText(new TextDecoder(encoding).decode(bytes));

export const detectTxtEncoding = (
  bytes: ArrayBuffer,
): { encoding: TxtEncoding; confidence: number; text: string } => {
  const view = new Uint8Array(bytes);
  if (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
    return { encoding: 'utf-8', confidence: 1, text: decodeWith(bytes, 'utf-8') };
  }
  if (view[0] === 0xff && view[1] === 0xfe) {
    return { encoding: 'utf-16le', confidence: 1, text: decodeWith(bytes, 'utf-16le') };
  }
  if (view[0] === 0xfe && view[1] === 0xff) {
    return { encoding: 'utf-16be', confidence: 1, text: decodeWith(bytes, 'utf-16be') };
  }
  const candidates = (['utf-8', 'gb18030', 'big5', 'shift_jis'] as const)
    .map((encoding) => {
      const text = decodeWith(bytes, encoding);
      return { encoding, text, score: scoreDecodedText(text) };
    })
    .sort((left, right) => right.score - left.score);
  const best = candidates[0]!;
  const second = candidates[1]!;
  return {
    encoding: best.encoding,
    confidence: Math.max(0, Math.min(1, (best.score - second.score) * 4 + 0.5)),
    text: best.text,
  };
};

const txtSectionsAndBlocks = (
  text: string,
  versionId: string,
): { sections: SourceDocSection[]; blocks: SourceDocBlock[] } => {
  const sections: SourceDocSection[] = [];
  const blocks: SourceDocBlock[] = [];
  const paragraphs: Array<{ text: string; startLine: number }> = [];
  let segmentStart = 0;
  for (const separator of text.matchAll(/\n\s*\n+/g)) {
    const raw = text.slice(segmentStart, separator.index);
    const paragraph = raw.trim();
    if (paragraph) {
      const leading = raw.indexOf(paragraph);
      paragraphs.push({
        text: paragraph,
        startLine: text.slice(0, segmentStart + Math.max(0, leading)).split('\n').length,
      });
    }
    segmentStart = separator.index + separator[0].length;
  }
  const tail = text.slice(segmentStart);
  const tailParagraph = tail.trim();
  if (tailParagraph) {
    const leading = tail.indexOf(tailParagraph);
    paragraphs.push({
      text: tailParagraph,
      startLine: text.slice(0, segmentStart + Math.max(0, leading)).split('\n').length,
    });
  }
  let sectionIndex = 0;
  let currentSectionId = `${versionId}-section-0`;
  sections.push({ id: currentSectionId, title: '正文', ordinal: 0, level: 1, generated: true });
  for (const paragraphRecord of paragraphs) {
    const paragraph = paragraphRecord.text;
    const heading =
      /^(?:第[\p{L}\p{N}零〇一二三四五六七八九十百千万两兩壹贰貳叁叄參肆伍陆陸柒捌玖拾佰仟]+[章节卷部]|chapter\s+\d+)/iu.test(
        paragraph,
      );
    if (heading) {
      sectionIndex += 1;
      currentSectionId = `${versionId}-section-${sectionIndex}`;
      sections.push({
        id: currentSectionId,
        title: paragraph.split('\n')[0]!,
        ordinal: sectionIndex,
        level: 1,
        generated: true,
      });
    }
    const ordinal = blocks.length;
    const type: SourceDocBlockType = heading ? 'heading' : 'paragraph';
    const id = `${versionId}-block-${ordinal}-${stableHash(paragraph)}`;
    blocks.push({
      id,
      sectionId: currentSectionId,
      ordinal,
      type,
      sourceText: paragraph,
      semanticText: paragraph,
      renderSelector: id,
      locator: {
        kind: 'text',
        startLine: paragraphRecord.startLine,
      },
    });
  }
  return { sections, blocks };
};

const txtAdapter: SourceDocumentAdapter = {
  format: 'txt',
  capabilities: COMMON_CAPABILITIES,
  async parse(file, options) {
    const bytes = await file.arrayBuffer();
    const detected = detectTxtEncoding(bytes);
    const encoding = options.txtEncoding ?? detected.encoding;
    const text = options.txtEncoding ? decodeWith(bytes, encoding) : detected.text;
    if (!text.trim()) throw new Error('TXT 文件没有可阅读的文字');
    const { id, versionId, contentHash } = documentIds(
      'txt',
      options.documentIdentity,
      text,
      stableByteHash(bytes),
    );
    const parsed = txtSectionsAndBlocks(text, versionId);
    return {
      document: {
        id,
        versionId,
        title: options.title || file.name.replace(/\.txt$/i, '') || '未命名 TXT',
        sourceName: file.name,
        sourceFormat: 'txt',
        contentHash,
        capabilities: this.capabilities,
        ...parsed,
      },
      warnings:
        detected.confidence < 0.7
          ? [{ code: 'encoding-low-confidence', message: '文字显示异常？可以换一种编码。' }]
          : [],
      txtEncoding: encoding,
    };
  },
};

const htmlAdapter: SourceDocumentAdapter = {
  format: 'html',
  capabilities: { ...COMMON_CAPABILITIES, supportsImages: true, supportsMath: true },
  async parse(file, options) {
    const rawHtml = await file.text();
    const original = new DOMParser().parseFromString(sanitizeForParsing(rawHtml), 'text/html');
    for (const element of Array.from(original.querySelectorAll('svg, math'))) {
      const fallback = original.createElement('pre');
      const label = element.tagName.toLowerCase() === 'math' ? '公式' : '图示';
      const readable = element.textContent?.replace(/\s+/g, ' ').trim();
      fallback.textContent = readable ? `${label}：${readable}` : `${label}（已安全降级）`;
      element.replaceWith(fallback);
    }
    const originalTextLength = original.body.textContent?.trim().length ?? 0;
    let selectedHtml = original.body.innerHTML;
    let extractedTitle = original.title.trim();
    if ((options.htmlMode ?? 'article') === 'article') {
      try {
        const result = new Readability(original.cloneNode(true) as Document).parse();
        if (result?.content) selectedHtml = result.content;
        if (result?.title?.trim()) extractedTitle = result.title.trim();
      } catch {}
    }
    const safeHtml = sanitizeHtml(selectedHtml);
    const safeDoc = new DOMParser().parseFromString(safeHtml, 'text/html');
    let blockedRemoteImages = 0;
    for (const image of Array.from(safeDoc.querySelectorAll('img'))) {
      const source = image.getAttribute('src') ?? '';
      if (!/^https?:/i.test(source) || options.allowRemoteImages) continue;
      blockedRemoteImages += 1;
      const placeholder = safeDoc.createElement('p');
      placeholder.textContent = `远程图片已阻止${image.alt ? `：${image.alt}` : ''}`;
      placeholder.setAttribute('data-remote-image', source);
      image.replaceWith(placeholder);
    }
    const semanticContent = safeDoc.body.textContent?.trim() ?? '';
    if (!semanticContent) throw new Error('HTML 没有可安全显示的正文');
    const { id, versionId, contentHash } = documentIds('html', options.documentIdentity, rawHtml);
    const parsed = blocksFromDocument(safeDoc, versionId);
    const warnings: SourceDocumentWarning[] = [];
    if (blockedRemoteImages > 0) {
      warnings.push({
        code: 'remote-images-blocked',
        message: `已阻止 ${blockedRemoteImages} 张远程图片自动联网。`,
      });
    }
    if (
      (options.htmlMode ?? 'article') === 'article' &&
      originalTextLength > 0 &&
      semanticContent.length / originalTextLength < 0.35
    ) {
      warnings.push({
        code: 'html-content-reduced',
        message: '正文抽取可能遗漏内容，可以切换为“显示完整网页”。',
      });
    }
    return {
      document: {
        id,
        versionId,
        title: options.title || extractedTitle || file.name.replace(/\.html?$/i, ''),
        sourceName: file.name,
        sourceFormat: 'html',
        contentHash,
        capabilities: this.capabilities,
        ...parsed,
      },
      warnings,
      htmlMode: options.htmlMode ?? 'article',
      blockedRemoteImages,
    };
  },
};

const epubAdapter: SourceDocumentAdapter = {
  format: 'epub',
  capabilities: { ...COMMON_CAPABILITIES, supportsImages: true, supportsMath: true },
  async parse(file, options) {
    const { book, format } = await new DocumentLoader(file).open();
    try {
      if (format !== 'EPUB') throw new Error('文件不是有效的 EPUB');
      if (book.rendition.layout === 'pre-paginated') {
        throw new Error('固定版式 EPUB 暂不支持 AI 文本批注，请使用原生阅读器打开');
      }
      const sectionDocuments: Array<{ index: number; cfi: string; doc: Document }> = [];
      for (const [index, section] of book.sections.entries()) {
        if (section.linear === 'no') continue;
        const doc = await section.createDocument();
        if (doc.body.textContent?.trim()) sectionDocuments.push({ index, cfi: section.cfi, doc });
      }
      const semanticContent = sectionDocuments
        .map(({ doc }) => doc.body.textContent?.trim() ?? '')
        .join('\n');
      if (!semanticContent) throw new Error('EPUB 中没有可提取的正文');
      const { id, versionId, contentHash } = documentIds(
        'epub',
        options.documentIdentity,
        semanticContent,
      );
      const sections: SourceDocSection[] = [];
      const blocks: SourceDocBlock[] = [];
      for (const sectionDocument of sectionDocuments) {
        const parsed = blocksFromDocument(
          sectionDocument.doc,
          versionId,
          sectionDocument.cfi,
          sectionDocument.index,
        );
        const sectionIdMap = new Map<string, string>();
        for (const section of parsed.sections) {
          const id = `${section.id}-${sections.length}`;
          sectionIdMap.set(section.id, id);
          sections.push({ ...section, id, ordinal: sections.length });
        }
        for (const item of parsed.blocks) {
          blocks.push({
            ...item,
            id: `${item.id}-${blocks.length}`,
            sectionId: sectionIdMap.get(item.sectionId) ?? sections.at(-1)!.id,
            ordinal: blocks.length,
          });
        }
      }
      return {
        document: {
          id,
          versionId,
          title: options.title || titleFromBook(book, file.name.replace(/\.epub$/i, '')),
          sourceName: file.name,
          sourceFormat: 'epub',
          contentHash,
          capabilities: this.capabilities,
          sections,
          blocks,
        },
        warnings: [],
      };
    } finally {
      await book.destroy?.();
    }
  },
};

const markdownAdapter: SourceDocumentAdapter = {
  format: 'markdown',
  capabilities: { ...COMMON_CAPABILITIES, supportsMath: true },
  async parse(file, options) {
    const document = parseMarkdownDocument(file.name, await file.text(), options.documentIdentity);
    return {
      document: {
        ...document,
        title: options.title || document.title,
        capabilities: this.capabilities,
      },
      warnings: [],
    };
  },
};

const ADAPTERS: Partial<Record<BookFormat, SourceDocumentAdapter>> = {
  MD: markdownAdapter,
  TXT: txtAdapter,
  HTML: htmlAdapter,
  EPUB: epubAdapter,
};

export const getSourceDocumentAdapter = (format: BookFormat): SourceDocumentAdapter | null =>
  ADAPTERS[format] ?? null;

export const supportsAiReadingWorkspace = (format: BookFormat): boolean => !!ADAPTERS[format];

export const parseLibrarySourceDocument = async (
  book: Book,
  file: File,
  options: Partial<Omit<SourceDocumentParseOptions, 'documentIdentity'>> = {},
): Promise<SourceDocumentParseResult> => {
  const adapter = getSourceDocumentAdapter(book.format);
  if (!adapter) throw new Error(`当前 AI 阅读工作台暂不支持 ${book.format} 格式`);
  return adapter.parse(file, {
    documentIdentity: book.hash,
    title: book.title,
    ...options,
  });
};
