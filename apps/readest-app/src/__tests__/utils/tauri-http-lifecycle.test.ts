import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
  invoke.mockReset();
  invoke.mockImplementation(async (command) => {
    if (command === 'plugin:http|fetch') return 1;
    if (command === 'plugin:http|fetch_send') {
      return { status: 200, statusText: 'OK', url: 'https://example.com', headers: [], rid: 2 };
    }
    if (command === 'plugin:http|fetch_read_body') return [1];
    return undefined;
  });
});

describe('Tauri HTTP resource lifecycle', () => {
  it('preserves body data and response metadata on successful reads', async () => {
    const baseInvoke = invoke.getMockImplementation()!;
    let reads = 0;
    invoke.mockImplementation((command, args) => {
      if (command === 'plugin:http|fetch_read_body') {
        return Promise.resolve(reads++ === 0 ? [111, 107, 0] : [1]);
      }
      return baseInvoke(command, args);
    });
    const response = await fetch('https://example.com');
    expect(await response.text()).toBe('ok');
    expect(response.status).toBe(200);
    expect(response.url).toBe('https://example.com');
  });

  it('does not cancel resources after the response body has completed', async () => {
    const controller = new AbortController();
    const response = await fetch('https://example.com', { signal: controller.signal });
    await response.text();
    invoke.mockClear();
    controller.abort();
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('releases the body once when abort races with an in-flight read', async () => {
    let rejectRead: ((reason: unknown) => void) | undefined;
    const baseInvoke = invoke.getMockImplementation()!;
    invoke.mockImplementation((command, args) => {
      if (command === 'plugin:http|fetch_read_body') {
        return new Promise((_resolve, reject) => {
          rejectRead = reject;
        });
      }
      return baseInvoke(command, args);
    });
    const controller = new AbortController();
    const response = await fetch('https://example.com', { signal: controller.signal });
    const reading = response.text();
    const rejection = expect(reading).rejects.toBeDefined();
    controller.abort();
    rejectRead!(new Error('Body resource already released'));
    await rejection;
    await Promise.resolve();
    expect(
      invoke.mock.calls.filter(([cmd]) => cmd === 'plugin:http|fetch_cancel_body'),
    ).toHaveLength(1);
  });

  it('preserves a read failure even when native cleanup also rejects', async () => {
    const failure = new Error('Response stream interrupted');
    const baseInvoke = invoke.getMockImplementation()!;
    invoke.mockImplementation((command, args) => {
      if (command === 'plugin:http|fetch_read_body') return Promise.reject(failure);
      if (command === 'plugin:http|fetch_cancel_body') {
        return Promise.reject(new Error('Body resource already released'));
      }
      return baseInvoke(command, args);
    });
    const response = await fetch('https://example.com');
    await expect(response.text()).rejects.toBe(failure);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('detaches abort handling after a failed request', async () => {
    const failure = new Error('Connection failed');
    const baseInvoke = invoke.getMockImplementation()!;
    invoke.mockImplementation((command, args) => {
      if (command === 'plugin:http|fetch_send') return Promise.reject(failure);
      return baseInvoke(command, args);
    });
    const controller = new AbortController();
    await expect(fetch('https://example.com', { signal: controller.signal })).rejects.toBe(failure);
    invoke.mockClear();
    controller.abort();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('releases a response with no body without issuing a body read', async () => {
    const baseInvoke = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) => {
      if (command === 'plugin:http|fetch_send') {
        return {
          status: 204,
          statusText: 'No Content',
          url: 'https://example.com',
          headers: [],
          rid: 2,
        };
      }
      return baseInvoke(command, args);
    });
    const response = await fetch('https://example.com');
    expect(response.body).toBeNull();
    expect(
      invoke.mock.calls.filter(([cmd]) => cmd === 'plugin:http|fetch_cancel_body'),
    ).toHaveLength(1);
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'plugin:http|fetch_read_body')).toHaveLength(
      0,
    );
  });
});
