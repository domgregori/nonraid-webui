import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./rcCredentials.js', () => ({
  getRcloneRcCredentials: async () => ({ user: 'rc-user', pass: 'rc-pass' }),
}));

const { RealRcloneClient } = await import('./realClient.js');

// Mirrors the subset of rclone's real `config/providers` per-option JSON shape this client reads
// (see realClient.ts's own RcProviderOptionJson doc comment) - not exported from realClient.ts, so
// duplicated here rather than widening that module's public surface just for a test fixture.
function opt(overrides: Partial<{ Name: string; Help: string; Default: unknown; Required: boolean; IsPassword: boolean; Advanced: boolean; Hide: number; Type: string }> = {}) {
  return {
    Name: 'field',
    Help: 'A field',
    Default: null,
    Required: false,
    IsPassword: false,
    Advanced: false,
    Hide: 0,
    Type: 'string',
    ...overrides,
  };
}

function mockProvidersResponse(providers: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ providers }),
    })),
  );
}

describe('RealRcloneClient.listProviders', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects oauth providers by the presence of both auth_url and token_url options', async () => {
    mockProvidersResponse([
      { Name: 'drive', Description: 'Google Drive', Options: [opt({ Name: 'auth_url', Advanced: true }), opt({ Name: 'token_url', Advanced: true })] },
      { Name: 's3', Description: 'Amazon S3', Options: [opt({ Name: 'access_key_id' })] },
      { Name: 'onedrive', Description: 'OneDrive (auth_url only)', Options: [opt({ Name: 'auth_url', Advanced: true })] },
    ]);
    const providers = await new RealRcloneClient().listProviders();
    expect(providers.find((p) => p.name === 'drive')?.oauth).toBe(true);
    expect(providers.find((p) => p.name === 's3')?.oauth).toBe(false);
    expect(providers.find((p) => p.name === 'onedrive')?.oauth).toBe(false); // needs BOTH fields
  });

  it('splits options into standard vs advanced by the Advanced flag', async () => {
    mockProvidersResponse([
      {
        Name: 's3',
        Description: 'Amazon S3',
        Options: [opt({ Name: 'access_key_id', Advanced: false }), opt({ Name: 'region', Advanced: true })],
      },
    ]);
    const [provider] = await new RealRcloneClient().listProviders();
    expect(provider!.options.map((o) => o.name)).toEqual(['access_key_id']);
    expect(provider!.advancedOptions.map((o) => o.name)).toEqual(['region']);
  });

  it('drops a field with Hide bit 2 set from both options and advancedOptions', async () => {
    mockProvidersResponse([
      {
        Name: 'drive',
        Description: 'Google Drive',
        Options: [
          opt({ Name: 'alternate_export', Advanced: false, Hide: 2 }), // confirmed-live case from the doc comment
          opt({ Name: 'team_drive', Advanced: true, Hide: 2 }),
          opt({ Name: 'cli_only', Advanced: false, Hide: 1 }), // bit 1 (CLI-only) alone stays visible
        ],
      },
    ]);
    const [provider] = await new RealRcloneClient().listProviders();
    expect(provider!.options.map((o) => o.name)).toEqual(['cli_only']);
    expect(provider!.advancedOptions).toEqual([]);
  });

  it('drops a field whose Help starts with "Deprecated" even when Advanced and Hide miss it', async () => {
    mockProvidersResponse([
      {
        Name: 'drive',
        Description: 'Google Drive',
        Options: [
          // The confirmed-live case: Advanced true, Hide 0, but Help says Deprecated.
          opt({ Name: 'use_created_date', Advanced: true, Hide: 0, Help: 'Deprecated: use --server-side-across-configs instead.' }),
          opt({ Name: 'keep_me', Advanced: true, Hide: 0, Help: 'A perfectly normal advanced field.' }),
          // A non-advanced field whose Help also happens to say Deprecated - still dropped.
          opt({ Name: 'old_flag', Advanced: false, Hide: 0, Help: 'deprecated: no longer needed.' }),
        ],
      },
    ]);
    const [provider] = await new RealRcloneClient().listProviders();
    expect(provider!.options).toEqual([]);
    expect(provider!.advancedOptions.map((o) => o.name)).toEqual(['keep_me']);
  });

  it('maps a null Default to an empty string, and passes required/isPassword/type through', async () => {
    mockProvidersResponse([
      {
        Name: 's3',
        Description: 'Amazon S3',
        Options: [opt({ Name: 'secret_access_key', Default: null, Required: true, IsPassword: true, Type: 'string' })],
      },
    ]);
    const [provider] = await new RealRcloneClient().listProviders();
    expect(provider!.options[0]).toEqual({
      name: 'secret_access_key',
      help: 'A field',
      default: '',
      required: true,
      isPassword: true,
      type: 'string',
    });
  });

  it('stringifies a non-null Default', async () => {
    mockProvidersResponse([{ Name: 's3', Description: 'Amazon S3', Options: [opt({ Name: 'chunk_size', Default: 5, Type: 'int' })] }]);
    const [provider] = await new RealRcloneClient().listProviders();
    expect(provider!.options[0]?.default).toBe('5');
  });
});
