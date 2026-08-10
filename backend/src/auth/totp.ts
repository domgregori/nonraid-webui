import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';

const ISSUER = 'nonraid';
// otplib's default epochTolerance is 0 (only the exact current 30s step verifies) — widened to
// one step either side so a slightly clock-drifted phone still works, without opening a large
// replay window. Matches the ±1-step tolerance most TOTP implementations use by convention.
const EPOCH_TOLERANCE_SECONDS = 30;

export function generateTotpSecret(): string {
  return generateSecret();
}

export function totpProvisioningUri(username: string, secret: string): string {
  return generateURI({ issuer: ISSUER, label: username, secret });
}

// Renders entirely locally (no network call) — this is a LAN NAS tool and must not phone out to
// generate a QR code for a secret this sensitive.
export async function totpQrDataUri(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri);
}

// otplib's own guardrails throw (not return { valid: false }) for a malformed token — e.g. a
// backup code entered here instead of a 6-digit TOTP code threw "Token must be 6 digits, got 14"
// straight past the caller, confirmed live. This module's whole job is "is this a valid TOTP code
// or not" — a malformed one is exactly that, not a server error, so it's treated the same as an
// incorrect one rather than left to propagate as an exception (verifyTwoFactor's backup-code
// fallback would otherwise never run for anything shaped unlike a 6-digit code).
export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  try {
    const result = await verify({ secret, token: code, epochTolerance: EPOCH_TOLERANCE_SECONDS });
    return result.valid;
  } catch {
    return false;
  }
}
