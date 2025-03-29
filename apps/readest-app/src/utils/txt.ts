import { getBaseFilename } from './book';
import { partialMD5 } from './md5';

interface Metadata {
  bookTitle: string;
  author: string;
  language: string;
  identifier: string;
}

interface Chapter {
  title: string;
  content: string;
}

interface Txt2EpubOptions {
  file: File;
  author?: string;
  language?: string;
}

interface ExtractChapterOptions {
  linesBetweenSegments: number;
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

export class TxtToEpubConverter {
  public async convert(options: Txt2EpubOptions): Promise<ConversionResult> {
    const { file: txtFile, author: providedAuthor, language: providedLanguage } = options;

    const fileContent = await txtFile.arrayBuffer();
    const detectedEncoding = this.detectEncoding(fileContent) || 'utf-8';
    const decoder = new TextDecoder(detectedEncoding);
    const txtContent = decoder.decode(fileContent).trim();

    const bookTitle = this.extractBookTitle(getBaseFilename(txtFile.name));
    const fileName = `${bookTitle}.epub`;

    const fileHeader = txtContent.slice(0, 1024);
    const authorMatch =
      fileHeader.match(/[【\[]?作者[】\]]?[:：\s]\s*(.+)\r?\n/) ||
      fileHeader.match(/[【\[]?\s*(.+)\s+著\s*[】\]]?\r?\n/);
    const author = authorMatch ? authorMatch[1]!.trim() : providedAuthor || '';
    const language = providedLanguage || this.detectLanguage(fileHeader);
    const identifier = await partialMD5(txtFile);
    const metadata = { bookTitle, author, language, identifier };

    let chapters: Chapter[] = [];
    for (let i = 4; i >= 3; i--) {
      chapters = this.extractChapters(txtContent, metadata, {
        linesBetweenSegments: i,
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
    const { linesBetweenSegments } = option;
    const segmentRegex = new RegExp(`(?:\\r?\\n){${linesBetweenSegments},}|-{4,}\r?\n`);
    let chapterRegex: RegExp;
    if (language === 'zh') {
      chapterRegex =
        /(?:^|\n|\s|《[^》]+》)(第?[一二三四五六七八九十百千万0-9]+[章卷节回讲篇](?:[：:、 　\(\)0-9]+[^\n-]*)?(?!\S)|(?:^|\n|\s|《[^》]+》)[一二三四五六七八九十百千万]+(?:[：:、 　][^\n-]+)(?!\S)|(?:楔子|前言|引言|序言|序章|总论|概论)(?:[：: 　][^\n-]*)?(?!\S))/g;
    } else {
      chapterRegex =
        /(?:^|\n|\s)(Chapter [0-9]+(?:[: ][^\n]*)?(?!\S)|Part [0-9]+(?:[: ][^\n]*)?(?!\S)|Prologue(?:[: ][^\n]*)?(?!\S)|Introduction(?:[: ][^\n]*)?(?!\S))/g;
    }

    const formatSegment = (segment: string): string => {
      return segment
        .replace(/-{4,}|_{4,}/g, '\n')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line)
        .join('</p><p>');
    };

    const chapters: Chapter[] = [];
    const segments = txtContent.split(segmentRegex);
    for (const segment of segments) {
      const trimmedSegment = segment.replace(/<!--.*?-->/g, '').trim();
      if (!trimmedSegment) continue;

      const segmentChapters = [];
      const matches = trimmedSegment.split(chapterRegex);
      for (let j = 1; j < matches.length; j += 2) {
        const title = matches[j]?.trim() || '';
        const content = matches[j + 1]?.trim() || '';

        let isVolume = false;
        if (language === 'zh') {
          isVolume = /第[一二三四五六七八九十百千万0-9]+卷/.test(title);
        } else {
          isVolume = /\b(Part|Volume|Book)\b/i.test(title);
        }

        const headTitle = isVolume ? `<h1>${title}</h1>` : `<h2>${title}</h2>`;
        const formattedSegment = formatSegment(content);
        segmentChapters.push({
          title,
          content: `${headTitle}<p>${formattedSegment}</p>`,
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
          title: segmentTitle,
          content: `<h3></h3><p>${formattedSegment}</p>`,
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
    const navPoints = chapters
      .map((chapter, index) => {
        const id = `chapter${index + 1}`;
        const playOrder = index + 1;
        return `
        <navPoint id="navPoint-${id}" playOrder="${playOrder}">
          <navLabel>
            <text>${chapter.title}</text>
          </navLabel>
          <content src="./OEBPS/${id}.xhtml" />
        </navPoint>
      `.trim();
      })
      .join('\n');

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
        <text>${bookTitle}</text>
      </docTitle>
      <docAuthor>
        <text>${author}</text>
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
      const chapterContent = `<?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
        <html xmlns="http://www.w3.org/1999/xhtml" lang="zh">
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

    // Add content.opf file
    const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="2.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>${bookTitle}</dc:title>
          <dc:language>${language}</dc:language>
          <dc:creator>${author}</dc:creator>
          <dc:identifier id="book-id">${identifier}</dc:identifier>
        </metadata>
        <manifest>
          ${manifest}
          ${tocManifest}
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

  private detectLanguage(fileHeader: string): string {
    const sample = fileHeader;
    let chineseCount = 0;
    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);
      if (
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x20000 && code <= 0x2a6df)
      ) {
        chineseCount++;
      }
    }
    if (chineseCount / sample.length > 0.05) {
      return 'zh';
    }

    return 'en';
  }

  private extractBookTitle(filename: string): string {
    const match = filename.match(/《([^》]+)》/);
    return match ? match[1]! : filename.split('.')[0]!;
  }
}
