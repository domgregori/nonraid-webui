import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { AuthRecord, PasskeyCredential } from './types.js';

const RP_NAME = 'nonraid';
// Long enough for a real registration/authentication ceremony (user has to physically interact
// with an authenticator), short enough to keep the replay window on a captured challenge small.
const CHALLENGE_TTL_MS = 2 * 60 * 1000;

interface PendingChallenge {
  challenge: string;
  expiresAt: number;
}

// Keyed by username — single-admin account, so effectively one slot. Deliberately not persisted
// to auth.json: these are one-attempt values, churning the file on every "Add Passkey" click would
// be pointless, and a backend restart mid-ceremony just means the user retries, same as any other
// interrupted multi-step flow in this app (e.g. ImportArrayWizard).
const pendingChallenges = new Map<string, PendingChallenge>();

export function requireWebauthnConfig(): { rpID: string; origin: string } {
  const { webauthnRpId, webauthnOrigin } = config;
  if (!webauthnRpId || !webauthnOrigin) {
    throw new HttpError(400, 'WebAuthn is not configured — set WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN.');
  }
  return { rpID: webauthnRpId, origin: webauthnOrigin };
}

function setPendingChallenge(username: string, challenge: string): void {
  pendingChallenges.set(username, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}

function takePendingChallenge(username: string): string {
  const entry = pendingChallenges.get(username);
  pendingChallenges.delete(username); // one-shot — a challenge is only ever valid for a single attempt
  if (!entry || entry.expiresAt < Date.now()) {
    throw new HttpError(400, 'No pending WebAuthn request — try again.');
  }
  return entry.challenge;
}

function transports(cred: PasskeyCredential): AuthenticatorTransportFuture[] | undefined {
  return cred.transports as AuthenticatorTransportFuture[] | undefined;
}

export async function passkeyRegistrationOptions(record: AuthRecord): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID } = requireWebauthnConfig();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: record.username,
    attestationType: 'none',
    excludeCredentials: (record.passkeys ?? []).map((p) => ({ id: p.id, transports: transports(p) })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  setPendingChallenge(record.username, options.challenge);
  return options;
}

export async function verifyPasskeyRegistration(record: AuthRecord, response: RegistrationResponseJSON): Promise<Omit<PasskeyCredential, 'name'>> {
  const { rpID, origin } = requireWebauthnConfig();
  const expectedChallenge = takePendingChallenge(record.username);
  const verification = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID });
  if (!verification.verified || !verification.registrationInfo) {
    throw new HttpError(401, 'Passkey registration could not be verified.');
  }
  const { credential } = verification.registrationInfo;
  return {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports,
    createdAt: Date.now(),
  };
}

export async function passkeyAuthenticationOptions(record: AuthRecord): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = requireWebauthnConfig();
  if (!record.passkeys || record.passkeys.length === 0) {
    throw new HttpError(409, 'No passkeys enrolled.');
  }
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: record.passkeys.map((p) => ({ id: p.id, transports: transports(p) })),
    // Discouraged, not preferred/required — the password step already verified identity; this
    // ceremony asserts possession of the enrolled authenticator as the second factor, matching
    // the library's own documented guidance for exactly this 2FA shape.
    userVerification: 'discouraged',
  });
  setPendingChallenge(record.username, options.challenge);
  return options;
}

export async function verifyPasskeyAuthentication(record: AuthRecord, response: AuthenticationResponseJSON): Promise<{ credentialId: string; newCounter: number }> {
  const { rpID, origin } = requireWebauthnConfig();
  const expectedChallenge = takePendingChallenge(record.username);
  const stored = (record.passkeys ?? []).find((p) => p.id === response.id);
  if (!stored) {
    throw new HttpError(401, 'Unrecognized passkey.');
  }
  const credential = { id: stored.id, publicKey: Buffer.from(stored.publicKey, 'base64url'), counter: stored.counter, transports: transports(stored) };
  const verification = await verifyAuthenticationResponse({ response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, credential });
  if (!verification.verified) {
    throw new HttpError(401, 'Passkey authentication could not be verified.');
  }
  return { credentialId: stored.id, newCounter: verification.authenticationInfo.newCounter };
}
