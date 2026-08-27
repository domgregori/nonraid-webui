// Mirrors backend/src/system/sshKeys.ts's public entry shape (routes/ssh.ts's toPublicEntry) plus
// the enabled-at-boot flag from routes/ssh.ts's GET /ssh/status. Keep in sync.
export interface SshKeyEntry {
  type: string;
  comment: string;
  /** Last 12 chars of the key body - identifies the key for removal without ever holding a full
   *  public key client-side. */
  fingerprint: string;
}

export interface SshStatus {
  enabled: boolean;
  keys: SshKeyEntry[];
}
