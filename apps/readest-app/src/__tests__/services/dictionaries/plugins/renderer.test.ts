import { describe, expect, test, vi } from 'vitest';
import {
  createDictionaryResourceDataUrl,
  renderPluginDictionaryResult,
} from '@/services/dictionaries/plugins/renderer';

describe('plugin dictionary renderer', () => {
  test('renders only host-owned semantic elements and lookup navigation', async () => {
    const container = document.createElement('div');
    const onNavigate = vi.fn();
    await renderPluginDictionaryResult(
      container,
      {
        entries: [
          {
            expression: '読む',
            reading: 'よむ',
            tags: [{ name: 'v5', notes: 'Godan verb' }],
            frequencies: [{ value: 42 }],
            pitches: [{ position: 1 }],
            ipa: [{ value: '[jo̞mɯ̟ᵝ]' }],
            definitions: [
              {
                type: 'element',
                tag: 'ruby',
                children: [
                  { type: 'text', value: '読' },
                  {
                    type: 'element',
                    tag: 'rt',
                    children: [{ type: 'text', value: 'よ' }],
                  },
                ],
              },
              {
                type: 'link',
                label: '読書',
                target: { type: 'lookup', word: '読書' },
              },
              { type: 'image', resourceRef: 'image.png', alt: 'stroke order' },
            ],
          },
        ],
      },
      {
        onNavigate,
        resolveResource: async () => ({
          mimeType: 'image/png',
          bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        }),
      },
    );

    expect(container.querySelector('ruby')?.textContent).toBe('読よ');
    expect(container.textContent).toContain('42');
    expect(container.textContent).toContain('[jo̞mɯ̟ᵝ]');
    const link = container.querySelector('a');
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onNavigate).toHaveBeenCalledWith('読書');
    expect(container.querySelector('img')?.src).toMatch(/^data:image\/png;base64,/u);
    expect(container.querySelector('script')).toBeNull();
  });

  test('sanitizes SVG before producing a bounded base64 data URL', () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><rect width="1" height="1"/></svg>',
    );
    const url = createDictionaryResourceDataUrl('image/svg+xml', svg);
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/u);
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(url.split(',')[1]!), (character) => character.charCodeAt(0)),
    );
    expect(decoded).toContain('<rect');
    expect(decoded).not.toMatch(/script|onload/iu);
  });

  test('produces a signature-checked AVIF data URL', () => {
    const avif = new Uint8Array([
      0, 0, 0, 28, 102, 116, 121, 112, 97, 118, 105, 102, 0, 0, 0, 0, 97, 118, 105, 102, 109, 105,
      102, 49, 109, 105, 97, 102,
    ]);

    expect(createDictionaryResourceDataUrl('image/avif', avif)).toMatch(
      /^data:image\/avif;base64,/u,
    );
  });

  test('lets the browser decode other image resource types', () => {
    expect(createDictionaryResourceDataUrl('image/bmp', new Uint8Array([66, 77, 0, 0]))).toMatch(
      /^data:image\/bmp;base64,/u,
    );
  });

  test('rejects mismatched raster signatures and oversized resources', () => {
    expect(() =>
      createDictionaryResourceDataUrl('image/png', new TextEncoder().encode('<svg/>')),
    ).toThrow(/signature/i);
    expect(() =>
      createDictionaryResourceDataUrl('image/png', new Uint8Array(4 * 1_024 * 1_024 + 1)),
    ).toThrow(/size/i);
    expect(() =>
      createDictionaryResourceDataUrl('application/octet-stream', new Uint8Array([1, 2, 3])),
    ).toThrow(/resource type/i);
  });

  test('deduplicates in-flight resource loads within one rendered result', async () => {
    const container = document.createElement('div');
    const resolveResource = vi.fn(async () => ({
      mimeType: 'image/png' as const,
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    }));

    await renderPluginDictionaryResult(
      container,
      {
        entries: [
          {
            expression: '読む',
            reading: 'よむ',
            definitions: Array.from({ length: 100 }, () => ({
              type: 'image' as const,
              resourceRef: 'shared.png',
            })),
          },
        ],
      },
      { resolveResource },
    );

    expect(resolveResource).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('img')).toHaveLength(100);
  });

  test('loads distinct resources with bounded concurrency', async () => {
    const container = document.createElement('div');
    let active = 0;
    let maxActive = 0;
    const resolveResource = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return {
        mimeType: 'image/png' as const,
        bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      };
    });

    await renderPluginDictionaryResult(
      container,
      {
        entries: [
          {
            expression: '読む',
            reading: 'よむ',
            definitions: ['one.png', 'two.png', 'three.png'].map((resourceRef) => ({
              type: 'image' as const,
              resourceRef,
            })),
          },
        ],
      },
      { resolveResource },
    );

    expect(maxActive).toBe(1);
  });

  test('caps aggregate unique resource bytes for one rendered result', async () => {
    const container = document.createElement('div');
    const bytes = new Uint8Array(3 * 1_024 * 1_024);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);

    await renderPluginDictionaryResult(
      container,
      {
        entries: [
          {
            expression: '読む',
            reading: 'よむ',
            definitions: ['one.png', 'two.png', 'three.png'].map((resourceRef) => ({
              type: 'image' as const,
              resourceRef,
            })),
          },
        ],
      },
      {
        resolveResource: async () => ({ mimeType: 'image/png', bytes }),
      },
    );

    expect(container.querySelectorAll('img[data-resource-error="true"]')).toHaveLength(1);
  });
});
