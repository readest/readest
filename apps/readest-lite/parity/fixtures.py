"""fixtures.py DIR: writes the parity scenarios' small books to DIR.

features.epub: a footnote (epub:type noteref -> footnote), a link to a later chapter, an image and
a table, each on the first page of its chapter. The link's target id is "dest": Readest's sanitizer
(DOMPurify) drops an id that names a document or form property, such as "target". book.txt,
book.fb2 and book.cbz: the same short text, and three pages of a comic. Every byte is fixed, so
both apps get the same book (and the same book hash).
"""
import os, struct, sys, zipfile, zlib

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
STAMP = (2026, 1, 1, 0, 0, 0)
TEXT = ('Gregor woke from troubled dreams and found himself changed. ' * 6).strip()


def png(w, h, shade):
    """A gray w x h PNG: a frame of black around `shade`."""
    rows = b''.join(b'\0' + bytes(0 if x < 4 or y < 4 or x >= w - 4 or y >= h - 4 else shade for x in range(w))
                    for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def write_zip(path, files, stored_first=None):
    with zipfile.ZipFile(path, 'w') as z:
        if stored_first:
            z.writestr(zipfile.ZipInfo(stored_first[0], STAMP), stored_first[1], zipfile.ZIP_STORED)
        for name, data in files:
            z.writestr(zipfile.ZipInfo(name, STAMP), data, zipfile.ZIP_DEFLATED)


def xhtml(title, body):
    return ('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
            '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">'
            f'<head><title>{title}</title></head><body>{body}</body></html>')


chapters = [
    ('c1', 'Footnote', f'<h1>Footnote</h1><p>{TEXT[:120]}<a epub:type="noteref" href="notes.xhtml#n1" id="r1">1</a> '
                       f'and the story goes on. {TEXT[:150]}</p><p><a href="c4.xhtml#dest">To the target chapter</a></p>'),
    ('c2', 'Image', f'<h1>Image</h1><p>{TEXT[:100]}</p><p><img src="img.png" alt="A gray box"/></p><p>{TEXT[:100]}</p>'),
    ('c3', 'Table', '<h1>Table</h1><table border="1"><tr><th>Name</th><th>Pages</th></tr>'
                    + ''.join(f'<tr><td>Row {i}</td><td>{i * 10}</td></tr>' for i in range(1, 6)) + '</table>'),
    ('c4', 'Target', f'<h1 id="dest">Target</h1><p>{TEXT}</p>'),
    ('notes', 'Notes', '<aside epub:type="footnote" id="n1"><p>1. The note: a beetle, of a kind.</p></aside>'),
]
manifest = ''.join(f'<item id="{c}" href="{c}.xhtml" media-type="application/xhtml+xml"/>' for c, _, _ in chapters)
spine = ''.join(f'<itemref idref="{c}"/>' for c, _, _ in chapters)
nav = xhtml('Contents', '<nav epub:type="toc"><ol>' + ''.join(
    f'<li><a href="{c}.xhtml">{t}</a></li>' for c, t, _ in chapters) + '</ol></nav>')
opf = ('<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" '
       'unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
       '<dc:identifier id="id">readest-lite-parity-features</dc:identifier><dc:title>Parity Features</dc:title>'
       '<dc:creator>Readest Lite</dc:creator><dc:language>en</dc:language>'
       '<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest>'
       '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
       f'<item id="img" href="img.png" media-type="image/png"/>{manifest}</manifest><spine>{spine}</spine></package>')
container = ('<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
             '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
             '</rootfiles></container>')
write_zip(f'{out}/features.epub',
          [('META-INF/container.xml', container), ('OEBPS/content.opf', opf), ('OEBPS/nav.xhtml', nav),
           ('OEBPS/img.png', png(160, 100, 160))]
          + [(f'OEBPS/{c}.xhtml', xhtml(t, b)) for c, t, b in chapters],
          stored_first=('mimetype', 'application/epub+zip'))

paragraphs = [TEXT[i:i + 90] for i in range(0, len(TEXT), 90)] * 4
open(f'{out}/book.txt', 'w').write('Chapter 1\n\n' + '\n\n'.join(paragraphs) + '\n')
open(f'{out}/book.fb2', 'w').write(
    '<?xml version="1.0" encoding="utf-8"?>\n<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">'
    '<description><title-info><genre>prose</genre><author><first-name>Readest</first-name><last-name>Lite</last-name>'
    '</author><book-title>Parity FB2</book-title><lang>en</lang></title-info></description><body>'
    '<section><title><p>Chapter 1</p></title>' + ''.join(f'<p>{p}</p>' for p in paragraphs) + '</section></body></FictionBook>\n')
write_zip(f'{out}/book.cbz', [(f'page{i}.png', png(300, 420, 60 * i)) for i in (1, 2, 3)])
print(f'features.epub book.txt book.fb2 book.cbz -> {out}')
