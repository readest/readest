import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import Popup from '@/components/Popup';
import { mountBackgroundTexture, unmountBackgroundTexture } from '@/styles/textures';
import '@/styles/globals.css';

vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => {} }));

afterEach(() => {
  cleanup();
  unmountBackgroundTexture(document);
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.style.removeProperty('--bg-texture-opacity');
});

describe('footnote texture arrow', () => {
  for (const theme of ['default-light', 'default-dark']) {
    for (const eink of [false, true]) {
      test.each(['up', 'down', 'left', 'right'] as const)(`${theme}, e-ink ${eink}, %s`, (dir) => {
        document.documentElement.dataset['theme'] = theme;
        document.documentElement.dataset['eink'] = String(eink);
        document.documentElement.style.setProperty('--bg-texture-opacity', '0.4');
        mountBackgroundTexture(document, {
          id: 'paper',
          name: 'Paper',
          url: '/images/paper-texture.png',
        });
        const { container } = render(
          <Popup
            width={200}
            height={100}
            className='footnote-popup'
            position={{ dir: 'down', point: { x: 200, y: 200 } }}
            trianglePosition={{ dir, point: { x: 180, y: 180 } }}
          >
            Note
          </Popup>,
        );
        const arrow = container.querySelector('.popup-triangle-inner')!;
        const texture = getComputedStyle(arrow, '::before');
        const surface = getComputedStyle(container.querySelector('.footnote-popup')!, '::before');
        expect(texture.backgroundImage).toBe(surface.backgroundImage);
        expect(texture.backgroundImage).toContain('paper-texture.png');
        expect(texture.opacity).toBe(surface.opacity);
        expect(texture.backgroundSize).toBe(surface.backgroundSize);
        expect(texture.mixBlendMode).toBe(surface.mixBlendMode);
        expect(texture.pointerEvents).toBe('none');
        expect(texture.clipPath).not.toBe('none');
        expect(parseFloat(texture.width)).toBeGreaterThan(0);
        expect(parseFloat(texture.height)).toBeGreaterThan(0);
        unmountBackgroundTexture(document);
        expect(getComputedStyle(arrow, '::before').backgroundImage).toBe('none');
      });
    }
  }

  test('leaves other popup arrows untextured', () => {
    mountBackgroundTexture(document, {
      id: 'paper',
      name: 'Paper',
      url: '/images/paper-texture.png',
    });
    const { container } = render(
      <Popup width={200} trianglePosition={{ dir: 'down', point: { x: 180, y: 180 } }}>
        Other popup
      </Popup>,
    );
    expect(
      getComputedStyle(container.querySelector('.popup-triangle-inner')!, '::before')
        .backgroundImage,
    ).toBe('none');
  });
});
