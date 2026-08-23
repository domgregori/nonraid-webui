import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { request, type FullConfig } from '@playwright/test'
import {
  DEFAULT_PASSWORD,
  expectNoTwoFactorRequired,
  hasSessionCookie,
  loginViaApi,
  SESSION_COOKIE_NAME,
} from './helpers'

const STORAGE_STATE_PATH = './e2e/.auth/state.json'
const DEFAULT_BASE_URL = 'http://nonraid.lan:3001'

export default async function globalSetup(config: FullConfig) {
  // The global `use` block is merged into every resolved project; read it from the first one.
  const configuredBaseURL = config.projects[0]?.use.baseURL
  const baseURL = (process.env.E2E_BASE_URL ?? configuredBaseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')

  // 1. The rig must be reachable before anything else - fail fast with a clear message.
  const probe = await request.newContext({ baseURL })
  try {
    let health
    try {
      health = await probe.get('/api/health', { timeout: 10_000 })
    } catch (err) {
      throw new Error(`Rig unreachable at ${baseURL}: ${(err as Error).message}`)
    }
    if (!health.ok()) {
      throw new Error(
        `Rig unreachable: GET ${baseURL}/api/health returned ${health.status()}. ` +
          'Start the backend or point E2E_BASE_URL at the rig.',
      )
    }
  } finally {
    await probe.dispose()
  }

  // 2. Log in via the API and persist the session cookie to the shared storageState.
  const username = process.env.E2E_USERNAME
  if (!username) {
    throw new Error('E2E_USERNAME is not set - the rig login username is required.')
  }
  const password = process.env.E2E_PASSWORD ?? DEFAULT_PASSWORD

  const { context, body, setCookie } = await loginViaApi({ baseURL, username, password })
  try {
    expectNoTwoFactorRequired(body)
    if (!hasSessionCookie(setCookie)) {
      throw new Error(
        `Login succeeded but no ${SESSION_COOKIE_NAME} cookie was issued (Set-Cookie: "${setCookie}") - ` +
          'the rig likely requires a second factor. The E2E harness does not solve 2FA.',
      )
    }
    mkdirSync(dirname(STORAGE_STATE_PATH), { recursive: true })
    await context.storageState({ path: STORAGE_STATE_PATH })
  } finally {
    await context.dispose()
  }
}
