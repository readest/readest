import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
} from '../__test-utils__/chromeMock';
import {
  extensionSettingsUrl,
  hasFileSchemeAccess,
  isClippableUrl,
  isLocalFileUrl,
} from './localPage';

let chromeMock: ChromeMock;

beforeEach(() => {
  chromeMock = installChromeMock();
});
afterEach(() => {
  uninstallChromeMock();
});

describe('isClippableUrl', () => {
  test('accepts remote pages and locally opened files', () => {
    expect(isClippableUrl('https://example.com/article')).toBe(true);
    expect(isClippableUrl('http://example.com/article')).toBe(true);
    expect(isClippableUrl('file:///Users/me/Saved%20Page.html')).toBe(true);
    expect(isClippableUrl('file:///C:/Users/me/chapter.xhtml')).toBe(true);
  });

  test('rejects browser-internal and script-bearing schemes', () => {
    expect(isClippableUrl('chrome://extensions')).toBe(false);
    expect(isClippableUrl('devtools://devtools/bundled/inspector.html')).toBe(false);
    expect(isClippableUrl('about:blank')).toBe(false);
    expect(isClippableUrl('data:text/html,<h1>hi</h1>')).toBe(false);
    expect(isClippableUrl('javascript:alert(1)')).toBe(false);
    expect(isClippableUrl(undefined)).toBe(false);
    expect(isClippableUrl('')).toBe(false);
  });
});

describe('isLocalFileUrl', () => {
  test('only matches the file scheme', () => {
    expect(isLocalFileUrl('file:///Users/me/a.html')).toBe(true);
    expect(isLocalFileUrl('FILE:///Users/me/a.html')).toBe(true);
    expect(isLocalFileUrl('https://example.com/file.html')).toBe(false);
    expect(isLocalFileUrl(undefined)).toBe(false);
  });
});

describe('hasFileSchemeAccess', () => {
  test('reports what Chrome says', async () => {
    chromeMock.extension.isAllowedFileSchemeAccess.mockResolvedValue(true);
    expect(await hasFileSchemeAccess()).toBe(true);
    chromeMock.extension.isAllowedFileSchemeAccess.mockResolvedValue(false);
    expect(await hasFileSchemeAccess()).toBe(false);
  });

  test('fails open when the API is missing or throws', async () => {
    // `chrome.extension` is trimmed down under MV3 and parts of it are
    // foreground-only, so a service worker may not be able to ask at all.
    // Treating "can't tell" as "denied" would block local clips on a
    // browser where the toggle is already on.
    chromeMock.extension.isAllowedFileSchemeAccess.mockRejectedValue(new Error('nope'));
    expect(await hasFileSchemeAccess()).toBe(true);

    (chromeMock as unknown as { extension: undefined }).extension = undefined;
    expect(await hasFileSchemeAccess()).toBe(true);
  });
});

describe('extensionSettingsUrl', () => {
  test('deep-links to this extension own row', () => {
    expect(extensionSettingsUrl()).toBe('chrome://extensions/?id=test-extension-id');
  });
});
