import { describe, expect, it } from 'vitest';
import {
  deserializeCustomHeaders,
  formatCustomHeadersInput,
  parseCustomHeadersInput,
  serializeCustomHeaders,
} from '@/utils/customHeaders';

describe('custom headers', () => {
  it('parses multiline header input', () => {
    const result = parseCustomHeadersInput(`
      CF-Access-Client-Id: client-id
      CF-Access-Client-Secret: secret:value
    `);

    expect(result.error).toBeUndefined();
    expect(result.headers).toEqual({
      'CF-Access-Client-Id': 'client-id',
      'CF-Access-Client-Secret': 'secret:value',
    });
  });

  it('reports malformed header lines', () => {
    const result = parseCustomHeadersInput('missing separator');

    expect(result.headers).toEqual({});
    expect(result.error).toContain('line 1');
  });

  it('serializes and restores stored custom headers', () => {
    const serialized = serializeCustomHeaders({
      'CF-Access-Client-Id': 'client-id',
      'CF-Access-Client-Secret': 'secret',
    });

    expect(serialized).toBeTypeOf('string');
    expect(deserializeCustomHeaders(serialized)).toEqual({
      'CF-Access-Client-Id': 'client-id',
      'CF-Access-Client-Secret': 'secret',
    });
  });

  it('formats saved headers for textarea editing', () => {
    expect(
      formatCustomHeadersInput({
        'CF-Access-Client-Id': 'client-id',
        'CF-Access-Client-Secret': 'secret',
      }),
    ).toBe('CF-Access-Client-Id: client-id\nCF-Access-Client-Secret: secret');
  });
});
