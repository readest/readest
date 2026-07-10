// Display formatting for Calibre custom column values (readest#4811).
import { describe, expect, it } from 'vitest';

import { CalibreCustomColumn } from '@/libs/document';
import { formatCalibreColumnValue } from '@/utils/book';

const column = (partial: Partial<CalibreCustomColumn>): CalibreCustomColumn => ({
  label: 'col',
  name: 'Col',
  datatype: 'text',
  value: '',
  ...partial,
});

describe('formatCalibreColumnValue', () => {
  it('joins multi-value columns with a comma', () => {
    expect(formatCalibreColumnValue(column({ value: ['TOD', 'Grandma'] }))).toBe('TOD, Grandma');
  });

  it('passes plain text through', () => {
    expect(formatCalibreColumnValue(column({ value: 'TOD' }))).toBe('TOD');
  });

  it('renders ratings (0-10 half stars) as stars', () => {
    expect(formatCalibreColumnValue(column({ datatype: 'rating', value: 8 }))).toBe('★★★★');
    expect(formatCalibreColumnValue(column({ datatype: 'rating', value: 7 }))).toBe('★★★½');
  });

  it('renders series with its index like calibre does', () => {
    expect(
      formatCalibreColumnValue(column({ datatype: 'series', value: 'Cool Saga', extra: 2 })),
    ).toBe('Cool Saga [2]');
    expect(formatCalibreColumnValue(column({ datatype: 'series', value: 'Cool Saga' }))).toBe(
      'Cool Saga',
    );
  });

  it('renders yes/no columns as check marks', () => {
    expect(formatCalibreColumnValue(column({ datatype: 'bool', value: true }))).toBe('✓');
    expect(formatCalibreColumnValue(column({ datatype: 'bool', value: false }))).toBe('✗');
  });

  it('renders datetime columns as a locale date', () => {
    const formatted = formatCalibreColumnValue(
      column({ datatype: 'datetime', value: '2024-03-01T10:00:00+00:00' }),
    );
    expect(formatted).toContain('2024');
    expect(formatted).toContain('March');
  });

  it('strips markup from comments columns', () => {
    expect(
      formatCalibreColumnValue(
        column({ datatype: 'comments', value: '<div><p>Great <b>read</b></p></div>' }),
      ),
    ).toBe('Great read');
  });

  it('stringifies numbers', () => {
    expect(formatCalibreColumnValue(column({ datatype: 'float', value: 2.5 }))).toBe('2.5');
  });
});
