import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import ImageViewer from '@/app/reader/components/ImageViewer';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

// useKeyDownActions pulls in EnvContext + device store; not under test here.
vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: () => {},
}));

// ZoomControls reaches into the theme store and Tauri window APIs; stub it out.
vi.mock('@/app/reader/components/ZoomControls', () => ({
  __esModule: true,
  default: () => null,
}));

afterEach(cleanup);

const gridInsets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('ImageViewer', () => {
  it('suppresses the native image callout on the zoomed image', () => {
    // The WebView's native long-press image callout collides with the
    // viewer's own pinch/pan handlers on Android and freezes the app. The
    // zoomed <img> must live under a `.no-context-menu` ancestor so the
    // global `.no-context-menu img { -webkit-touch-callout: none }` rule
    // disables that callout. Mirrors the book-cover fix (PR #4345).
    const { container } = render(
      <ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />,
    );

    const calloutSafeImage = container.querySelector('.no-context-menu img');
    expect(calloutSafeImage).toBeTruthy();
  });
});
