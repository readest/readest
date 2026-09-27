import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { findPdfLocation, findSourceLocation, parseSyncTex } from '@/services/syncTex';

const FIXTURE = `SyncTeX Version:1
Input:1:C:/papers/sample-paper.tex
Input:2:C:/tex/article.cls
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
{1
(1,3:8799518,8865054:22609920,455111,127431
h1,3:8799518,8865054:983040,0,0
)
(1,5:8799518,9651486:22609920,455111,127431
h1,5:8799518,9651486:983040,0,0
)
}1
Postamble:
Count:4
`;

describe('SyncTeX parser and queries', () => {
  it('parses source files and page records in big points', () => {
    const index = parseSyncTex(FIXTURE);

    expect(index.inputs.get(1)).toBe('C:/papers/sample-paper.tex');
    expect(index.records).toHaveLength(4);
    expect(index.records[0]).toMatchObject({ page: 1, input: 1, line: 3 });
    expect(index.records[0]!.x).toBeCloseTo(133.768, 2);
    expect(index.records[0]!.y).toBeCloseTo(134.765, 2);
  });

  it('accepts gzip bytes and rejects malformed input', () => {
    const compressed = gzipSync(new TextEncoder().encode(FIXTURE));

    expect(parseSyncTex(compressed).records).toHaveLength(4);
    expect(() => parseSyncTex('not synctex')).toThrow('SyncTeX 文件无效');
  });

  it('maps a source line forward to its PDF page and box', () => {
    const result = findPdfLocation(parseSyncTex(FIXTURE), 'sample-paper.tex', 5);

    expect(result).toMatchObject({ page: 1, sourceFile: 'C:/papers/sample-paper.tex', line: 5 });
    expect(result!.y).toBeGreaterThan(140);
  });

  it('maps a PDF point backward to the nearest TeX line', () => {
    const index = parseSyncTex(FIXTURE);
    const secondLine = findPdfLocation(index, 'sample-paper.tex', 5)!;
    const result = findSourceLocation(index, 1, secondLine.x + 2, secondLine.y + 1);

    expect(result).toMatchObject({ sourceFile: 'C:/papers/sample-paper.tex', line: 5, page: 1 });
  });

  it('does not map into non-TeX system inputs or a missing page', () => {
    const index = parseSyncTex(FIXTURE.replace('h1,5', 'h2,5'));

    expect(findSourceLocation(index, 2, 0, 0)).toBeNull();
    expect(findPdfLocation(index, 'missing.tex', 1)).toBeNull();
  });
});
