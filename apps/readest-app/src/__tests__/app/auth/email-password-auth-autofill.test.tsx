import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import EmailPasswordAuth from '@/app/auth/components/EmailPasswordAuth';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const createSupabaseMock = () => {
  const auth = {
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
  };
  return { client: { auth } as unknown as SupabaseClient, auth };
};

// Simulates how Android/iOS password managers fill WebView inputs: the DOM
// value changes but no input event that React can observe is dispatched.
const autofill = (input: HTMLInputElement, value: string) => {
  input.value = value;
};

describe('EmailPasswordAuth autofill (#5499)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('signs in with credentials autofilled without React change events', async () => {
    const { client, auth } = createSupabaseMock();
    const { container } = render(<EmailPasswordAuth supabaseClient={client} />);

    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    const password = container.querySelector('input[name="password"]') as HTMLInputElement;
    expect(email).toBeTruthy();
    expect(password).toBeTruthy();

    autofill(email, 'reader@example.com');
    autofill(password, 'hunter2secret');
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => {
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'reader@example.com',
        password: 'hunter2secret',
      });
    });
  });

  it('renders stable field names, ids, and autofill-friendly autocomplete hints', () => {
    const { client } = createSupabaseMock();
    const { container } = render(<EmailPasswordAuth supabaseClient={client} />);

    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    const password = container.querySelector('input[name="password"]') as HTMLInputElement;

    expect(email.id).toBe('email');
    expect(email.getAttribute('autocomplete')).toBe('username');
    expect(email.type).toBe('email');
    expect(password.id).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    expect(password.type).toBe('password');
  });

  it('signs up with autofilled credentials and a new-password hint', async () => {
    const { client, auth } = createSupabaseMock();
    const { container, getByText } = render(
      <EmailPasswordAuth
        supabaseClient={client}
        redirectTo='https://web.readest.com/auth/callback'
      />,
    );

    fireEvent.click(getByText("Don't have an account? Sign up"));

    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    const password = container.querySelector('input[name="password"]') as HTMLInputElement;
    expect(password.getAttribute('autocomplete')).toBe('new-password');

    autofill(email, 'new@example.com');
    autofill(password, 'freshpassw0rd');
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => {
      expect(auth.signUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'freshpassw0rd',
        options: { emailRedirectTo: 'https://web.readest.com/auth/callback' },
      });
    });
  });

  it('sends a magic link and a reset email with the FormData email', async () => {
    const { client, auth } = createSupabaseMock();
    const { container, getByText } = render(
      <EmailPasswordAuth
        supabaseClient={client}
        magicLink={true}
        redirectTo='https://web.readest.com/auth/callback'
      />,
    );

    fireEvent.click(getByText('Send a magic link email'));
    let email = container.querySelector('input[name="email"]') as HTMLInputElement;
    autofill(email, 'magic@example.com');
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => {
      expect(auth.signInWithOtp).toHaveBeenCalledWith({
        email: 'magic@example.com',
        options: { emailRedirectTo: 'https://web.readest.com/auth/callback' },
      });
    });

    fireEvent.click(getByText('Already have an account? Sign in'));
    fireEvent.click(getByText('Forgot your password?'));
    email = container.querySelector('input[name="email"]') as HTMLInputElement;
    autofill(email, 'forgot@example.com');
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => {
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('forgot@example.com', {
        redirectTo: 'https://web.readest.com/auth/callback',
      });
    });
  });

  it('shows the auth error message when sign-in fails', async () => {
    const { client, auth } = createSupabaseMock();
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const { container, findByText } = render(<EmailPasswordAuth supabaseClient={client} />);

    autofill(container.querySelector('input[name="email"]') as HTMLInputElement, 'a@b.c');
    autofill(container.querySelector('input[name="password"]') as HTMLInputElement, 'nope');
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    expect(await findByText('Invalid login credentials')).toBeTruthy();
  });
});
