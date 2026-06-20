import { describe, it, expect, afterEach } from 'vitest';
import { mountBackgroundTexture, unmountBackgroundTexture } from '@/styles/textures';

afterEach(() => {
  unmountBackgroundTexture(document);
});

describe('mountBackgroundTexture', () => {
  it('covers the scrolled-mode notch mask so the top inset strip is textured (#4486)', () => {
    mountBackgroundTexture(document, {
      id: 'paper',
      name: 'Paper',
      url: '/images/paper-texture.png',
    });

    const style = document.getElementById('background-texture');
    expect(style?.textContent).toContain('.notch-masked::before');
  });
});
