import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HandwritingDock } from '@/app/reader/components/handwriting/HandwritingBars';
import QuickActionMenu from '@/app/reader/components/annotator/QuickActionMenu';
import { HANDWRITING_COLORS, MARKER_COLORS } from '@/services/handwriting/model';

const h = vi.hoisted(() => ({ scrolled: false, dispatch: vi.fn() }));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, string>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => params?.[name] ?? ''),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: h.dispatch } }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => ({ scrolled: h.scrolled }) }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalViewSettings: { isEink: false } } }),
}));

afterEach(() => {
  cleanup();
  h.dispatch.mockClear();
  h.scrolled = false;
});

describe('Draw in the instant annotation tools', () => {
  it('starts drawing on this book', () => {
    render(<QuickActionMenu bookKey='book-1' onActionSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Instant Draw' }));
    expect(h.dispatch).toHaveBeenCalledWith('handwriting', { action: 'toggle', bookKey: 'book-1' });
  });

  it('works in scrolled mode too', () => {
    h.scrolled = true;
    render(<QuickActionMenu bookKey='book-1' onActionSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Instant Draw' }));
    expect(h.dispatch).toHaveBeenCalledWith('handwriting', { action: 'toggle', bookKey: 'book-1' });
  });
});

describe('drawing bars', () => {
  const dockProps = () => ({
    erasing: false,
    onToggleErase: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onTurnLeft: vi.fn(),
    onTurnRight: vi.fn(),
    penColor: '#1a1a1a',
    penWidth: 0.004,
    onSelectColor: vi.fn(),
    onSelectWidth: vi.fn(),
    onSave: vi.fn(),
    onClose: vi.fn(),
    tool: 'pen' as const,
    onSelectTool: vi.fn(),
  });

  it('saves the drawing, then closes from its last button', () => {
    const props = dockProps();
    render(<HandwritingDock {...props} />);
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels.slice(-2)).toEqual(['Save', 'Close']);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(props.onSave).toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('fills the bottom safe area with its own background instead of floating above it', () => {
    const { container } = render(<HandwritingDock {...dockProps()} bottomInset={34} />);
    const dock = container.firstElementChild as HTMLElement;
    expect(dock.className).toContain('bottom-0');
    expect(dock.className).toContain('box-content');
    expect(dock.style.bottom).toBe('');
    expect(dock.style.paddingBottom).toBe('34px');
  });

  it('offers the pen, marker and eraser side by side', () => {
    const props = dockProps();
    render(<HandwritingDock {...props} />);
    expect(screen.getByRole('button', { name: 'Pen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Eraser' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Marker' }));
    expect(props.onSelectTool).toHaveBeenCalledWith('marker');
  });

  it('opens the active tool options with its own palette', () => {
    render(<HandwritingDock {...dockProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
    expect(screen.getAllByRole('button', { name: 'Ink Color' })).toHaveLength(
      HANDWRITING_COLORS.length,
    );
    cleanup();

    render(<HandwritingDock {...dockProps()} tool='marker' penColor={MARKER_COLORS[0]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Marker' }));
    const swatches = screen.getAllByRole('button', { name: 'Ink Color' });
    expect(swatches).toHaveLength(MARKER_COLORS.length);
    expect(swatches[0]!.getAttribute('aria-pressed')).toBe('true');
  });

  it('draws every dock button in the same square, tools included', () => {
    render(<HandwritingDock {...dockProps()} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('h-8');
      expect(button.className).toContain('w-8');
    }
  });

  it('wires the dock tools', () => {
    const props = dockProps();
    render(<HandwritingDock {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous Page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next Page' }));
    expect(props.onToggleErase).toHaveBeenCalled();
    expect(props.onUndo).toHaveBeenCalled();
    expect(props.onRedo).toHaveBeenCalled();
    expect(props.onTurnLeft).toHaveBeenCalled();
    expect(props.onTurnRight).toHaveBeenCalled();
  });

  it('opens the pen options from the pen button and closes them on a choice', () => {
    const props = dockProps();
    render(<HandwritingDock {...props} />);
    expect(screen.queryAllByRole('button', { name: 'Pen Size' })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
    const sizes = screen.getAllByRole('button', { name: 'Pen Size' });
    expect(sizes).toHaveLength(4);
    fireEvent.click(sizes[3]!);
    expect(props.onSelectWidth).toHaveBeenCalled();
    expect(screen.queryAllByRole('button', { name: 'Pen Size' })).toHaveLength(0);
  });
});
