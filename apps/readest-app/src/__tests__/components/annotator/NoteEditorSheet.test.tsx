/**
 * #6390: the phone note editor is a partial sheet over the page, not a
 * full-screen page, so it has no header: no back arrow (Cancel, a swipe down
 * or a tap outside close it) and no title spending its few lines.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    systemUIVisible: false,
    statusBarHeight: 0,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@tauri-apps/plugin-haptics', () => ({ impactFeedback: vi.fn() }));

const { default: NoteEditorSheet } = await import(
  '@/app/reader/components/annotator/NoteEditorSheet'
);

afterEach(() => cleanup());

describe('NoteEditorSheet', () => {
  it('has neither a back arrow nor a visible title', () => {
    render(<NoteEditorSheet value='' onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByText('Note')).toBeNull();
    // Still named for assistive tech.
    expect(document.querySelector('dialog')?.getAttribute('aria-label')).toBe('Note');
  });
});
