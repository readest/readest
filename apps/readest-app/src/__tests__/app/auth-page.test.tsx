import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/auth-ui-react', () => ({ Auth: () => null }));
vi.mock('@supabase/auth-ui-shared', () => ({ ThemeSupa: {} }));

import { ProviderLogin } from '@/app/auth/page';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ProviderLogin', () => {
  it('contains a rejected native sign-in request', async () => {
    const error = new Error('The operation could not be completed. Authentication error 1.');
    const handleSignIn = vi.fn().mockRejectedValue(error);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <ProviderLogin
        provider='apple'
        handleSignIn={handleSignIn}
        Icon={() => null}
        label='Sign in with Apple'
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Apple' }));

    await waitFor(() => {
      expect(consoleWarn).toHaveBeenCalledWith('Failed to sign in with apple:', error);
    });
  });
});
