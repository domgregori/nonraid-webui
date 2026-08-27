import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddRemoteForm } from './AddRemoteForm';
import { rcloneApi } from '../../api/rcloneApi';
import type { RcloneProvider, RcloneRemote } from '../../types/rcloneApi';

vi.mock('../../api/rcloneApi', () => ({
  rcloneApi: {
    getRemoteConfig: vi.fn(),
    createRemote: vi.fn(),
    updateRemote: vi.fn(),
  },
}));

const s3Provider: RcloneProvider = {
  name: 's3',
  description: 'Amazon S3',
  oauth: false,
  options: [{ name: 'access_key_id', help: 'AWS Access Key ID', default: '', required: true, isPassword: false, type: 'string' }],
  advancedOptions: [{ name: 'region', help: 'AWS Region', default: '', required: false, isPassword: false, type: 'string' }],
};

const driveProvider: RcloneProvider = {
  name: 'drive',
  description: 'Google Drive',
  oauth: true,
  options: [{ name: 'client_id', help: 'Client ID', default: '', required: false, isPassword: false, type: 'string' }],
  advancedOptions: [{ name: 'scope', help: 'Scope', default: '', required: false, isPassword: false, type: 'string' }],
};

describe('AddRemoteForm provider search', () => {
  // The box starts pre-filled with the auto-selected first provider's description (remoteType
  // defaults to providers[0]), matching a real combobox that shows the current selection until the
  // admin clears it - so every case below clears the field first to test the actual empty-query /
  // typed-query search behavior, rather than the "Amazon S3" substring the default value would
  // otherwise silently filter everything through.
  it('shows every provider once the query is cleared', async () => {
    const user = userEvent.setup();
    render(<AddRemoteForm providers={[s3Provider, driveProvider]} onAdded={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByPlaceholderText('Type to search providers…');
    await user.click(input);
    await user.clear(input);
    expect(screen.getByText('Amazon S3')).toBeInTheDocument();
    expect(screen.getByText('Google Drive')).toBeInTheDocument();
  });

  it('filters the menu to providers whose description matches the typed query, case-insensitively', async () => {
    const user = userEvent.setup();
    render(<AddRemoteForm providers={[s3Provider, driveProvider]} onAdded={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByPlaceholderText('Type to search providers…');
    await user.click(input);
    await user.clear(input);
    await user.type(input, 'DRIV');
    expect(screen.getByText('Google Drive')).toBeInTheDocument();
    expect(screen.queryByText('Amazon S3')).not.toBeInTheDocument();
  });

  it('shows no menu items for a query matching nothing', async () => {
    const user = userEvent.setup();
    render(<AddRemoteForm providers={[s3Provider, driveProvider]} onAdded={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByPlaceholderText('Type to search providers…');
    await user.click(input);
    await user.clear(input);
    await user.type(input, 'nonexistent');
    expect(screen.queryByText('Amazon S3')).not.toBeInTheDocument();
    expect(screen.queryByText('Google Drive')).not.toBeInTheDocument();
  });

  it('selects a provider by clicking it in the menu, closing the menu and resetting its fields', async () => {
    const user = userEvent.setup();
    render(<AddRemoteForm providers={[s3Provider, driveProvider]} onAdded={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByPlaceholderText('Type to search providers…');
    await user.click(input);
    await user.clear(input);
    await user.click(screen.getByText('Google Drive'));
    expect(input).toHaveValue('Google Drive');
    expect(screen.queryByText('Amazon S3')).not.toBeInTheDocument(); // menu closed
  });
});

describe('AddRemoteForm manual-credential fields (OAuth providers)', () => {
  it('shows standard fields immediately for a non-OAuth provider, with no manual-credentials toggle', async () => {
    render(<AddRemoteForm providers={[s3Provider]} onAdded={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('AWS Access Key ID')).toBeInTheDocument();
    expect(screen.queryByText('Use my own API credentials…')).not.toBeInTheDocument();
  });

  it('hides manual credential fields behind a toggle for an OAuth provider, and offers a Connect shortcut', async () => {
    const user = userEvent.setup();
    render(<AddRemoteForm providers={[driveProvider]} onAdded={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText('Client ID')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect with Google Drive' })).toBeInTheDocument();
    await user.click(screen.getByText('Use my own API credentials…'));
    expect(screen.getByText('Client ID')).toBeInTheDocument();
  });

  it('re-hides manual fields when toggled again', async () => {
    const user = userEvent.setup();
    render(<AddRemoteForm providers={[driveProvider]} onAdded={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByText('Use my own API credentials…'));
    expect(screen.getByText('Client ID')).toBeInTheDocument();
    await user.click(screen.getByText('Hide manual credentials'));
    expect(screen.queryByText('Client ID')).not.toBeInTheDocument();
  });

  it('does not offer the manual-credentials toggle for an OAuth provider with no standard options at all', async () => {
    const noOptionsOauth: RcloneProvider = { ...driveProvider, options: [] };
    render(<AddRemoteForm providers={[noOptionsOauth]} onAdded={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText('Use my own API credentials…')).not.toBeInTheDocument();
  });
});

describe('AddRemoteForm "More options" (advanced fields)', () => {
  it('rolls up advanced fields behind "More options…" for a non-OAuth provider', async () => {
    const user = userEvent.setup();
    render(<AddRemoteForm providers={[s3Provider]} onAdded={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText('AWS Region')).not.toBeInTheDocument();
    await user.click(screen.getByText('More options…'));
    expect(screen.getByText('AWS Region')).toBeInTheDocument();
  });

  it('does not offer "More options" until manual fields are shown for an OAuth provider', async () => {
    const user = userEvent.setup();
    render(<AddRemoteForm providers={[driveProvider]} onAdded={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText('More options…')).not.toBeInTheDocument();
    await user.click(screen.getByText('Use my own API credentials…'));
    expect(screen.getByText('More options…')).toBeInTheDocument();
    expect(screen.queryByText('Scope')).not.toBeInTheDocument();
    await user.click(screen.getByText('More options…'));
    expect(screen.getByText('Scope')).toBeInTheDocument();
  });

  it('does not offer "More options" for a provider with no advanced fields', async () => {
    const noAdvanced: RcloneProvider = { ...s3Provider, advancedOptions: [] };
    render(<AddRemoteForm providers={[noAdvanced]} onAdded={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText('More options…')).not.toBeInTheDocument();
  });
});

describe('AddRemoteForm editing an existing remote', () => {
  const editingRemote: RcloneRemote = { name: 'my-drive', type: 'drive', status: 'ok', statusMessage: null };

  it('pre-fills saved parameters, skipping password fields, and always shows all fields regardless of OAuth', async () => {
    vi.mocked(rcloneApi.getRemoteConfig).mockResolvedValue({ type: 'drive', parameters: { client_id: 'abc123' } });
    render(<AddRemoteForm providers={[driveProvider]} editingRemote={editingRemote} onAdded={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Client ID')).toBeInTheDocument());
    expect(screen.getByDisplayValue('abc123')).toBeInTheDocument();
    // No manual-credentials disclosure while editing - everything's already shown.
    expect(screen.queryByText('Use my own API credentials…')).not.toBeInTheDocument();
  });

  it('auto-expands "More options" when a saved advanced field is present', async () => {
    vi.mocked(rcloneApi.getRemoteConfig).mockResolvedValue({ type: 'drive', parameters: { client_id: 'abc123', scope: 'drive.readonly' } });
    render(<AddRemoteForm providers={[driveProvider]} editingRemote={editingRemote} onAdded={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Scope')).toBeInTheDocument());
    expect(screen.getByDisplayValue('drive.readonly')).toBeInTheDocument();
    expect(screen.getByText('Hide more options')).toBeInTheDocument();
  });

  it('leaves "More options" collapsed when no saved advanced field is present', async () => {
    vi.mocked(rcloneApi.getRemoteConfig).mockResolvedValue({ type: 'drive', parameters: { client_id: 'abc123' } });
    render(<AddRemoteForm providers={[driveProvider]} editingRemote={editingRemote} onAdded={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Client ID')).toBeInTheDocument());
    expect(screen.getByText('More options…')).toBeInTheDocument();
    expect(screen.queryByText('Scope')).not.toBeInTheDocument();
  });

  it('submits via updateRemote (not createRemote) and reports the unchanged name/type', async () => {
    vi.mocked(rcloneApi.getRemoteConfig).mockResolvedValue({ type: 'drive', parameters: { client_id: 'abc123' } });
    vi.mocked(rcloneApi.updateRemote).mockResolvedValue({ ok: true, message: 'ok' });
    const onAdded = vi.fn();
    const user = userEvent.setup();
    render(<AddRemoteForm providers={[driveProvider]} editingRemote={editingRemote} onAdded={onAdded} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Client ID')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(rcloneApi.updateRemote).toHaveBeenCalledWith('my-drive', { client_id: 'abc123' }));
    expect(onAdded).toHaveBeenCalledWith({ name: 'my-drive', type: 'drive' });
    expect(rcloneApi.createRemote).not.toHaveBeenCalled();
  });
});

describe('AddRemoteForm submitting a new remote', () => {
  it('requires both a provider and a name before submitting', async () => {
    const user = userEvent.setup();
    const onAdded = vi.fn();
    render(<AddRemoteForm providers={[s3Provider]} onAdded={onAdded} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Test & Save' }));
    expect(await screen.findByText('Provider and name are required.')).toBeInTheDocument();
    expect(onAdded).not.toHaveBeenCalled();
    expect(rcloneApi.createRemote).not.toHaveBeenCalled();
  });

  it('creates the remote with the entered fields and reports success when done', async () => {
    vi.mocked(rcloneApi.createRemote).mockResolvedValue({ done: true, authUrl: null, state: null, needsToken: false });
    const onAdded = vi.fn();
    const user = userEvent.setup();
    render(<AddRemoteForm providers={[s3Provider]} onAdded={onAdded} onCancel={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('e.g. offsite-b2'), 'my-s3');
    await user.type(screen.getByLabelText('AWS Access Key ID'), 'AKIA123');
    await user.click(screen.getByRole('button', { name: 'Test & Save' }));
    await waitFor(() => expect(rcloneApi.createRemote).toHaveBeenCalledWith('my-s3', 's3', { access_key_id: 'AKIA123' }));
    expect(onAdded).toHaveBeenCalledWith({ name: 'my-s3', type: 's3' });
  });
});
