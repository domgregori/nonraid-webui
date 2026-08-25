import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { AuthStore } from './store.js';
import {
  serializeClearCookie,
  serializeSessionCookie,
  serializeTwoFactorPendingCookie,
  parseCookies,
  COOKIE_NAME,
  TWO_FACTOR_PENDING_COOKIE_NAME,
} from './cookies.js';
import { hashPassword, verifyPassword, signSession, verifySession, signTwoFactorPending, verifyTwoFactorPending, hashSecret, generateBackupCode } from './crypto.js';
import type { RequestOrigin } from './requestOrigin.js';
import { generateTotpSecret, totpProvisioningUri, totpQrDataUri, verifyTotpCode } from './totp.js';
import type { AuthRecord, AuthStatus, TotpBackupCode, TwoFactorMethod } from './types.js';
import { passkeyAuthenticationOptions, passkeyRegistrationOptions, verifyPasskeyAuthentication, verifyPasskeyRegistration } from './webauthn.js';

const BACKUP_CODE_COUNT = 10;

export interface AuthResult {
  cookie: string;
  body: AuthStatus;
}

export interface TwoFactorRequiredResult {
  cookie: string;
  body: AuthStatus & { twoFactorRequired: true; twoFactorMethods: TwoFactorMethod[] };
}

export interface TotpEnrollResult {
  secret: string;
  otpauthUri: string;
  qrDataUri: string;
}

export interface BackupCodesResult {
  backupCodes: string[];
}

export interface TwoFactorStatusResult {
  totpEnabled: boolean;
  backupCodesRemaining: number;
  passkeys: { id: string; name: string; createdAt: number }[];
}

export class AuthService {
  constructor(private store: AuthStore) {}

  async isConfigured(): Promise<boolean> {
    return (await this.store.get()) !== null;
  }

  async isAuthenticated(cookieHeader: string | undefined): Promise<boolean> {
    const record = await this.store.get();
    if (!record) return false;
    const cookies = parseCookies(cookieHeader);
    return verifySession(record.sessionSecret, cookies[COOKIE_NAME]) !== null;
  }

  async status(cookieHeader: string | undefined): Promise<AuthStatus> {
    const record = await this.store.get();
    if (!record) return { configured: false, authenticated: false };
    const cookies = parseCookies(cookieHeader);
    const authenticated = verifySession(record.sessionSecret, cookies[COOKIE_NAME]) !== null;
    return { configured: true, authenticated };
  }

  async setup(username: string, password: string, origin: RequestOrigin): Promise<AuthResult> {
    const passwordHash = await hashPassword(password);
    const record = await this.store.create(username, passwordHash);
    return this.issueSession(record.sessionSecret, origin);
  }

  async login(username: string, password: string, origin: RequestOrigin): Promise<AuthResult | TwoFactorRequiredResult> {
    const record = await this.store.get();
    if (!record) {
      throw new HttpError(409, 'No admin account is configured yet.');
    }
    // Constant-shape check regardless of which field is wrong - a bad guess
    // fails as a generic 401, never distinguishing "no such user" from
    // "wrong password" (this is a single-account system, so username
    // mismatches are effectively part of the same guess).
    const ok = username === record.username && (await verifyPassword(password, record.passwordHash));
    if (!ok) {
      throw new HttpError(401, 'Invalid username or password.');
    }
    const methods = this.enrolledMethods(record);
    if (methods.length === 0) {
      return this.issueSession(record.sessionSecret, origin);
    }
    const token = signTwoFactorPending(record.sessionSecret, config.twoFactorPendingTtlMs);
    const cookie = serializeTwoFactorPendingCookie(token, Math.floor(config.twoFactorPendingTtlMs / 1000), origin);
    return { cookie, body: { configured: true, authenticated: false, twoFactorRequired: true, twoFactorMethods: methods } };
  }

  logout(origin: RequestOrigin): { cookie: string } {
    return { cookie: serializeClearCookie(origin) };
  }

  // Step-up gated the same way SSH-key-add is (see verifyStepUp/verifyPasswordAndTotp below) -
  // changing the password is itself a way to lock out every other session, sensitive enough to
  // want the second factor re-checked too when one's enrolled, not just the password being
  // changed.
  async changePassword(
    cookieHeader: string | undefined,
    currentPassword: string,
    newPassword: string,
    totpCode: string | undefined,
    origin: RequestOrigin,
  ): Promise<AuthResult> {
    const record = await this.requireSession(cookieHeader);
    await this.verifyPasswordAndTotp(record, currentPassword, totpCode);
    const newHash = await hashPassword(newPassword);
    await this.store.updatePassword(newHash);
    // updatePassword regenerates the session secret, which already invalidates every existing
    // session cookie including this very request's - clear it and report logged-out rather than
    // issuing a fresh one for this session, so a password change always means "log out
    // everywhere, no exceptions" and the admin has to log back in with the new password to prove
    // it actually works.
    return { cookie: serializeClearCookie(origin), body: { configured: true, authenticated: false } };
  }

  // --- Two-factor: TOTP ---

  async enrollTotp(cookieHeader: string | undefined): Promise<TotpEnrollResult> {
    const record = await this.requireSession(cookieHeader);
    const secret = generateTotpSecret();
    await this.store.setPendingTotp(secret);
    const otpauthUri = totpProvisioningUri(record.username, secret);
    const qrDataUri = await totpQrDataUri(otpauthUri);
    return { secret, otpauthUri, qrDataUri };
  }

  async confirmTotp(cookieHeader: string | undefined, code: string): Promise<BackupCodesResult> {
    const record = await this.requireSession(cookieHeader);
    if (!record.pendingTotp) {
      throw new HttpError(409, 'No pending two-factor enrollment - start enrollment again.');
    }
    if (!(await verifyTotpCode(record.pendingTotp.secret, code))) {
      throw new HttpError(401, 'Incorrect code - check your authenticator app and try again.');
    }
    const backupCodes = await this.generateHashedBackupCodes();
    await this.store.confirmTotp(backupCodes.hashed);
    return { backupCodes: backupCodes.plain };
  }

  async disableTotp(cookieHeader: string | undefined, currentPassword: string): Promise<void> {
    const record = await this.requireSession(cookieHeader);
    if (!(await verifyPassword(currentPassword, record.passwordHash))) {
      throw new HttpError(401, 'Current password is incorrect.');
    }
    await this.store.disableTotp();
  }

  async regenerateBackupCodes(cookieHeader: string | undefined, currentPassword: string): Promise<BackupCodesResult> {
    const record = await this.requireSession(cookieHeader);
    if (!record.totp) {
      throw new HttpError(409, 'Two-factor authentication is not enabled.');
    }
    if (!(await verifyPassword(currentPassword, record.passwordHash))) {
      throw new HttpError(401, 'Current password is incorrect.');
    }
    const backupCodes = await this.generateHashedBackupCodes();
    await this.store.regenerateBackupCodes(backupCodes.hashed);
    return { backupCodes: backupCodes.plain };
  }

  async twoFactorStatus(cookieHeader: string | undefined): Promise<TwoFactorStatusResult> {
    const record = await this.requireSession(cookieHeader);
    return {
      totpEnabled: !!record.totp,
      backupCodesRemaining: record.totp?.backupCodes.filter((c) => c.usedAt === null).length ?? 0,
      passkeys: (record.passkeys ?? []).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt })),
    };
  }

  // Pending-cookie gated - runs before a real session exists. Verifies the second factor and, on
  // success, issues the real session via the exact same path password-only login already uses, so
  // nothing downstream of this needs to know 2FA exists at all.
  async verifyTwoFactor(cookieHeader: string | undefined, code: string, origin: RequestOrigin): Promise<AuthResult> {
    const record = await this.requirePendingTwoFactor(cookieHeader);
    const totpOk = record.totp ? await verifyTotpCode(record.totp.secret, code) : false;
    const backupOk = totpOk ? false : await this.store.consumeBackupCodeIfValid(code);
    if (!totpOk && !backupOk) {
      throw new HttpError(401, 'Incorrect code.');
    }
    return this.issueSession(record.sessionSecret, origin);
  }

  /**
   * Password + TOTP-if-enrolled re-verification for an already-logged-in session, for an action
   * sensitive enough to want more than "has a valid session cookie" - e.g. adding an SSH
   * authorized_keys entry (grants full root shell access), or changing the password itself (see
   * changePassword above). Both call the shared verifyPasswordAndTotp helper below; this method
   * is the standalone form for actions (like SSH-key-add) that don't otherwise need requireSession
   * themselves - see requireStepUp in middleware.ts for the route-level gate built on top of it.
   */
  async verifyStepUp(cookieHeader: string | undefined, currentPassword: string, totpCode: string | undefined): Promise<void> {
    const record = await this.requireSession(cookieHeader);
    await this.verifyPasswordAndTotp(record, currentPassword, totpCode);
  }

  // Passkey-only accounts (TOTP not enrolled) only get the password check here: there's no
  // form-field equivalent of a WebAuthn ceremony to run from a plain step-up form, and
  // disableTotp/regenerateBackupCodes above already establish "password re-entry" as this
  // codebase's baseline for step-up regardless of which 2FA method is in use.
  private async verifyPasswordAndTotp(record: AuthRecord, currentPassword: string, totpCode: string | undefined): Promise<void> {
    if (!(await verifyPassword(currentPassword, record.passwordHash))) {
      throw new HttpError(401, 'Current password is incorrect.');
    }
    if (record.totp) {
      if (!totpCode) throw new HttpError(401, 'Two-factor code is required.');
      const totpOk = await verifyTotpCode(record.totp.secret, totpCode);
      const backupOk = totpOk ? false : await this.store.consumeBackupCodeIfValid(totpCode);
      if (!totpOk && !backupOk) throw new HttpError(401, 'Incorrect code.');
    }
  }

  // --- Two-factor: passkeys ---

  async passkeyRegisterOptions(cookieHeader: string | undefined, origin: RequestOrigin): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const record = await this.requireSession(cookieHeader);
    return passkeyRegistrationOptions(record, origin);
  }

  async passkeyRegisterVerify(cookieHeader: string | undefined, response: RegistrationResponseJSON, name: string, origin: RequestOrigin): Promise<void> {
    const record = await this.requireSession(cookieHeader);
    const credential = await verifyPasskeyRegistration(record, response, origin);
    await this.store.addPasskey({ ...credential, name });
  }

  async passkeyAuthOptions(cookieHeader: string | undefined, origin: RequestOrigin): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const record = await this.requirePendingTwoFactor(cookieHeader);
    return passkeyAuthenticationOptions(record, origin);
  }

  // Pending-cookie gated, mirrors verifyTwoFactor above - issues the real session on success via
  // the same path every other login method uses.
  async passkeyAuthVerify(cookieHeader: string | undefined, response: AuthenticationResponseJSON, origin: RequestOrigin): Promise<AuthResult> {
    const record = await this.requirePendingTwoFactor(cookieHeader);
    const { credentialId, newCounter } = await verifyPasskeyAuthentication(record, response, origin);
    await this.store.updatePasskeyCounter(credentialId, newCounter);
    return this.issueSession(record.sessionSecret, origin);
  }

  async removePasskey(cookieHeader: string | undefined, id: string): Promise<void> {
    await this.requireSession(cookieHeader);
    await this.store.removePasskey(id);
  }

  // Re-verifies the current session and issues a fresh cookie for it - used when something about
  // cookie *policy* changes mid-session (currently: disabling TLS, which must flip cookieSecure to
  // false so the browser doesn't carry a now-unusable Secure cookie into the plain-HTTP page it's
  // about to be redirected to). Deliberately re-verifies rather than trusting the caller already
  // ran requireAuth, matching every other mutator here.
  async reissueSession(cookieHeader: string | undefined, origin: RequestOrigin): Promise<AuthResult> {
    const record = await this.requireSession(cookieHeader);
    return this.issueSession(record.sessionSecret, origin);
  }

  private enrolledMethods(record: AuthRecord): TwoFactorMethod[] {
    const methods: TwoFactorMethod[] = [];
    if (record.totp) methods.push('totp');
    if (record.passkeys && record.passkeys.length > 0) methods.push('passkey');
    return methods;
  }

  private async generateHashedBackupCodes(): Promise<{ plain: string[]; hashed: TotpBackupCode[] }> {
    const plain = Array.from({ length: BACKUP_CODE_COUNT }, () => generateBackupCode());
    const hashed: TotpBackupCode[] = await Promise.all(plain.map(async (plainCode) => ({ hash: await hashSecret(plainCode), usedAt: null })));
    return { plain, hashed };
  }

  private async requireSession(cookieHeader: string | undefined): Promise<AuthRecord> {
    const record = await this.store.get();
    if (!record) throw new HttpError(409, 'No admin account is configured yet.');
    const cookies = parseCookies(cookieHeader);
    if (verifySession(record.sessionSecret, cookies[COOKIE_NAME]) === null) {
      throw new HttpError(401, 'Unauthorized');
    }
    return record;
  }

  private async requirePendingTwoFactor(cookieHeader: string | undefined): Promise<AuthRecord> {
    const record = await this.store.get();
    if (!record) throw new HttpError(409, 'No admin account is configured yet.');
    const cookies = parseCookies(cookieHeader);
    if (verifyTwoFactorPending(record.sessionSecret, cookies[TWO_FACTOR_PENDING_COOKIE_NAME]) === null) {
      throw new HttpError(401, 'Unauthorized');
    }
    return record;
  }

  private issueSession(secret: string, origin: RequestOrigin): AuthResult {
    const token = signSession(secret, config.sessionTtlMs);
    const cookie = serializeSessionCookie(token, Math.floor(config.sessionTtlMs / 1000), origin);
    return { cookie, body: { configured: true, authenticated: true } };
  }
}
