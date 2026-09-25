import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';

export type LatexBlockKind =
  | 'section'
  | 'paragraph'
  | 'definition'
  | 'theorem'
  | 'lemma'
  | 'proposition'
  | 'corollary'
  | 'proof'
  | 'example'
  | 'remark'
  | 'formula'
  | 'figure'
  | 'table'
  | 'bibliography';

export interface LatexSourceBlock {
  id: string;
  kind: LatexBlockKind;
  label: string;
  semanticText: string;
  sourceText: string;
  sourceFile: string;
  startLine: number;
  endLine: number;
  latexLabel?: string;
  locationQuality: 'page' | 'unmapped';
  page?: number;
}

export interface ParsedLatexSource {
  title: string;
  sourceFile: string;
  blocks: LatexSourceBlock[];
}

export interface LatexSourceSidecar extends ParsedLatexSource {
  version: 1;
  rawSource: string;
  pdf: { name: string; contentHash: string };
  source: { name: string; contentHash: string };
  mapping: { quality: 'page' | 'unmapped'; reason: string };
  createdAt: number;
}

const ENVIRONMENT_LABELS: Record<string, { kind: LatexBlockKind; label: string }> = {
  definition: { kind: 'definition', label: '定义' },
  theorem: { kind: 'theorem', label: '定理' },
  lemma: { kind: 'lemma', label: '引理' },
  proposition: { kind: 'proposition', label: '命题' },
  corollary: { kind: 'corollary', label: '推论' },
  proof: { kind: 'proof', label: '证明' },
  example: { kind: 'example', label: '例子' },
  remark: { kind: 'remark', label: '备注' },
  figure: { kind: 'figure', label: '图' },
  table: { kind: 'table', label: '表' },
  thebibliography: { kind: 'bibliography', label: '参考文献' },
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const hashFile = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const lineAt = (source: string, offset: number): number =>
  source.slice(0, offset).split('\n').length;

const READABLE_MATH_COMMANDS = new Set([
  'max',
  'min',
  'sup',
  'inf',
  'lim',
  'sum',
  'prod',
  'int',
  'forall',
  'exists',
]);

const unwrapCommands = (value: string): string =>
  value
    .replace(/%[^\n]*/g, '')
    .replace(/\\(?:label|ref|eqref|cite|pageref)\*?\{([^{}]*)\}/g, '$1')
    .replace(
      /\\(?:textbf|textit|emph|textrm|textsf|texttt|mathrm|mathbf|mathit)\*?\{([^{}]*)\}/g,
      '$1',
    )
    .replace(/\\(?:begin|end)\{[^{}]+\}/g, '')
    .replace(/\\([a-zA-Z@]+)\*?(?:\[[^\]]*\])?/g, (_match, command: string) =>
      READABLE_MATH_COMMANDS.has(command) ? command : '',
    )
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const makeBlock = (
  sourceFile: string,
  source: string,
  kind: LatexBlockKind,
  label: string,
  sourceText: string,
  start: number,
): LatexSourceBlock | null => {
  const semanticText = unwrapCommands(sourceText);
  if (!semanticText && kind !== 'formula') return null;
  const startLine = lineAt(source, start);
  return {
    id: `latex-${kind}-${startLine}-${stableHash(sourceText)}`,
    kind,
    label,
    semanticText: semanticText || sourceText.trim(),
    sourceText: sourceText.trim(),
    sourceFile,
    startLine,
    endLine: startLine + sourceText.split('\n').length - 1,
    latexLabel: sourceText.match(/\\label\{([^{}]+)\}/)?.[1],
    locationQuality: 'page',
  };
};

export const parseLatexSource = (sourceFile: string, rawSource: string): ParsedLatexSource => {
  const source = rawSource.replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  const title =
    unwrapCommands(source.match(/\\title\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/)?.[1] ?? '') ||
    sourceFile.replace(/\.tex$/i, '');
  const blocks: LatexSourceBlock[] = [];
  const occupied: Array<[number, number]> = [];
  const push = (block: LatexSourceBlock | null, start: number, end: number) => {
    if (!block) return;
    blocks.push(block);
    occupied.push([start, end]);
  };

  const sectionPattern =
    /\\(part|chapter|section|subsection|subsubsection)\*?\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  for (const match of source.matchAll(sectionPattern)) {
    const start = match.index;
    push(
      makeBlock(sourceFile, source, 'section', '章节', match[2] ?? '', start),
      start,
      start + match[0].length,
    );
  }

  for (const [environment, description] of Object.entries(ENVIRONMENT_LABELS)) {
    const pattern = new RegExp(
      `\\\\begin\\{${environment}\\*?\\}([\\s\\S]*?)\\\\end\\{${environment}\\*?\\}`,
      'g',
    );
    for (const match of source.matchAll(pattern)) {
      const start = match.index;
      push(
        makeBlock(sourceFile, source, description.kind, description.label, match[1] ?? '', start),
        start,
        start + match[0].length,
      );
    }
  }

  const displayFormulaPattern = /\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g;
  for (const match of source.matchAll(displayFormulaPattern)) {
    const start = match.index;
    push(
      makeBlock(sourceFile, source, 'formula', '公式', match[1] ?? match[2] ?? '', start),
      start,
      start + match[0].length,
    );
  }

  let offset = 0;
  for (const line of source.split('\n')) {
    const text = line.trim();
    const start = offset + line.indexOf(text);
    const end = start + text.length;
    offset += line.length + 1;
    if (
      !text ||
      text.startsWith('%') ||
      text.startsWith('\\') ||
      text === '$$' ||
      occupied.some(([left, right]) => start >= left && end <= right)
    ) {
      continue;
    }
    const block = makeBlock(sourceFile, source, 'paragraph', '正文', text, start);
    if (block && block.semanticText.length >= 2) blocks.push(block);
  }

  blocks.sort((left, right) => left.startLine - right.startLine || left.id.localeCompare(right.id));
  return { title, sourceFile, blocks };
};

export const createLatexSourceSidecar = async (
  pdfFile: File,
  sourceFile: File,
): Promise<LatexSourceSidecar> => {
  const rawSource = await sourceFile.text();
  const parsed = parseLatexSource(sourceFile.name, rawSource);
  return {
    version: 1,
    rawSource,
    ...parsed,
    pdf: { name: pdfFile.name, contentHash: await hashFile(pdfFile) },
    source: { name: sourceFile.name, contentHash: await hashFile(sourceFile) },
    mapping: { quality: 'page', reason: '未提供 SyncTeX 映射文件' },
    createdAt: Date.now(),
  };
};

export const latexSidecarPath = (book: Book): string => `${book.hash}/latex-source.json`;

export const saveLatexSourceSidecar = async (
  appService: AppService,
  book: Book,
  pdfFile: File,
  sourceFile: File,
): Promise<LatexSourceSidecar> => {
  const sidecar = await createLatexSourceSidecar(pdfFile, sourceFile);
  await appService.writeFile(latexSidecarPath(book), 'Books', JSON.stringify(sidecar));
  return sidecar;
};

export const loadLatexSourceSidecar = async (
  appService: AppService,
  book: Book,
): Promise<LatexSourceSidecar | null> => {
  const path = latexSidecarPath(book);
  if (!(await appService.exists(path, 'Books'))) return null;
  try {
    const serialized = await appService.readFile(path, 'Books', 'text');
    const sidecar = JSON.parse(String(serialized)) as LatexSourceSidecar;
    return sidecar.version === 1 && Array.isArray(sidecar.blocks) ? sidecar : null;
  } catch {
    return null;
  }
};

export const sourcePairKey = (filename: string): string =>
  filename
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(?:pdf|tex)$/i, '')
    .toLocaleLowerCase();

export const pairLatexImports = <T>(files: T[], getFilename: (file: T) => string) => {
  const latexSources = new Map<string, T>();
  for (const file of files) {
    const filename = getFilename(file);
    if (/\.tex$/i.test(filename)) latexSources.set(sourcePairKey(filename), file);
  }

  const importableFiles = files.filter((file) => !/\.tex$/i.test(getFilename(file)));
  const pairedLatexKeys = new Set(
    importableFiles
      .map(getFilename)
      .filter((filename) => /\.pdf$/i.test(filename))
      .map(sourcePairKey)
      .filter((key) => latexSources.has(key)),
  );
  const unpairedLatexSources = [...latexSources]
    .filter(([key]) => !pairedLatexKeys.has(key))
    .map(([, source]) => source);

  return { importableFiles, latexSources, unpairedLatexSources };
};
