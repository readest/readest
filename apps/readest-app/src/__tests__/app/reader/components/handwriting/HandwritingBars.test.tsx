import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HandwritingToggler from '@/app/reader/components/handwriting/HandwritingToggler';
import {
  HandwritingDock,
  HandwritingTopBar,
} from '@/app/reader/components/handwriting/HandwritingBars';

const h = vi.hoisted(() => ({ scrolled: false, dispatch: vi.fn() }));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
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

describe('HandwritingToggler', () => {
  it('starts drawing on this book from the reader header', () => {
    render(<HandwritingToggler bookKey='book-1' />);
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
    expect(h.dispatch).toHaveBeenCalledWith('handwriting', { action: 'toggle', bookKey: 'book-1' });
  });

  it('is unavailable in scrolled mode', () => {
    h.scrolled = true;
    render(<HandwritingToggler bookKey='book-1' />);
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
    expect(h.dispatch).not.toHaveBeenCalled();
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
  });

  it('titles the mode and leaves it with Done', () => {
    const onDone = vi.fn();
    render(<HandwritingTopBar onDone={onDone} />);
    expect(screen.getByText('Drawing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
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
