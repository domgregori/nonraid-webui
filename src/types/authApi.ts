export interface AuthStatusResponse {
  configured: boolean;
  authenticated: boolean;
}

export type TwoFactorMethod = 'totp' | 'passkey';

// login() returns this instead of the plain AuthStatusResponse — additive, so setup()/logout()/
// status() keep their existing plain shape untouched.
export interface LoginResponse extends AuthStatusResponse {
  twoFactorRequired?: boolean;
  twoFactorMethods?: TwoFactorMethod[];
}

export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: number;
}

export interface TwoFactorStatus {
  totpEnabled: boolean;
  backupCodesRemaining: number;
  passkeys: PasskeySummary[];
}

export interface TotpEnrollResponse {
  secret: string;
  otpauthUri: string;
  qrDataUri: string;
}

export interface BackupCodesResponse {
  backupCodes: string[];
}
