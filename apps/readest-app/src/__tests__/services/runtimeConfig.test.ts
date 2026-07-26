import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

import {
  getSelfHostedLocalConfig,
  SELF_HOSTED_STORAGE_KEY,
  type SelfHostedLocalConfig,
} from '@/services/runtimeConfig';

const validConfig: SelfHostedLocalConfig = {
  supabaseUrl: 'http://192.168.1.100:8000',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiJ9.test.sig',
  apiBaseUrl: 'http://192.168.1.100:3000',
};

describe('getSelfHostedLocalConfig', () => {
  beforeEach(() => localStorageMock.clear());
  afterEach(() => vi.restoreAllMocks());

  it('returns null when key is absent', () => {
    expect(getSelfHostedLocalConfig()).toBeNull();
  });

  it('returns parsed config when valid JSON is stored', () => {
    localStorageMock.setItem(SELF_HOSTED_STORAGE_KEY, JSON.stringify(validConfig));
    expect(getSelfHostedLocalConfig()).toEqual(validConfig);
  });

  it('returns null when stored value is malformed JSON', () => {
    localStorageMock.setItem(SELF_HOSTED_STORAGE_KEY, '{not valid json');
    expect(getSelfHostedLocalConfig()).toBeNull();
  });

  it('returns null when localStorage.getItem throws', () => {
    vi.spyOn(localStorageMock, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(getSelfHostedLocalConfig()).toBeNull();
  });

  it('returns config with empty apiBaseUrl when field is empty string', () => {
    const cfg = { ...validConfig, apiBaseUrl: '' };
    localStorageMock.setItem(SELF_HOSTED_STORAGE_KEY, JSON.stringify(cfg));
    expect(getSelfHostedLocalConfig()?.apiBaseUrl).toBe('');
  });

  it('reflects removal after key is deleted', () => {
    localStorageMock.setItem(SELF_HOSTED_STORAGE_KEY, JSON.stringify(validConfig));
    localStorageMock.removeItem(SELF_HOSTED_STORAGE_KEY);
    expect(getSelfHostedLocalConfig()).toBeNull();
  });
});
