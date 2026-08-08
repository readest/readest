import { describe, expect, it } from 'vitest';
import {
  deserializeCustomHeaders,
  formatCustomHeadersInput,
  normalizeCustomHeaders,
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

  it('rejects header names that are not valid HTTP tokens', () => {
    // `new Headers()` / fetch throw a TypeError on these. Catching it at
    // parse time turns an invalid name into an actionable form error
    // instead of a request that dies inside the sync loop.
    const result = parseCustomHeadersInput('My Header: value');

    expect(result.headers).toEqual({});
    expect(result.error).toContain('line 1');
  });

  it('drops invalid header names on normalize so requests never throw', () => {
    // Second line of defense for values that never went through the parser:
    // settings written by an older build, hand-edited settings.json, or a
    // value pulled from another device. A dropped header beats a TypeError
    // that KOSyncClient swallows into a silent sync failure.
    const normalized = normalizeCustomHeaders({
      'My Header': 'value',
      'CF-Access-Client-Id': 'client-id',
    });

    expect(normalized).toEqual({ 'CF-Access-Client-Id': 'client-id' });
    expect(() => new Headers(normalized)).not.toThrow();
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
