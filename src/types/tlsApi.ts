// Mirrors backend/src/tls/types.ts plus routes/tls.ts's status payload shape. Keep in sync.
export type TlsSource = 'self-signed' | 'imported';

export interface TlsStatus {
  enabled: boolean;
  configured: boolean;
  source?: TlsSource;
  commonName?: string;
  sans?: string[];
  issuedAt?: number;
  expiresAt?: number;
  suggestedCommonName: string;
  suggestedSans: string[];
  currentOrigin: string;
}

export interface TlsApplyResult {
  ok: boolean;
  message: string;
  newOrigin: string;
}
