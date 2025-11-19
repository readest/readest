import { partialMD5 } from './md5';
import { getBaseFilename } from './path';
import { detectLanguage } from './lang';

interface Metadata {
  bookTitle: string;
  author: string;
  language: string;
  identifier: string;
}

interface Chapter {
  title: string;
  content: string;
  text: string;
  isVolume: boolean;
}

interface Txt2EpubOptions {
  file: File;
  author?: string;
  language?: string;
}

interface ExtractChapterOptions {
  linesBetweenSegments: number;
  fallbackParagraphsPerChapter: number;
}

interface ConversionResult {
  file: File;
  bookTitle: string;
  chapterCount: number;
  language: string;
}

const zipWriteOptions = {
  lastAccessDate: new Date(0),
  lastModDate: new Date(0),
};

const escapeXml = (str: string) => {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

export class TxtToEpubConverter {
  public async convert(options: Txt2EpubOptions): Promise<ConversionResult> {
    const { file: txtFile, author: providedAuthor, language: providedLanguage } = options;

    const fileContent = await txtFile.arrayBuffer();
    const detectedEncoding = this.detectEncoding(fileContent) || 'utf-8';
    console.log(`Detected encoding: ${detectedEncoding}`);
    const decoder = new TextDecoder(detectedEncoding);
    const txtContent = decoder.decode(fileContent).trim();

    const bookTitle = this.extractBookTitle(getBaseFilename(txtFile.name));
    const fileName = `${bookTitle}.epub`;

    const fileHeader = txtContent.slice(0, 1024);
    const authorMatch =
      fileHeader.match(/[【\[]?作者[】\]]?[:：\s]\s*(.+)\r?\n/) ||
      fileHeader.match(/[【\[]?\s*(.+)\s+著\s*[】\]]?\r?\n/);
    let matchedAuthor = authorMatch ? authorMatch[1]!.trim() : providedAuthor || '';
    try {
      matchedAuthor = matchedAuthor.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
    } catch {}
    const author = matchedAuthor || providedAuthor || '';
    const language = providedLanguage || detectLanguage(fileHeader);
    console.log(`Detected language: ${language}`);
    const identifier = await partialMD5(txtFile);
    const metadata = { bookTitle, author, language, identifier };

    let chapters: Chapter[] = [];
    for (let i = 8; i >= 6; i--) {
      chapters = this.extractChapters(txtContent, metadata, {
        linesBetweenSegments: i,
        fallbackParagraphsPerChapter: 100,
      });

      if (chapters.length === 0) {
        throw new Error('No chapters detected.');
      } else if (chapters.length > 1) {
        break;
      }
    }

    const blob = await this.createEpub(chapters, metadata);
    return {
      file: new File([blob], fileName),
      bookTitle,
      chapterCount: chapters.length,
      language,
    };
  }

  private extractChapters(
    txtContent: string,
    metadata: Metadata,
    option: ExtractChapterOptions,
  ): Chapter[] {
    const { language } = metadata;
    const { linesBetweenSegments, fallbackParagraphsPerChapter } = option;
    const segmentRegex = new RegExp(`(?:\\r?\\n){${linesBetweenSegments},}|-{8,}\r?\n`);
    const chapterRegexps: RegExp[] = [];
    if (language === 'zh') {
      chapterRegexps.push(
        new RegExp(
          String.raw`(?:^|\n)\s*` +
            '(' +
            [
              String.raw`第[零〇一二三四五六七八九十0-9][零〇一二三四五六七八九十百千万0-9]*(?:[章卷节回讲篇封本册部话])(?:[：:、 　\(\)0-9]*[^\n-]{0,24})(?!\S)`,
              String.raw`(?:楔子|前言|简介|引言|序言|序章|总论|概论|后记)(?:[：: 　][^\n-]{0,24})?(?!\S)`,
              String.raw`chapter[\s.]*[0-9]+(?:[：:. 　]+[^\n-]{0,50})?(?!\S)`,
            ].join('|') +
            ')',
          'gui',
        ),
      );
      chapterRegexps.push(
        new RegExp(
          String.raw`(?:^|\n)\s*` +
            '(' +
            [
              String.raw`[一二三四五六七八九十][零〇一二三四五六七八九十百千万]?[：:、 　][^\n-]{0,24}(?=\n|$)`,
              String.raw`[0-9]+[^\n]{0,16}(?=\n|$)`,
            ].join('|') +
            ')',
          'gu',
        ),
      );
    } else {
      const chapterKeywords = ['Chapter', 'Part', 'Section', 'Book', 'Volume', 'Act'];

      const prefaceKeywords = [
        'Prologue',
        'Epilogue',
        'Introduction',
        'Foreword',
        'Preface',
        'Afterword',
      ];

      const numberPattern = String.raw`(\d+|(?:[IVXLCDM]{2,}|V|X|L|C|D|M)\b)`;
      const dotNumberPattern = String.raw`\.\d{1,4}`;
      const titlePattern = String.raw`[^\n]{0,50}`;

      const normalChapterPattern = chapterKeywords
        .map(
          (k) =>
            String.raw`${k}\s*(?:${numberPattern}|${dotNumberPattern})(?:[:.\-–—]?\s*${titlePattern})?`,
        )
        .join('|');

      const prefacePattern = prefaceKeywords
        .map((k) => String.raw`${k}(?:[:.\-–—]?\s*${titlePattern})?`)
        .join('|');

      const combinedPattern = String.raw`(?:^|\n|\s)(?:${normalChapterPattern}|${prefacePattern})(?=\s|$)`;

      chapterRegexps.push(new RegExp(combinedPattern, 'gi'));
    }

    const formatSegment = (segment: string): string => {
      segment = escapeXml(segment);
      return segment
        .replace(/-{8,}|_{8,}/g, '\n')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line)
        .join('</p><p>');
    };

    const joinAroundUndefined = (arr: (string | undefined)[]) =>
      arr.reduce<string[]>((acc, curr, i, src) => {
        if (
          curr === undefined &&
          i > 0 &&
          i < src.length - 1 &&
          src[i - 1] !== undefined &&
          src[i + 1] !== undefined
        ) {
          acc[acc.length - 1] += src[i + 1]!;
          return acc;
        }
        if (curr !== undefined && (i === 0 || src[i - 1] !== undefined)) {
          acc.push(curr);
        }
        return acc;
      }, []);

    const isGoodMatches = (matches: string[], maxLength: number = 100000): boolean => {
      const meaningfulParts = matches.filter((part) => part && part.trim().length > 0);
      if (meaningfulParts.length <= 1) return false;

      const hasLongParts = meaningfulParts.some((part) => part.length > maxLength);
      return !hasLongParts;
    };

    const chapters: Chapter[] = [];
    const segments = txtContent.split(segmentRegex);
    for (const segment of segments) {
      const trimmedSegment = segment.replace(/<!--.*?-->/g, '').trim();
      if (!trimmedSegment) continue;

      const segmentChapters: Chapter[] = [];
      let matches: string[] = [];
      for (const chapterRegex of chapterRegexps) {
        const tryMatches = trimmedSegment.split(chapterRegex);
        if (isGoodMatches(tryMatches)) {
          matches = joinAroundUndefined(tryMatches);
          break;
        }
      }

      if (matches.length === 0 && fallbackParagraphsPerChapter > 0) {
        const paragraphs = trimmedSegment.split(/\n+/);
        const totalParagraphs = paragraphs.length;
        for (let i = 0; i < totalParagraphs; i += fallbackParagraphsPerChapter) {
          const chunks = paragraphs.slice(i, i + fallbackParagraphsPerChapter);
          const formattedSegment = formatSegment(chunks.join('\n'));
          const title = `${chapters.length + 1}`;
          const content = `<h2>${title}</h2><p>${formattedSegment}</p>`;
          chapters.push({ title, content, text: chunks.join('\n'), isVolume: false });
        }
        continue;
      }

      for (let j = 1; j < matches.length; j += 2) {
        const title = matches[j]?.trim() || '';
        const content = matches[j + 1]?.trim() || '';

        let isVolume = false;
        if (language === 'zh') {
          isVolume = /第[零〇一二三四五六七八九十百千万0-9]+(卷|本|册|部)/.test(title);
        } else {
          isVolume = /\b(Part|Volume|Book)\b/i.test(title);
        }

        const headTitle = isVolume ? `<h1>${title}</h1>` : `<h2>${title}</h2>`;
        const formattedSegment = formatSegment(content);
        segmentChapters.push({
          title: escapeXml(title),
          content: `${headTitle}<p>${formattedSegment}</p>`,
          text: content,
          isVolume: isVolume,
        });
      }

      if (matches[0] && matches[0].trim()) {
        const initialContent = matches[0].trim();
        const firstLine = initialContent.split('\n')[0]!.trim();
        const segmentTitle =
          (firstLine.length > 16 ? initialContent.split(/[\n\s\p{P}]/u)[0]!.trim() : firstLine) ||
          initialContent.slice(0, 16);
        const formattedSegment = formatSegment(initialContent);
        segmentChapters.unshift({
          title: escapeXml(segmentTitle),
          content: `<h3></h3><p>${formattedSegment}</p>`,
          text: initialContent,
          isVolume: false,
        });
      }
      chapters.push(...segmentChapters);
    }

    return chapters;
  }

  private async createEpub(chapters: Chapter[], metadata: Metadata): Promise<Blob> {
    const { BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
    const { bookTitle, author, language, identifier } = metadata;

    const zipWriter = new ZipWriter(new BlobWriter('application/epub+zip'), {
      extendedTimestamp: false,
    });
    await zipWriter.add('mimetype', new TextReader('application/epub+zip'), zipWriteOptions);

    // Add META-INF/container.xml
    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles>
        <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`.trim();

    await zipWriter.add('META-INF/container.xml', new TextReader(containerXml), zipWriteOptions);

    // Create navigation points for TOC
    let isNested = false;
    let navPoints = ``;
    for (let i = 0; i < chapters.length; i++) {
      const id = `chapter${i + 1}`;
      const playOrder = i + 1;
      if (chapters[i]!.isVolume && isNested) {
        navPoints += `</navPoint>\n`;
        isNested = !isNested;
      }
      navPoints +=
        `<navPoint id="navPoint-${id}" playOrder="${playOrder}">\n` +
        `<navLabel><text>${chapters[i]!.title}</text></navLabel>\n` +
        `<content src="./OEBPS/${id}.xhtml" />\n`;
      if (chapters[i]!.isVolume && !isNested) {
        isNested = !isNested;
      } else {
        navPoints += `</navPoint>\n`;
      }
    }
    if (isNested) {
      navPoints += `</navPoint>`;
    }

    // Add NCX file (table of contents)
    const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
    <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
      <head>
        <meta name="dtb:uid" content="book-id" />
        <meta name="dtb:depth" content="1" />
        <meta name="dtb:totalPageCount" content="0" />
        <meta name="dtb:maxPageNumber" content="0" />
      </head>
      <docTitle>
        <text>${escapeXml(bookTitle)}</text>
      </docTitle>
      <docAuthor>
        <text>${escapeXml(author)}</text>
      </docAuthor>
      <navMap>
        ${navPoints}
      </navMap>
    </ncx>`.trim();

    await zipWriter.add('toc.ncx', new TextReader(tocNcx), zipWriteOptions);

    // Create manifest and spine items
    const manifest = chapters
      .map(
        (_, index) => `
      <item id="chap${index + 1}" href="OEBPS/chapter${index + 1}.xhtml" media-type="application/xhtml+xml"/>
    `,
      )
      .join('\n')
      .trim();

    const spine = chapters
      .map(
        (_, index) => `
      <itemref idref="chap${index + 1}"/>`,
      )
      .join('\n')
      .trim();

    // Add CSS stylesheet
    const css = `
      body { line-height: 1.6; font-size: 1em; font-family: 'Arial', sans-serif; text-align: justify; }
      p { text-indent: 2em; margin: 0; }
    `;

    await zipWriter.add('style.css', new TextReader(css), zipWriteOptions);

    // Add chapter files
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i]!;
      const lang = detectLanguage(chapter.text);
      const chapterContent = `<?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
        <html xmlns="http://www.w3.org/1999/xhtml" lang="${lang}" xml:lang="${lang}">
          <head>
            <title>${chapter.title}</title>
            <link rel="stylesheet" type="text/css" href="../style.css"/>
          </head>
          <body>${chapter.content}</body>
        </html>`.trim();

      await zipWriter.add(
        `OEBPS/chapter${i + 1}.xhtml`,
        new TextReader(chapterContent),
        zipWriteOptions,
      );
    }

    const tocManifest = `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`;
    const styleManifest = `<item id="css" href="style.css" media-type="text/css"/>`;

    // Add content.opf file
    const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="2.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>${escapeXml(bookTitle)}</dc:title>
          <dc:language>${language}</dc:language>
          <dc:creator>${escapeXml(author)}</dc:creator>
          <dc:identifier id="book-id">${identifier}</dc:identifier>
        </metadata>
        <manifest>
          ${manifest}
          ${tocManifest}
          ${styleManifest}
        </manifest>
        <spine toc="ncx">
          ${spine}
        </spine>
      </package>`.trim();

    await zipWriter.add('content.opf', new TextReader(contentOpf), zipWriteOptions);

    return await zipWriter.close();
  }

  private detectEncoding(buffer: ArrayBuffer): string | undefined {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      return 'utf-8';
    } catch {
      const uint8Array = new Uint8Array(buffer);
      // Try tolerant UTF-8 detection - check if most of it is valid UTF-8
      let validBytes = 0;
      let checkedBytes = 0;
      const sampleSize = Math.min(uint8Array.length, 10000);

      for (let i = 0; i < sampleSize; i++) {
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(uint8Array.slice(i, i + 100));
          validBytes += 100;
          checkedBytes += 100;
          i += 99;
        } catch {
          checkedBytes++;
        }
      }

      const validPercentage = (validBytes / checkedBytes) * 100;
      console.log(`UTF-8 validity: ${validPercentage.toFixed(2)}%`);

      // If more than 80% is valid UTF-8, consider it UTF-8 with some corruption
      if (validPercentage > 80) {
        console.log('Treating as UTF-8 despite some invalid sequences');
        return 'utf-8';
      }
      // If UTF-8 decoding fails, try to detect other encodings
    }

    const headerBytes = new Uint8Array(buffer.slice(0, 4));

    if (headerBytes[0] === 0xff && headerBytes[1] === 0xfe) {
      return 'utf-16le';
    }

    if (headerBytes[0] === 0xfe && headerBytes[1] === 0xff) {
      return 'utf-16be';
    }

    if (headerBytes[0] === 0xef && headerBytes[1] === 0xbb && headerBytes[2] === 0xbf) {
      return 'utf-8';
    }

    // Analyze a sample of the content to guess between common East Asian encodings
    // If the content has a high ratio of bytes in the 0x80-0xFF range, it's likely GBK/GB18030
    const sample = new Uint8Array(buffer.slice(0, Math.min(1024, buffer.byteLength)));
    let highByteCount = 0;

    for (let i = 0; i < sample.length; i++) {
      if (sample[i]! >= 0x80) {
        highByteCount++;
      }
    }

    const highByteRatio = highByteCount / sample.length;
    if (highByteRatio > 0.3) {
      return 'gbk';
    }

    if (highByteRatio > 0.1) {
      let sjisPattern = false;
      for (let i = 0; i < sample.length - 1; i++) {
        const b1 = sample[i]!;
        const b2 = sample[i + 1]!;
        if (
          ((b1 >= 0x81 && b1 <= 0x9f) || (b1 >= 0xe0 && b1 <= 0xfc)) &&
          ((b2 >= 0x40 && b2 <= 0x7e) || (b2 >= 0x80 && b2 <= 0xfc))
        ) {
          sjisPattern = true;
          break;
        }
      }

      if (sjisPattern) {
        return 'shift-jis';
      }

      return 'gb18030';
    }

    return 'utf-8';
  }

  private extractBookTitle(filename: string): string {
    const match = filename.match(/《([^》]+)》/);
    return match ? match[1]! : filename.split('.')[0]!;
  }
}
