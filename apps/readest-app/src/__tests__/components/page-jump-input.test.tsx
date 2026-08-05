import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import PageJumpInput from '@/app/reader/components/footerbar/PageJumpInput';

interface MockState {
  progress: unknown;
  viewSettings: unknown;
  bookData: unknown;
  hoveredBookKey: string;
}

const mocks = vi.hoisted(() => {
  const view = { goTo: vi.fn(), goToFraction: vi.fn() };
  const state: MockState = {
    progress: null,
    viewSettings: null,
    bookData: null,
    hoveredBookKey: '',
  };
  return { view, state };
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: mocks.state.hoveredBookKey,
    getView: () => mocks.view,
    getProgress: () => mocks.state.progress,
    getViewSettings: () => mocks.state.viewSettings,
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => mocks.state.bookData,
  }),
}));

const setup = ({
  progressStyle = 'fraction',
  isFixedLayout = false,
  pageList = undefined as unknown,
  showFraction = false,
} = {}) => {
  mocks.state.progress = {
    pageinfo: { current: 93, next: 94, total: 251 },
    section: { current: 4, total: 30 },
    pageItem: undefined,
  };
  mocks.state.viewSettings = { progressStyle };
  mocks.state.bookData = { isFixedLayout, bookDoc: { pageList } };
  const utils = render(<PageJumpInput bookKey='book1' showFraction={showFraction} />);
  const input = utils.getByRole('textbox', { name: 'Go to Page' }) as HTMLInputElement;
  return { ...utils, input };
};

beforeEach(() => {
  mocks.view.goTo.mockClear();
  mocks.view.goToFraction.mockClear();
});

afterEach(() => cleanup());

describe('PageJumpInput', () => {
  it('shows the page fraction as its idle label', () => {
    const { input } = setup();
    expect(input.value).toBe('94 / 251');
  });

  it('shows a percentage label when that progress style is selected', () => {
    const { input } = setup({ progressStyle: 'percentage' });
    expect(input.value).toBe('37%');
  });

  it('always shows the page fraction when showFraction is set', () => {
    const { input } = setup({ progressStyle: 'percentage', showFraction: true });
    expect(input.value).toBe('94 / 251');
  });

  it('renders nothing without valid progress', () => {
    mocks.state.progress = null;
    mocks.state.viewSettings = { progressStyle: 'fraction' };
    mocks.state.bookData = { isFixedLayout: false, bookDoc: {} };
    const { queryByRole } = render(<PageJumpInput bookKey='book1' />);
    expect(queryByRole('textbox')).toBeNull();
  });

  it('keeps the same text on focus so the layout stays stable', () => {
    const { input } = setup();
    fireEvent.focus(input);
    expect(input.value).toBe('94 / 251');
  });

  it('swaps a percentage label to the page fraction on focus', () => {
    const { input } = setup({ progressStyle: 'percentage' });
    fireEvent.focus(input);
    expect(input.value).toBe('94 / 251');
  });

  it('jumps on Enter after the page portion is typed over', () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '120 / 251' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.view.goToFraction).toHaveBeenCalledTimes(1);
    expect(mocks.view.goToFraction.mock.calls[0]![0]).toBeCloseTo(119.5 / 251);
    expect(input.value).toBe('94 / 251');
  });

  it('jumps when the whole field is replaced with a bare number', () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '120' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.view.goToFraction.mock.calls[0]![0]).toBeCloseTo(119.5 / 251);
  });

  it('clamps out-of-range pages to the last page', () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '9999 / 251' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.view.goToFraction.mock.calls[0]![0]).toBeCloseTo(250.5 / 251);
  });

  it('ignores non-numeric input', () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'abc / 251' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.view.goToFraction).not.toHaveBeenCalled();
    expect(mocks.view.goTo).not.toHaveBeenCalled();
    expect(input.value).toBe('94 / 251');
  });

  it('cancels editing on Escape without jumping', () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '200 / 251' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mocks.view.goToFraction).not.toHaveBeenCalled();
    expect(input.value).toBe('94 / 251');
  });

  it('jumps to the spine page directly for fixed layout books', () => {
    const { input } = setup({ isFixedLayout: true });
    expect(input.value).toBe('5 / 30');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '10 / 30' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.view.goTo).toHaveBeenCalledWith(9);
    expect(mocks.view.goToFraction).not.toHaveBeenCalled();
  });

  it('jumps via the page list href for the reference progress style', () => {
    const { input } = setup({
      progressStyle: 'reference',
      pageList: [
        { label: '1', href: 'ch01.html#p1' },
        { label: '2', href: 'ch01.html#p2' },
      ],
    });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '2 / 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.view.goTo).toHaveBeenCalledWith('ch01.html#p2');
    expect(mocks.view.goToFraction).not.toHaveBeenCalled();
  });
});
