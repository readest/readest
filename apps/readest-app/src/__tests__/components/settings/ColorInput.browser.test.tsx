import { useEffect, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import ColorInput from '@/components/settings/theme/ColorInput';
import { eventDispatcher } from '@/utils/event';

await import('@/styles/globals.css');

afterEach(() => cleanup());

// Dialog.tsx listens for Escape on the <dialog> element itself, natively, and
// also on window. With a sub-page registered on `onBack`, either one closes the
// page and drops whatever draft it holds.
const InDialog = ({
  onDialogKey,
  onCommit,
}: {
  onDialogKey: (key: string) => void;
  onCommit?: () => void;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const listener = (e: KeyboardEvent) => onDialogKey(e.key);
    dialog.addEventListener('keydown', listener);
    return () => dialog.removeEventListener('keydown', listener);
  }, [onDialogKey]);
  return (
    <dialog ref={ref} open>
      {/* A focusable control outside the colour input, as the theme editor has
          a name field before its colour rows. */}
      <button type='button'>Theme name</button>
      <ColorInput label='Accent' value='#ff0000' onChange={() => {}} onCommit={onCommit} />
    </dialog>
  );
};

// Two pickers in one page, as the theme editor renders a row of them.
const TwoPickers = ({ onDialogKey }: { onDialogKey: (key: string) => void }) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const listener = (e: KeyboardEvent) => onDialogKey(e.key);
    dialog.addEventListener('keydown', listener);
    return () => dialog.removeEventListener('keydown', listener);
  }, [onDialogKey]);
  return (
    <dialog ref={ref} open>
      <ColorInput label='Accent' value='#ff0000' onChange={() => {}} />
      <ColorInput label='Link' value='#0000ff' onChange={() => {}} />
    </dialog>
  );
};

// The highlight editor rebuilds each picker's onCommit from the colour being
// edited, so a re-render hands ColorInput a new callback identity while the
// popup stays open.
const ChangingCommit = ({
  onDialogKey,
  onCommitA,
}: {
  onDialogKey: (key: string) => void;
  onCommitA: () => void;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  const [, setVersion] = useState(0);
  useEffect(() => {
    const dialog = ref.current!;
    const listener = (e: KeyboardEvent) => onDialogKey(e.key);
    dialog.addEventListener('keydown', listener);
    return () => dialog.removeEventListener('keydown', listener);
  }, [onDialogKey]);
  return (
    <dialog ref={ref} open>
      <button type='button' onClick={() => setVersion((v) => v + 1)}>
        Bump
      </button>
      <ColorInput label='Accent' value='#ff0000' onChange={() => {}} onCommit={() => onCommitA()} />
      <ColorInput label='Link' value='#0000ff' onChange={() => {}} />
    </dialog>
  );
};

const swatch = () => screen.getByLabelText('Accent');
const nameField = () => screen.getByRole('button', { name: 'Theme name' });
// The popup's hex field is the only textbox on screen, so it doubles as the
// picker's "is it open" probe.
const pickerOpen = () => screen.queryByRole('textbox') !== null;

describe('ColorInput', () => {
  it('closes only the picker on Escape, and not the page behind it', async () => {
    const onDialogKey = vi.fn();
    const onCommit = vi.fn();
    render(<InDialog onDialogKey={onDialogKey} onCommit={onCommit} />);

    await userEvent.click(swatch());
    expect(pickerOpen()).toBe(true);
    // The picker opens from the swatch, so focus stays on it rather than moving
    // into the popup.
    swatch().focus();
    expect(document.activeElement).toBe(swatch());

    await userEvent.keyboard('{Escape}');

    expect(pickerOpen()).toBe(false);
    expect(onDialogKey).not.toHaveBeenCalled();
    // Closing the popup is the moment onCommit exists for, so an auto-save
    // consumer keeps the colour the user just picked.
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('closes only the picker on Escape from inside the popup', async () => {
    const onDialogKey = vi.fn();
    render(<InDialog onDialogKey={onDialogKey} />);

    await userEvent.click(swatch());
    screen.getByRole('textbox').focus();
    await userEvent.keyboard('{Escape}');

    expect(pickerOpen()).toBe(false);
    expect(onDialogKey).not.toHaveBeenCalled();
  });

  it('still owns Escape after focus has moved out of the picker', async () => {
    const onDialogKey = vi.fn();
    render(<InDialog onDialogKey={onDialogKey} />);

    await userEvent.click(swatch());
    expect(pickerOpen()).toBe(true);
    // No mousedown happens on a keyboard focus move, so the picker stays open
    // with focus outside it entirely.
    nameField().focus();
    expect(document.activeElement).toBe(nameField());

    await userEvent.keyboard('{Escape}');

    expect(pickerOpen()).toBe(false);
    expect(onDialogKey).not.toHaveBeenCalled();
  });

  it('leaves Escape to the page while the picker is closed', async () => {
    const onDialogKey = vi.fn();
    const onCommit = vi.fn();
    render(<InDialog onDialogKey={onDialogKey} onCommit={onCommit} />);

    nameField().focus();
    await userEvent.keyboard('{Escape}');

    expect(onDialogKey).toHaveBeenCalledWith('Escape');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('closes only the picker on Android Back, and not the page behind it', async () => {
    // Stands in for the settings dialog's Back listener, which registers when
    // the dialog opens and so before any picker does.
    const onDialogBack = vi.fn(() => true);
    eventDispatcher.onSync('native-key-down', onDialogBack);
    const onCommit = vi.fn();
    const pressBack = () => eventDispatcher.dispatchSync('native-key-down', { keyName: 'Back' });
    try {
      render(<InDialog onDialogKey={vi.fn()} onCommit={onCommit} />);
      await userEvent.click(swatch());
      expect(pickerOpen()).toBe(true);

      expect(pressBack()).toBe(true);
      await expect.poll(pickerOpen).toBe(false);
      expect(onDialogBack).not.toHaveBeenCalled();
      expect(onCommit).toHaveBeenCalledTimes(1);

      // With the picker closed, Back belongs to the page again.
      pressBack();
      expect(onDialogBack).toHaveBeenCalledTimes(1);
    } finally {
      eventDispatcher.offSync('native-key-down', onDialogBack);
    }
  });

  it('closes one picker per Escape when two are open', async () => {
    const onDialogKey = vi.fn();
    render(<TwoPickers onDialogKey={onDialogKey} />);

    // The first opens by pointer; the second by keyboard, which fires no
    // mousedown and so leaves the first one open too.
    await userEvent.click(screen.getByLabelText('Accent'));
    screen.getByLabelText('Link').focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    // The Enter that opened the second picker is expected to reach the page;
    // only Escape is the key being claimed here.
    onDialogKey.mockClear();

    await userEvent.keyboard('{Escape}');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(onDialogKey).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onDialogKey).not.toHaveBeenCalled();
  });

  it('keeps the last-opened picker on top when an earlier one re-renders', async () => {
    const onDialogKey = vi.fn();
    const onCommitA = vi.fn();
    render(<ChangingCommit onDialogKey={onDialogKey} onCommitA={onCommitA} />);

    await userEvent.click(screen.getByLabelText('Accent'));
    screen.getByLabelText('Link').focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getAllByRole('textbox')).toHaveLength(2);

    // Re-render the first picker with a fresh onCommit identity. By keyboard, as
    // a click would close both pickers through their mousedown listeners.
    screen.getByRole('button', { name: 'Bump' }).focus();
    await userEvent.keyboard('{Enter}');
    onDialogKey.mockClear();

    await userEvent.keyboard('{Escape}');

    // The second picker opened last, so it is the one Escape closes; the first
    // stays open and is not committed.
    const remaining = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.value).toBe('#ff0000');
    expect(onCommitA).not.toHaveBeenCalled();
    expect(onDialogKey).not.toHaveBeenCalledWith('Escape');
  });
});
