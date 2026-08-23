import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddUserModal } from './AddUserModal';
import type { UserInput } from '../../types/usersApi';

describe('AddUserModal', () => {
  function setup(
    props: {
      existingUsernames?: string[];
      onCancel?: () => void;
      onSubmit?: (input: UserInput) => Promise<boolean>;
    } = {},
  ) {
    const onCancel = props.onCancel ?? vi.fn();
    const onSubmit = props.onSubmit ?? vi.fn(async () => true);
    const user = userEvent.setup();
    render(
      <AddUserModal existingUsernames={props.existingUsernames ?? []} onCancel={onCancel} onSubmit={onSubmit} />,
    );
    return { user, onCancel, onSubmit };
  }

  it('renders the dialog with a title, the three fields, and the action buttons', () => {
    setup();
    expect(screen.getByText('Add User')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create User' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows the username validation error on an empty submit and does not call onSubmit', async () => {
    const { user, onSubmit } = setup();
    await user.click(screen.getByRole('button', { name: 'Create User' }));
    expect(
      await screen.findByText(
        'Username must be lowercase letters, numbers, dash, underscore - starting with a letter or underscore.',
      ),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a username that does not start with a letter or underscore', async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByLabelText('Username'), '1abc');
    await user.click(screen.getByRole('button', { name: 'Create User' }));
    expect(
      await screen.findByText(
        'Username must be lowercase letters, numbers, dash, underscore - starting with a letter or underscore.',
      ),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a username that already exists', async () => {
    const { user } = setup({ existingUsernames: ['bob'] });
    await user.type(screen.getByLabelText('Username'), 'bob');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create User' }));
    expect(await screen.findByText('User "bob" already exists.')).toBeInTheDocument();
  });

  it('rejects a password shorter than 8 characters', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create User' }));
    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
  });

  it('rejects mismatched passwords', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password124');
    await user.click(screen.getByRole('button', { name: 'Create User' }));
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
  });

  it('submits the entered username (lowercased), password, and empty groups on a valid submit', async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByLabelText('Username'), 'Alice');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create User' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ username: 'alice', password: 'password123', groups: [] });
  });

  it('shows the request-failed error when onSubmit resolves false', async () => {
    const { user } = setup({ onSubmit: vi.fn(async () => false) });
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create User' }));
    expect(
      await screen.findByText('Request failed - see the page error banner for details.'),
    ).toBeInTheDocument();
  });

  it('disables the submit button and shows Creating… while onSubmit is pending', async () => {
    let resolveSubmit!: (ok: boolean) => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const { user } = setup({ onSubmit });
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create User' }));
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    await act(async () => {
      resolveSubmit(true);
    });
    expect(screen.getByRole('button', { name: 'Create User' })).not.toBeDisabled();
  });

  it('calls onCancel when the Cancel button is clicked', async () => {
    const { user, onCancel } = setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
