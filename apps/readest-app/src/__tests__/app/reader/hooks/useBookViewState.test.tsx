// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useReaderStore, type ViewState } from '@/store/readerStore';
import { useBookViewState } from '@/app/reader/hooks/useBookViewState';

/**
 * The reader's toolbars render from their book's view state. Opening a book then sets the page
 * area's insets and marks the first section loaded, neither of which they show; each re-rendered
 * them with everything under them (~100 components), which on an e-ink reader running QuickJS
 * (Readest Lite) slowed every book open.
 */

let renders = 0;
const Chrome = () => {
  useBookViewState('book-1');
  renders++;
  return null;
};

const viewState = (fields: Partial<ViewState> = {}) =>
  ({
    key: 'book-1',
    view: null,
    viewerKey: 'book-1-v',
    isPrimary: true,
    loading: false,
    inited: false,
    error: null,
    ribbonVisible: false,
    ttsEnabled: false,
    autoScrollEnabled: false,
    drawingEnabled: false,
    syncing: false,
    gridInsets: null,
    previewMode: false,
    viewSettings: null,
    ...fields,
  }) as ViewState;

const update = (fields: Partial<ViewState>) =>
  act(() =>
    useReaderStore.setState((s) => ({
      viewStates: { ...s.viewStates, 'book-1': { ...s.viewStates['book-1']!, ...fields } },
    })),
  );

beforeEach(() => {
  renders = 0;
  useReaderStore.setState({ viewStates: { 'book-1': viewState() } });
});

afterEach(cleanup);

describe('useBookViewState', () => {
  it('does not re-render for the page insets or the first section loading', () => {
    render(<Chrome />);
    update({ gridInsets: { top: 10, right: 0, bottom: 10, left: 0 } });
    update({ inited: true });
    expect(renders).toBe(1);
  });

  it('re-renders for anything else in the view state', () => {
    render(<Chrome />);
    update({ ttsEnabled: true });
    expect(renders).toBe(2);
    update({ gridInsets: { top: 10, right: 0, bottom: 10, left: 0 }, ribbonVisible: true });
    expect(renders).toBe(3);
  });

  // Saving a view setting changes the settings object in place and stores it again
  it('re-renders when view settings changed in place are saved', () => {
    const settings = { showHeader: true } as NonNullable<ViewState['viewSettings']>;
    useReaderStore.setState({ viewStates: { 'book-1': viewState({ viewSettings: settings }) } });
    render(<Chrome />);
    settings.showHeader = false;
    update({ viewSettings: settings });
    expect(renders).toBe(2);
  });

  // A book open sets the insets first, so every later save comes after a skipped update
  it('re-renders when view settings changed in place are saved after the insets were set', () => {
    const settings = { showHeader: true } as NonNullable<ViewState['viewSettings']>;
    useReaderStore.setState({ viewStates: { 'book-1': viewState({ viewSettings: settings }) } });
    render(<Chrome />);
    update({ gridInsets: { top: 10, right: 0, bottom: 10, left: 0 } });
    expect(renders).toBe(1);
    settings.showHeader = false;
    update({ viewSettings: settings });
    expect(renders).toBe(2);
  });

  it('re-renders when another book opens in its place', () => {
    render(<Chrome />);
    act(() => useReaderStore.setState({ viewStates: {} }));
    expect(renders).toBe(2);
  });
});
