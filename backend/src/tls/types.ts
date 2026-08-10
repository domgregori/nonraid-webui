// Persisted to tls.json — see store.ts's doc comment. The PEM material itself lives on disk
// (certPath/keyPath, under config.tlsCertDir), not embedded here; this record is metadata only.
export interface TlsRecord {
  enabled: boolean;
  source: 'self-signed' | 'imported';
  certPath: string;
  keyPath: string;
  commonName: string;
  sans: string[];
  issuedAt: number;
  expiresAt: number;
}
