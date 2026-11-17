import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { BookNote } from '@/types/book';
import type { TextSelection } from '@/utils/sel';

const h = vi.hoisted(() => ({
  caret: vi.fn(),
  apply: vi.fn(),
  positions: { start: { x: 30, y: 50 }, end: { x: 130, y: 100 } },
}));
vi.mock('@/utils/sel', async (importActual) => ({
  ...(await importActual<typeof import('@/utils/sel')>()),
  rangeFromAnchorToPoint: h.caret,
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { isMobile: false } }) }));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({ isDarkMode: false }) }));
vi.mock('@/store/readerStore', () => ({ useReaderStore: () => ({ getViewSettings: () => ({}) }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalViewSettings: { isEink: false }, globalReadSettings: {} },
  }),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/app/reader/hooks/useAnnotationEditor', () => ({
  useAnnotationEditor: () => ({
    handlePositions: h.positions,
    getHandlePositionsFromRange: () => h.positions,
    applyAnnotationRange: h.apply,
  }),
}));
vi.mock('@/app/reader/components/annotator/MagnifierLoupe', () => ({ default: () => null }));

import AnnotationRangeEditor from '@/app/reader/components/annotator/AnnotationRangeEditor';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

it.each([
  false,
  true,
])('hit-tests annotation handle movement in its document (iframe=%s)', async (inFrame) => {
  let doc = document;
  if (inFrame) {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    frame.getBoundingClientRect = () => new DOMRect(10, 20, 300, 480);
    Object.defineProperty(frame, 'clientWidth', { value: 500 });
    Object.defineProperty(frame, 'clientHeight', { value: 800 });
    doc = frame.contentDocument!;
  }
  const text = doc.createTextNode('one two three');
  doc.body.append(text);
  const range = doc.createRange();
  range.selectNodeContents(text);
  h.caret.mockReturnValue(range);
  const selection = { range, index: 0 } as TextSelection;
  const { getAllByTestId } = render(
    <AnnotationRangeEditor
      bookKey='book'
      isVertical={false}
      annotation={{} as BookNote}
      selection={selection}
      handleColor='#FFFF00'
      getAnnotationText={async () => 'one two three'}
      setSelection={vi.fn()}
      onStartEdit={vi.fn()}
      noteAutoTurnPoint={vi.fn()}
      cancelAutoTurn={vi.fn()}
      onAutoTurn={() => () => {}}
    />,
  );
  await waitFor(() => expect(getAllByTestId('selection-handle')[1]!.style.left).toBe('118px'));
  const handle = getAllByTestId('selection-handle')[1]!;
  handle.setPointerCapture = vi.fn();
  const pointer = (type: string) =>
    new MouseEvent(type, { bubbles: true, clientX: 130, clientY: 100 });
  fireEvent(handle, pointer('pointerdown'));
  fireEvent(handle, pointer('pointermove'));
  expect(h.caret).toHaveBeenCalled();
  const [owner, anchor, offset, x, y] = h.caret.mock.calls.at(-1)!;
  expect(owner).toBe(doc);
  expect(anchor).toBe(text);
  expect(offset).toBe(0);
  expect(x).toBeCloseTo(inFrame ? 200 : 130);
  expect(y).toBeCloseTo(inFrame ? 80 / 0.6 - 2 : 98);
  expect(h.apply).toHaveBeenCalledWith(range, 0, false, true);
});
