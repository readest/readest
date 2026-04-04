import { describe, expect, it } from 'vitest';
import {
  deserializeOPDSCustomHeaders,
  formatOPDSCustomHeadersInput,
  parseOPDSCustomHeadersInput,
  serializeOPDSCustomHeaders,
} from '@/app/opds/utils/customHeaders';

describe('OPDS custom headers', () => {
  it('parses multiline header input', () => {
    const result = parseOPDSCustomHeadersInput(`
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
    const result = parseOPDSCustomHeadersInput('missing separator');

    expect(result.headers).toEqual({});
    expect(result.error).toContain('line 1');
  });

  it('serializes and restores stored custom headers', () => {
    const serialized = serializeOPDSCustomHeaders({
      'CF-Access-Client-Id': 'client-id',
      'CF-Access-Client-Secret': 'secret',
    });

    expect(serialized).toBeTypeOf('string');
    expect(deserializeOPDSCustomHeaders(serialized)).toEqual({
      'CF-Access-Client-Id': 'client-id',
      'CF-Access-Client-Secret': 'secret',
    });
  });

  it('formats saved headers for textarea editing', () => {
    expect(
      formatOPDSCustomHeadersInput({
        'CF-Access-Client-Id': 'client-id',
        'CF-Access-Client-Secret': 'secret',
      }),
    ).toBe('CF-Access-Client-Id: client-id\nCF-Access-Client-Secret: secret');
  });
});
