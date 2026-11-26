// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginSecuritySection } from '@/app/user/components/LoginSecuritySection';
import {
  DeleteLibraryDialog,
  openDeleteLibraryDialog,
} from '@/app/library/components/DeleteLibraryDialog';
import type { UserPlan } from '@/types/quota';

const handleDeleteAllBooks = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useUserActions', () => ({ useUserActions: () => ({ handleDeleteAllBooks }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, params?: Record<string, string | number>): string =>
      params ? key.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(params[name] ?? '')) : key,
}));

const renderActions = (userPlan: UserPlan = 'free', customizationPurchased = false) => {
  const onConfirmDelete = vi.fn();
  render(
    <LoginSecuritySection
      userEmail='reader@example.test'
      planName={`${userPlan} plan`}
      userPlan={userPlan}
      customizationPurchased={customizationPurchased}
      onResetPassword={vi.fn()}
      onUpdateEmail={vi.fn()}
      onConfirmDelete={onConfirmDelete}
    />,
  );
  return { onConfirmDelete };
};

const openAccountDeletion = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));
const confirmButton = () =>
  screen.getByRole('button', { name: 'Delete Permanently' }) as HTMLButtonElement;
const confirmationInput = () => screen.getByRole('textbox', { name: 'Type DELETE to confirm' });

afterEach(cleanup);

describe('account deletion confirmation (#7251)', () => {
  it('identifies the account and its plan inside the confirmation', () => {
    renderActions('plus');
    openAccountDeletion();

    const dialog = screen.getByText('Delete Your Account?').parentElement!;
    expect(dialog.textContent).toContain('reader@example.test');
    expect(dialog.textContent).toContain('plus plan');
    expect(dialog.textContent).toContain('All your data in the cloud will be permanently deleted.');
  });

  it.each<UserPlan>([
    'plus',
    'pro',
    'purchase',
  ])('warns about paid benefits for %s accounts', (plan) => {
    renderActions(plan);
    openAccountDeletion();
    expect(screen.getByText('This account has a paid plan or purchases.')).toBeTruthy();
  });

  it('warns about a customization purchase even on the free plan', () => {
    renderActions('free', true);
    openAccountDeletion();
    expect(screen.getByText('This account has a paid plan or purchases.')).toBeTruthy();
  });

  it('does not claim a free account has paid benefits', () => {
    renderActions();
    openAccountDeletion();
    expect(screen.queryByText('This account has a paid plan or purchases.')).toBeNull();
  });

  it('only enables deletion after typing the exact confirmation word', async () => {
    const { onConfirmDelete } = renderActions();
    openAccountDeletion();

    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(confirmButton());
    expect(onConfirmDelete).not.toHaveBeenCalled();

    for (const text of ['delete', 'Delete', 'DELETE ', 'DELET', '']) {
      fireEvent.change(confirmationInput(), { target: { value: text } });
      expect(confirmButton().disabled).toBe(true);
      fireEvent.click(confirmButton());
      expect(onConfirmDelete).not.toHaveBeenCalled();
    }

    fireEvent.change(confirmationInput(), { target: { value: 'DELETE' } });
    expect(confirmButton().disabled).toBe(false);
    fireEvent.click(confirmButton());
    expect(onConfirmDelete).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('clears typed confirmation after canceling and reopening', () => {
    const { onConfirmDelete } = renderActions();
    openAccountDeletion();
    fireEvent.change(confirmationInput(), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirmDelete).not.toHaveBeenCalled();

    openAccountDeletion();
    expect((confirmationInput() as HTMLInputElement).value).toBe('');
    expect(confirmButton().disabled).toBe(true);
  });

  it('focuses the confirmation field and restores the trigger after canceling', async () => {
    renderActions();
    const trigger = screen.getByRole('button', { name: 'Delete Account' });
    trigger.focus();
    openAccountDeletion();
    expect(document.activeElement).toBe(confirmationInput());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('returns focus to the dialog if a page control tries to take it', () => {
    renderActions();
    openAccountDeletion();
    screen.getByRole('button', { name: 'Change Password' }).focus();
    expect(document.activeElement).toBe(confirmationInput());
  });

  it('keeps Tab and Shift+Tab inside the dialog as confirmation becomes enabled', () => {
    renderActions();
    openAccountDeletion();
    const input = confirmationInput();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    input.focus();
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'DELETE' } });
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirmButton());
    fireEvent.keyDown(confirmButton(), { key: 'Tab' });
    expect(document.activeElement).toBe(input);
  });

  it('keeps the Delete Library Data confirmation independent', async () => {
    const { onConfirmDelete } = renderActions('pro');
    render(<DeleteLibraryDialog />);
    openAccountDeletion();
    fireEvent.change(confirmationInput(), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    act(() => openDeleteLibraryDialog());

    expect(screen.getByRole('dialog', { name: 'Delete Library Data?' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('reader@example.test')).toBeNull();
    expect(confirmButton().disabled).toBe(false);
    fireEvent.click(confirmButton());
    expect(handleDeleteAllBooks).toHaveBeenCalledTimes(1);
    expect(onConfirmDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
