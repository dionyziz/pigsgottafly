// @vitest-environment jsdom
// The sign-in screen: Google's button, and Sign in with Apple under it only when the server has an
// Apple Services ID (GET /session appleClientId).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { SignIn } from '../../../src/app/SignIn';
import { api } from '../../../src/data/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.AppleID;
});

const show = (appleClientId: string | null, onSignedIn = () => {}) =>
  render(
    <MemoryRouter>
      <SignIn clientId="g.apps.googleusercontent.com" appleClientId={appleClientId} onSignedIn={onSignedIn} />
    </MemoryRouter>,
  );

describe('sign-in screen', () => {
  test('no Apple Services ID: no Apple button', () => {
    show(null);
    expect(screen.queryByTestId('apple-signin')).toBeNull();
    expect(screen.queryByText('Sign in with Apple')).toBeNull();
  });

  test('with an Apple Services ID: Sign in with Apple, which signs in through POST /login/apple', async () => {
    const init = vi.fn();
    window.AppleID = {
      auth: {
        init,
        signIn: async () => ({
          authorization: { id_token: 'apple.id.token' },
          user: { name: { firstName: 'Nea', lastName: 'Pilotos' } },
        }),
      },
    };
    const login = vi.spyOn(api, 'loginApple').mockResolvedValue({ ok: true, pilot: {} as never });
    const onSignedIn = vi.fn();
    show('com.example.web', onSignedIn);
    const button = screen.getByTestId('apple-signin');
    expect(button.textContent).toBe('Sign in with Apple');
    // Apple JS is set up with this Services ID, in a popup
    await waitFor(() => expect(button).not.toHaveProperty('disabled', true));
    expect(init).toHaveBeenCalledWith({
      clientId: 'com.example.web',
      scope: 'name email',
      redirectURI: location.origin + '/',
      usePopup: true,
    });
    fireEvent.click(button);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(login).toHaveBeenCalledWith({ idToken: 'apple.id.token', name: 'Nea Pilotos' });
  });
});
