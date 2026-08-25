import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/browser';
import { request } from './request';
import type {
  AuthStatusResponse,
  BackupCodesResponse,
  LoginResponse,
  TotpEnrollResponse,
  TwoFactorStatus,
} from '../types/authApi';

export const authApi = {
  status: () => request<AuthStatusResponse>('/api/auth/status'),
  setup: (username: string, password: string) =>
    request<AuthStatusResponse>('/api/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<AuthStatusResponse>('/api/auth/logout', { method: 'POST' }),
  // currentPassword and (if the account has TOTP enrolled) totpCode required - step-up gated
  // server-side the same way SSH-key-add is (see auth/service.ts's changePassword).
  changePassword: (currentPassword: string, newPassword: string, totpCode?: string) =>
    request<AuthStatusResponse>('/api/auth/password', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword, totpCode }),
    }),
  verifyTotp: (code: string) =>
    request<AuthStatusResponse>('/api/auth/2fa/totp/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    }),
  twoFactorStatus: () => request<TwoFactorStatus>('/api/auth/2fa/status'),
  totpEnroll: () => request<TotpEnrollResponse>('/api/auth/2fa/totp/enroll', { method: 'POST' }),
  totpConfirm: (code: string) =>
    request<BackupCodesResponse>('/api/auth/2fa/totp/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    }),
  totpDisable: (currentPassword: string) =>
    request<{ ok: true }>('/api/auth/2fa/totp/disable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword }),
    }),
  regenerateBackupCodes: (currentPassword: string) =>
    request<BackupCodesResponse>('/api/auth/2fa/backup-codes/regenerate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword }),
    }),
  passkeyAuthOptions: () => request<PublicKeyCredentialRequestOptionsJSON>('/api/auth/2fa/passkey/auth-options', { method: 'POST' }),
  passkeyAuthVerify: (response: AuthenticationResponseJSON) =>
    request<AuthStatusResponse>('/api/auth/2fa/passkey/auth-verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response }),
    }),
  passkeyRegisterOptions: () => request<PublicKeyCredentialCreationOptionsJSON>('/api/auth/2fa/passkey/register-options', { method: 'POST' }),
  passkeyRegisterVerify: (response: RegistrationResponseJSON, name: string) =>
    request<{ ok: true }>('/api/auth/2fa/passkey/register-verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response, name }),
    }),
  removePasskey: (id: string) => request<{ ok: true }>(`/api/auth/2fa/passkey/${id}`, { method: 'DELETE' }),
};
