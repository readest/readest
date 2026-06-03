// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { TxtToEpubConverter, extractTxtFilenameMetadata } from '@/utils/txt';

type TestChapter = {
  title: string;
  content: string;
  isVolume: boolean;
};

type TestMetadata = {
  bookTitle: string;
  author: string;
  language: string;
  identifier: string;
};

type TxtConverterPrivateAPI = {
  detectEncoding(buffer: ArrayBuffer): string | undefined;
  createEpub(chapters: TestChapter[], metadata: TestMetadata): Promise<Blob>;
};

type TxtConverterFlowPrivateAPI = TxtConverterPrivateAPI & {
  convert(options: { file: File; author?: string; language?: string }): Promise<{
    chapterCount: number;
  }>;
  extractChapters(
    txtContent: string,
    metadata: TestMetadata,
    option: { linesBetweenSegments: number; fallbackParagraphsPerChapter: number },
  ): TestChapter[];
  probeChapterCount(
    txtContent: string,
    metadata: TestMetadata,
    option: { linesBetweenSegments: number; fallbackParagraphsPerChapter: number },
  ): number;
  iterateSegmentsFromTextChunks(
    chunks: Iterable<string>,
    linesBetweenSegments: number,
  ): Generator<string>;
  detectEncodingFromFile(file: File): Promise<string | undefined>;
  extractChaptersFromFileBySegments(
    file: File,
    encoding: string,
    metadata: TestMetadata,
    option: { linesBetweenSegments: number; fallbackParagraphsPerChapter: number },
  ): Promise<TestChapter[]>;
  probeChapterCountFromFileBySegments(
    file: File,
    encoding: string,
    metadata: TestMetadata,
    option: { linesBetweenSegments: number; fallbackParagraphsPerChapter: number },
  ): Promise<number>;
};

const getBufferSize = (input?: BufferSource): number => {
  if (!input) return 0;
  return input instanceof ArrayBuffer ? input.byteLength : input.byteLength;
};

describe('TxtToEpubConverter', () => {
  it('convert should choose 8 -> 7 when probe detects multiple chapters', async () => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterFlowPrivateAPI;
    const calls: number[] = [];

    converter.detectEncoding = () => 'utf-8';
    converter.createEpub = async () => new Blob();
    converter.extractChapters = (_, __, option) => {
      calls.push(option.linesBetweenSegments);
      if (option.linesBetweenSegments === 8) {
        return [{ title: 'Only', content: 'c', isVolume: false }];
      }
      if (option.linesBetweenSegments === 7) {
        return [
          { title: 'A', content: 'a', isVolume: false },
          { title: 'B', content: 'b', isVolume: false },
        ];
      }
      return [{ title: 'Fallback', content: 'f', isVolume: false }];
    };
    converter.probeChapterCount = (_, __, option) => {
      calls.push(option.linesBetweenSegments);
      return 2;
    };

    const file = new File(['dummy content'], 'sample.txt');
    const result = await converter.convert({ file });

    expect(calls).toEqual([8, 7, 7]);
    expect(result.chapterCount).toBe(2);
  });

  it('convert should choose 8 -> 6 when probe does not detect multiple chapters', async () => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterFlowPrivateAPI;
    const calls: number[] = [];

    converter.detectEncoding = () => 'utf-8';
    converter.createEpub = async () => new Blob();
    converter.extractChapters = (_, __, option) => {
      calls.push(option.linesBetweenSegments);
      if (option.linesBetweenSegments === 8) {
        return [{ title: 'Only', content: 'c', isVolume: false }];
      }
      if (option.linesBetweenSegments === 6) {
        return [
          { title: 'A', content: 'a', isVolume: false },
          { title: 'B', content: 'b', isVolume: false },
        ];
      }
      return [{ title: 'Single', content: 's', isVolume: false }];
    };
    converter.probeChapterCount = (_, __, option) => {
      calls.push(option.linesBetweenSegments);
      return 1;
    };

    const file = new File(['dummy content'], 'sample.txt');
    const result = await converter.convert({ file });

    expect(calls).toEqual([8, 7, 6]);
    expect(result.chapterCount).toBe(2);
  });

  it('detectEncoding should probe UTF-8 with sampled buffers only', () => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterPrivateAPI;
    const fullSize = 220 * 1024;
    const buffer = new TextEncoder().encode('a'.repeat(fullSize)).buffer;

    const OriginalTextDecoder = globalThis.TextDecoder;
    const decodeSizes: number[] = [];

    class RecordingTextDecoder extends OriginalTextDecoder {
      override decode(input?: BufferSource, options?: TextDecodeOptions): string {
        decodeSizes.push(getBufferSize(input));
        return super.decode(input, options);
      }
    }

    (globalThis as { TextDecoder: typeof TextDecoder }).TextDecoder =
      RecordingTextDecoder as typeof TextDecoder;
    try {
      expect(converter.detectEncoding(buffer)).toBe('utf-8');
    } finally {
      (globalThis as { TextDecoder: typeof TextDecoder }).TextDecoder = OriginalTextDecoder;
    }

    expect(Math.max(...decodeSizes)).toBeLessThanOrEqual(64 * 1024);
    expect(decodeSizes).toContain(8192);
    expect(decodeSizes).not.toContain(fullSize);
  });

  it('createEpub should use metadata language for chapter lang attributes', async () => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterPrivateAPI;
    const chapters: TestChapter[] = [
      {
        title: 'Chapter 1',
        content: '<h2>Chapter 1</h2><p>Hello world</p>',
        isVolume: false,
      },
    ];
    const metadata: TestMetadata = {
      bookTitle: 'Sample Book',
      author: 'Sample Author',
      language: 'zh',
      identifier: 'sample-id',
    };

    const blob = await converter.createEpub(chapters, metadata);
    const { ZipReader, BlobReader, TextWriter } = await import('@zip.js/zip.js');
    const reader = new ZipReader(new BlobReader(blob));
    try {
      const entries = await reader.getEntries();
      const chapterEntry = entries.find((entry) => entry.filename === 'OEBPS/chapter1.xhtml') as {
        getData?: (writer: unknown) => Promise<string>;
      };
      expect(chapterEntry).toBeDefined();
      const chapterContent = await chapterEntry?.getData?.(new TextWriter());
      expect(chapterContent).toContain('lang="zh"');
      expect(chapterContent).toContain('xml:lang="zh"');
    } finally {
      await reader.close();
    }
  });

  it('iterateSegmentsFromTextChunks should split by 8 newlines across chunk boundaries', () => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterFlowPrivateAPI;
    const chunks = ['Segment A\n\n\n\n', '\n\n\n\nSegment B'];

    const segments = Array.from(converter.iterateSegmentsFromTextChunks(chunks, 8));

    expect(segments).toEqual(['Segment A', 'Segment B']);
  });

  it('convert should use chunked path for large files without calling file.arrayBuffer', async () => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterFlowPrivateAPI;
    const calls: number[] = [];
    let arrayBufferCalled = false;
    const backingBlob = new Blob(['Header line\n\n\n\n\n\n\n\nChapter content']);

    const largeFile = {
      name: 'large.txt',
      size: 9 * 1024 * 1024,
      slice: (start?: number, end?: number) => backingBlob.slice(start, end),
      stream: () => backingBlob.stream(),
      arrayBuffer: async () => {
        arrayBufferCalled = true;
        throw new Error('large path should not call file.arrayBuffer');
      },
    } as unknown as File;

    converter.detectEncodingFromFile = async () => 'utf-8';
    converter.createEpub = async () => new Blob();
    converter.extractChaptersFromFileBySegments = async (_, __, ___, option) => {
      calls.push(option.linesBetweenSegments);
      if (option.linesBetweenSegments === 8) {
        return [{ title: 'Only', content: 'c', isVolume: false }];
      }
      if (option.linesBetweenSegments === 7) {
        return [
          { title: 'A', content: 'a', isVolume: false },
          { title: 'B', content: 'b', isVolume: false },
        ];
      }
      return [{ title: 'Fallback', content: 'f', isVolume: false }];
    };
    converter.probeChapterCountFromFileBySegments = async (_, __, ___, option) => {
      calls.push(option.linesBetweenSegments);
      return 2;
    };

    const result = await converter.convert({ file: largeFile });

    expect(arrayBufferCalled).toBe(false);
    expect(calls).toEqual([8, 7, 7]);
    expect(result.chapterCount).toBe(2);
  });

  it('convert large file should execute real chunked extraction without file.arrayBuffer', async () => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterFlowPrivateAPI;
    let arrayBufferCalled = false;
    const backingBlob = new Blob(['Segment A\n\n\n\n\n\n\n\nSegment B']);

    const largeFile = {
      name: 'large.txt',
      size: 9 * 1024 * 1024,
      slice: (start?: number, end?: number) => backingBlob.slice(start, end),
      stream: () => backingBlob.stream(),
      arrayBuffer: async () => {
        arrayBufferCalled = true;
        throw new Error('large path should not call file.arrayBuffer');
      },
    } as unknown as File;

    converter.createEpub = async () => new Blob();

    const result = await converter.convert({ file: largeFile });

    expect(arrayBufferCalled).toBe(false);
    expect(result.chapterCount).toBe(2);
  });

  it('convert large file should work when stream() is built from slice() like RemoteFile', async () => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterFlowPrivateAPI;
    const content = '第一章 开始\n这是第一章的内容。\n\n第二章 继续\n这是第二章的内容。';
    const backingBlob = new Blob([content]);

    // Simulate a fixed RemoteFile: stream() reads data via slice(), not from base File([])
    const fixedFile = new File([], 'large.txt');
    const fileSize = 9 * 1024 * 1024;
    Object.defineProperty(fixedFile, 'size', { value: fileSize });
    Object.defineProperty(fixedFile, 'slice', {
      value: (start?: number, end?: number) => backingBlob.slice(start, end),
    });
    Object.defineProperty(fixedFile, 'stream', {
      value: () => {
        const CHUNK_SIZE = 1024 * 1024;
        let offset = 0;
        return new ReadableStream<Uint8Array>({
          pull: async (controller) => {
            if (offset >= fileSize) {
              controller.close();
              return;
            }
            const end = Math.min(offset + CHUNK_SIZE, fileSize);
            const buf = await backingBlob.slice(offset, end).arrayBuffer();
            controller.enqueue(new Uint8Array(buf));
            offset = end;
          },
        });
      },
    });

    converter.createEpub = async () => new Blob();

    const result = await converter.convert({ file: fixedFile });
    expect(result.chapterCount).toBeGreaterThanOrEqual(1);
  });

  it('convert large file should fail when stream() returns empty data (unfixed RemoteFile)', async () => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterFlowPrivateAPI;

    // Simulate the bug: RemoteFile with unoverridden stream() returns empty data
    const brokenFile = new File([], 'large.txt');
    Object.defineProperty(brokenFile, 'size', { value: 9 * 1024 * 1024 });
    Object.defineProperty(brokenFile, 'slice', {
      value: (start?: number, end?: number) =>
        new Blob(['第一章 开始\n内容\n\n第二章 继续\n内容']).slice(start, end),
    });
    // stream() is NOT overridden — inherits base File's empty stream

    converter.createEpub = async () => new Blob();

    await expect(converter.convert({ file: brokenFile })).rejects.toThrow('No chapters detected');
  });

  it('iterateSegmentsFromFile should cancel stream on early return', async () => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterFlowPrivateAPI & {
      iterateSegmentsFromFile(
        file: File,
        encoding: string,
        linesBetweenSegments: number,
      ): AsyncGenerator<string>;
    };
    const encoder = new TextEncoder();
    let cancelled = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('Segment A\n\n\n\n\n\n\n\nSegment B'));
      },
      cancel() {
        cancelled = true;
      },
    });

    const file = {
      stream: () => stream,
    } as unknown as File;

    const iterator = converter.iterateSegmentsFromFile(file, 'utf-8', 8);
    const first = await iterator.next();
    expect(first.value).toBe('Segment A');
    await iterator.return(undefined);
    expect(cancelled).toBe(true);
  });
});

describe('scene-break dividers do not pollute the TOC (issue #4063)', () => {
  const zhMetadata: TestMetadata = {
    bookTitle: 'Test',
    author: '',
    language: 'zh',
    identifier: 'test',
  };
  const option = { linesBetweenSegments: 8, fallbackParagraphsPerChapter: 100 };
  const divider = '-'.repeat(37);

  it('keeps a single chapter when dash dividers split scene breaks', () => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterFlowPrivateAPI;
    const text = [
      '第15章',
      '这是第十五章的开头内容。',
      divider,
      '场景切换后的内容继续。',
      divider,
      '又一个场景的内容。',
    ].join('\n');

    const chapters = converter.extractChapters(text, zhMetadata, option);

    expect(chapters.length).toBe(1);
    expect(chapters[0]!.title).toContain('第15章');
    expect(chapters[0]!.content).toContain('场景切换后的内容继续');
    expect(chapters[0]!.content).toContain('又一个场景的内容');
  });

  it('merges mid-chapter content split off before the next heading', () => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterFlowPrivateAPI;
    const text = [
      '第1章',
      '绿水青山就是金山银山。',
      divider,
      '分隔符之后继续讲述的内容。',
      '第2章',
      '新的章节正式开始了。',
    ].join('\n');

    const chapters = converter.extractChapters(text, zhMetadata, option);

    expect(chapters.map((c) => c.title)).toEqual(['第1章', '第2章']);
    expect(chapters[0]!.content).toContain('分隔符之后继续讲述的内容');
    expect(chapters[0]!.content).not.toContain('<h3>');
  });

  it('still chunks heading-less plain text by paragraph fallback', () => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterFlowPrivateAPI;
    const paragraphs = Array.from({ length: 250 }, (_, i) => `段落${i + 1}`).join('\n');

    const chapters = converter.extractChapters(paragraphs, zhMetadata, option);

    expect(chapters.length).toBe(3);
  });

  it('merges divider-split scene breaks in the chunked file path', async () => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterFlowPrivateAPI;
    const text = [
      '第15章',
      '这是第十五章的开头内容。',
      divider,
      '场景切换后的内容继续。',
      divider,
      '又一个场景的内容。',
    ].join('\n');
    const file = new File([text], 'sample.txt');

    const chapters = await converter.extractChaptersFromFileBySegments(
      file,
      'utf-8',
      zhMetadata,
      option,
    );

    expect(chapters.length).toBe(1);
    expect(chapters[0]!.title).toContain('第15章');
  });
});

describe('extractTxtFilenameMetadata', () => {
  it('extracts the title from CJK 《》 brackets', () => {
    expect(extractTxtFilenameMetadata('《三体》.txt')).toEqual({ title: '三体' });
  });

  it('extracts title and labeled author with full-width colon', () => {
    expect(extractTxtFilenameMetadata('《书名》作者:张三.txt')).toEqual({
      title: '书名',
      author: '张三',
    });
    expect(extractTxtFilenameMetadata('《书名》作者：张三.txt')).toEqual({
      title: '书名',
      author: '张三',
    });
  });

  it('extracts title and labeled author with leading whitespace', () => {
    expect(extractTxtFilenameMetadata('《书名》 作者：张三.txt')).toEqual({
      title: '书名',
      author: '张三',
    });
  });

  it('extracts title and bracketed author after the title', () => {
    expect(extractTxtFilenameMetadata('《书名》[张三].txt')).toEqual({
      title: '书名',
      author: '张三',
    });
    expect(extractTxtFilenameMetadata('《书名》(张三).txt')).toEqual({
      title: '书名',
      author: '张三',
    });
    expect(extractTxtFilenameMetadata('《书名》【张三】.txt')).toEqual({
      title: '书名',
      author: '张三',
    });
  });

  it('extracts title and bare author after the title', () => {
    expect(extractTxtFilenameMetadata('《书名》张三.txt')).toEqual({
      title: '书名',
      author: '张三',
    });
  });

  it('strips leading/trailing punctuation from the author', () => {
    expect(extractTxtFilenameMetadata('《书名》 - 张三.txt')).toEqual({
      title: '书名',
      author: '张三',
    });
  });

  it('handles paths with directories', () => {
    expect(extractTxtFilenameMetadata('/inbox/《书名》作者：张三.txt')).toEqual({
      title: '书名',
      author: '张三',
    });
  });

  it('falls back to the base filename when no 《》 are present', () => {
    expect(extractTxtFilenameMetadata('plain-name.txt')).toEqual({ title: 'plain-name' });
  });

  it('returns empty object for empty input', () => {
    expect(extractTxtFilenameMetadata('')).toEqual({ title: '' });
  });

  // Chinese web-novel TXT files are commonly named with a 【】 title and a
  // labeled author tacked on, e.g. 【书名】1-129 作者：起落.txt. There are no 《》,
  // so the whole name stays the title, but the labeled author must still be
  // extracted. See issue #4390.
  it('extracts a labeled author from a 【】-titled filename without 《》 (issue #4390)', () => {
    expect(extractTxtFilenameMetadata('【细雨飘香】1-129 作者：起落.txt')).toEqual({
      title: '【细雨飘香】1-129 作者：起落',
      author: '起落',
    });
    expect(extractTxtFilenameMetadata('【月如无恨月长圆】（1-154）作者：陈西.txt')).toEqual({
      title: '【月如无恨月长圆】（1-154）作者：陈西',
      author: '陈西',
    });
  });

  it('does not mistake a leading 【tag】 for the author when no 作者 label is present', () => {
    expect(extractTxtFilenameMetadata('【完结】斗破苍穹.txt')).toEqual({
      title: '【完结】斗破苍穹',
    });
  });
});

describe('author resolution during conversion (issue #4390)', () => {
  const convertAndCaptureMetadata = async (name: string, content: string) => {
    const converter = new TxtToEpubConverter() as unknown as TxtConverterFlowPrivateAPI;
    let captured: TestMetadata | undefined;
    converter.detectEncoding = () => 'utf-8';
    converter.createEpub = async (_chapters, metadata) => {
      captured = metadata;
      return new Blob();
    };
    converter.extractChapters = () => [{ title: '第一章', content: '正文', isVolume: false }];
    const file = new File([content], name);
    await converter.convert({ file });
    return captured;
  };

  it('falls back to the filename author when the header has none (missing author)', async () => {
    const metadata = await convertAndCaptureMetadata(
      '【细雨飘香】1-129 作者：起落.txt',
      '第一章 初见\n正文内容……\n',
    );
    expect(metadata?.author).toBe('起落');
  });

  it('rejects a metadata-blob header author and uses the filename author (irrelevant content)', async () => {
    const metadata = await convertAndCaptureMetadata(
      '【月如无恨月长圆】（1-154）作者：陈西.txt',
      '作者：2024/08/01发表于：是否首发：是字数1023150字116:01\n第一章 初见\n正文内容……\n',
    );
    expect(metadata?.author).toBe('陈西');
  });

  it('keeps a clean labeled author parsed from the file header', async () => {
    const metadata = await convertAndCaptureMetadata(
      '【幻灵幽火】1-23未完结 作者：月夜银狐.txt',
      '作者：月夜银狐\n第一章 初见\n正文内容……\n',
    );
    expect(metadata?.author).toBe('月夜银狐');
  });
});
