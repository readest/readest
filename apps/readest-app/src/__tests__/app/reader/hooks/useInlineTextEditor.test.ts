import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useInlineTextEditor } from '@/app/reader/hooks/useInlineTextEditor';

describe('useInlineTextEditor', () => {
  it('starts outside edit mode with an empty draft', () => {
    const { result } = renderHook(() => useInlineTextEditor(vi.fn()));

    expect(result.current.inlineEditMode).toBe(false);
    expect(result.current.draftText).toBe('');
  });

  it('entering edit mode seeds the draft with the given initial text', () => {
    const { result } = renderHook(() => useInlineTextEditor(vi.fn()));

    act(() => result.current.startEdit('existing note'));

    expect(result.current.inlineEditMode).toBe(true);
    expect(result.current.draftText).toBe('existing note');
  });

  it('typing updates the draft while in edit mode', () => {
    const { result } = renderHook(() => useInlineTextEditor(vi.fn()));
    act(() => result.current.startEdit('old'));

    act(() => result.current.setDraftText('new'));

    expect(result.current.draftText).toBe('new');
  });

  it('cancelling exits edit mode without calling onSave', () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useInlineTextEditor(onSave));
    act(() => result.current.startEdit('old'));
    act(() => result.current.setDraftText('discarded'));

    act(() => result.current.cancelEdit());

    expect(result.current.inlineEditMode).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saving exits edit mode and calls onSave with the current draft', () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useInlineTextEditor(onSave));
    act(() => result.current.startEdit('old'));
    act(() => result.current.setDraftText('updated text'));

    act(() => result.current.save());

    expect(result.current.inlineEditMode).toBe(false);
    expect(onSave).toHaveBeenCalledWith('updated text');
  });

  it('saving after onSave changes across a rerender calls the latest onSave, not a stale one', () => {
    const firstOnSave = vi.fn();
    const secondOnSave = vi.fn();
    const { result, rerender } = renderHook(
      ({ onSave }: { onSave: (draftText: string) => void }) => useInlineTextEditor(onSave),
      { initialProps: { onSave: firstOnSave } },
    );
    act(() => result.current.startEdit('old'));

    rerender({ onSave: secondOnSave });
    act(() => result.current.save());

    expect(firstOnSave).not.toHaveBeenCalled();
    expect(secondOnSave).toHaveBeenCalledWith('old');
  });
});
