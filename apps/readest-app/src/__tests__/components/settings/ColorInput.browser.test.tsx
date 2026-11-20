import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import ColorInput from '@/components/settings/theme/ColorInput';

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
});
