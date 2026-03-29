/**
 * Convert HTML article content to EPUB format
 * Creates a proper EPUB file (ZIP archive with required structure)
 */

interface ArticleMetadata {
  title: string;
  author?: string;
  publishedTime?: string;
  siteName?: string;
  url?: string;
}

export class HtmlToEpubConverter {
  /**
   * Convert HTML article to EPUB Blob
   */
  async convert(
    htmlContent: string,
    metadata: ArticleMetadata
  ): Promise<{ file: File; format: 'epub' }> {
    const uuid = this.generateUUID();
    const title = this.escapeXml(metadata.title || 'Untitled Article');
    const author = this.escapeXml(metadata.author || 'Unknown');
    const date = metadata.publishedTime 
      ? new Date(metadata.publishedTime).toISOString()
      : new Date().toISOString();
    const lang = 'en';

    // Create mimetype (must be first and uncompressed in ZIP)
    const mimetype = 'application/epub+zip';
    
    // Create META-INF/container.xml
    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

    // Create OEBPS/content.opf (package document)
    const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>${lang}</dc:language>
    <dc:date>${date}</dc:date>
    ${metadata.siteName ? `<dc:publisher>${this.escapeXml(metadata.siteName)}</dc:publisher>` : ''}
    <meta property="dcterms:modified">${new Date().toISOString().split('.')[0]}Z</meta>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`;

    // Create OEBPS/chapter1.xhtml (main content)
    const chapterHtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${title}</title>
  <meta charset="utf-8"/>
  <style>
    body { 
      font-family: Georgia, serif; 
      line-height: 1.6; 
      margin: 1em; 
      max-width: 600px;
    }
    h1 { 
      font-size: 1.5em; 
      margin-bottom: 0.5em;
      text-align: center;
    }
    .meta {
      font-size: 0.9em;
      color: #666;
      margin-bottom: 1em;
      text-align: center;
    }
    img { 
      max-width: 100%; 
      height: auto; 
      display: block;
      margin: 1em auto;
    }
    a { color: #0066cc; }
    blockquote {
      margin: 1em 2em;
      padding-left: 1em;
      border-left: 3px solid #ccc;
      color: #666;
    }
    pre, code {
      font-family: monospace;
      background: #f5f5f5;
      padding: 0.2em 0.4em;
      border-radius: 3px;
    }
    pre {
      padding: 1em;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">
    ${author ? `<p>By ${author}</p>` : ''}
    ${metadata.publishedTime ? `<p>Published ${new Date(metadata.publishedTime).toLocaleDateString()}</p>` : ''}
    ${metadata.url ? `<p><a href="${metadata.url}">Original Article</a></p>` : ''}
  </div>
  <article>
    ${htmlContent}
  </article>
</body>
</html>`;

    // Create OEBPS/nav.xhtml (navigation)
    const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Table of Contents</title>
</head>
<body>
  <nav epub:type="toc">
    <h1>Contents</h1>
    <ol>
      <li><a href="chapter1.xhtml">${title}</a></li>
    </ol>
  </nav>
</body>
</html>`;

    // Create OEBPS/toc.ncx (NCX table of contents)
    const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uuid}"/>
  </head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
    <navPoint id="navpoint-1" playOrder="1">
      <navLabel><text>${title}</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;

    // Create EPUB as a ZIP archive
    // Note: EPUB is just a ZIP file with specific structure
    // mimetype must be first and stored uncompressed
    const zip = await this.createMinimalEpubZip({
      'mimetype': mimetype,
      'META-INF/container.xml': containerXml,
      'OEBPS/content.opf': contentOpf,
      'OEBPS/chapter1.xhtml': chapterHtml,
      'OEBPS/nav.xhtml': navXhtml,
      'OEBPS/toc.ncx': tocNcx,
    });

    const file = new File([zip], `${this.sanitizeFilename(title)}.epub`, {
      type: 'application/epub+zip',
    });

    return { file, format: 'epub' };
  }

  /**
   * Create a minimal ZIP file for EPUB using JSZip
   */
  private async createMinimalEpubZip(files: Record<string, string>): Promise<Uint8Array> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    
    // Add files to ZIP
    for (const [path, content] of Object.entries(files)) {
      zip.file(path, content);
    }
    
    // Generate ZIP - mimetype must be stored uncompressed
    const blob = await zip.generateAsync({ 
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
    
    return new Uint8Array(await blob.arrayBuffer());
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase()
      .slice(0, 50);
  }
}
