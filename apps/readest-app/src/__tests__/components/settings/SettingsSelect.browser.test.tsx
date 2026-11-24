import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import SettingsSelect from '@/components/settings/primitives/SettingsSelect';

await import('@/styles/globals.css');

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('dir');
});

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

const renderSelect = () => {
  render(<SettingsSelect value='a' onChange={() => {}} options={options} ariaLabel='Pick' />);
  return screen.getByLabelText('Pick') as HTMLSelectElement;
};

// Where the chevron is drawn, relative to the given element's box.
const chevronOffset = (select: HTMLSelectElement, el: Element = select) => {
  const box = el.getBoundingClientRect();
  const icon = select.parentElement!.querySelector('svg')!.getBoundingClientRect();
  return {
    x: icon.left - box.left + icon.width / 2,
    y: icon.top - box.top + icon.height / 2,
  };
};

const isOpen = (select: HTMLSelectElement) => select.matches(':open');

// Dialog.tsx listens for Escape on the <dialog> element itself, natively.
const InDialog = ({ onDialogKey }: { onDialogKey: (key: string) => void }) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const listener = (e: KeyboardEvent) => onDialogKey(e.key);
    dialog.addEventListener('keydown', listener);
    return () => dialog.removeEventListener('keydown', listener);
  }, [onDialogKey]);
  return (
    <dialog ref={ref} open>
      <SettingsSelect value='a' onChange={() => {}} options={options} ariaLabel='Pick' />
    </dialog>
  );
};

describe('SettingsSelect', () => {
  it.each(['ltr', 'rtl'])('takes a press on the chevron as a press on the select (%s)', (dir) => {
    // #7650: the chevron sat outside the <select> with pointer-events: none,
    // so pressing it hit the wrapper and nothing opened.
    document.documentElement.setAttribute('dir', dir);
    const select = renderSelect();
    const box = select.getBoundingClientRect();
    const { x, y } = chevronOffset(select);
    expect(document.elementFromPoint(box.left + x, box.top + y)).toBe(select);
  });

  it('opens from the chevron and closes on a second press', async () => {
    const select = renderSelect();
    // Press the control where the chevron is drawn, whatever element is there.
    const control = select.parentElement!;
    const position = chevronOffset(select, control);
    await userEvent.click(control, { position });
    expect(isOpen(select)).toBe(true);
    await userEvent.click(control, { position });
    expect(isOpen(select)).toBe(false);
  });

  it('closes only the picker on Escape, not the dialog around it', async () => {
    const onDialogKey = vi.fn();
    render(<InDialog onDialogKey={onDialogKey} />);
    const select = screen.getByLabelText('Pick') as HTMLSelectElement;
    await userEvent.click(select);
    expect(isOpen(select)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(isOpen(select)).toBe(false);
    expect(onDialogKey).not.toHaveBeenCalled();
  });

  it('leaves Escape to the dialog while the picker is closed', async () => {
    const onDialogKey = vi.fn();
    render(<InDialog onDialogKey={onDialogKey} />);
    (screen.getByLabelText('Pick') as HTMLSelectElement).focus();
    await userEvent.keyboard('{Escape}');
    expect(onDialogKey).toHaveBeenCalledWith('Escape');
  });
});
