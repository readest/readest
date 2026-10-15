import { describe, expect, it } from 'vitest';
import { allowsSelfSignedCert, tlsFetchOptions } from '@/utils/tls';

describe('allowsSelfSignedCert', () => {
  it('keeps accepting self-signed certs for a server saved before the option existed', () => {
    expect(allowsSelfSignedCert({})).toBe(true);
  });

  it('follows an explicit choice', () => {
    expect(allowsSelfSignedCert({ allowSelfSignedCert: false })).toBe(false);
    expect(allowsSelfSignedCert({ allowSelfSignedCert: true })).toBe(true);
  });
});

describe('tlsFetchOptions', () => {
  it('relaxes certificate checks only when allowed', () => {
    expect(tlsFetchOptions(true)).toEqual({
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    });
    expect(tlsFetchOptions(false)).toEqual({});
  });
});
