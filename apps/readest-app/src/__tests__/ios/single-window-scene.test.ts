import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const infoPlist = new DOMParser().parseFromString(
  readFileSync(resolve(process.cwd(), 'src-tauri/Info-ios.plist'), 'utf-8'),
  'application/xml',
);
const valueFor = (key: string) =>
  Array.from(infoPlist.querySelectorAll('key')).find((node) => node.textContent === key)
    ?.nextElementSibling;

describe('iOS scene configuration', () => {
  it('routes Files handoffs to the existing window instead of creating an empty scene', () => {
    // Readest creates one main WebView and does not handle SceneRequested.
    // Advertising multiple scenes lets iPadOS open documents in a black window.
    expect(valueFor('UIApplicationSupportsMultipleScenes')?.tagName).toBe('false');
  });

  it('retains the CarPlay scene configuration', () => {
    expect(valueFor('CPTemplateApplicationSceneSessionRoleApplication')?.textContent).toContain(
      '$(PRODUCT_MODULE_NAME).CarPlaySceneDelegate',
    );
  });
});
