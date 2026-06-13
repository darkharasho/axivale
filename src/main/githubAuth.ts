// GitHub OAuth device flow — "Sign in with GitHub".
//
// These are pure async functions: fetch and delay are injectable so they can be
// unit-tested with no real network and no real timers. The IPC layer (index.ts)
// is responsible for opening the verification URI in the browser; keeping
// shell.openExternal out of here keeps the flow testable.
//
// Mirrors AxiBridge's device flow (axibridge/src/main/handlers/githubHandlers.ts):
// POST github.com/login/device/code, then poll github.com/login/oauth/access_token
// with grant_type urn:ietf:params:oauth:grant-type:device_code, handling
// authorization_pending / slow_down / expired_token.

const GITHUB_HOST = 'https://github.com'
const GITHUB_API = 'https://api.github.com'
const UA = 'AxiVale'
// Public+private report repos need `repo`; `read:user` resolves the login label.
const SCOPE = 'repo read:user'

export const GITHUB_DEVICE_CLIENT_ID = process.env.GITHUB_DEVICE_CLIENT_ID || 'Ov23liFh1ih9LAcnLACw'

export type FetchFn = typeof fetch
export type DelayFn = (ms: number) => Promise<void>

const realDelay: DelayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export interface DeviceAuthBegin {
  deviceCode: string
  userCode: string
  verificationUri: string
  interval: number
  expiresIn: number
}

/**
 * Request a device + user code from GitHub. Returns the codes plus the polling
 * interval and expiry. Does NOT open the browser — the caller does that with
 * the returned verificationUri.
 */
export async function beginDeviceAuth(
  clientId: string,
  fetchFn: FetchFn = fetch
): Promise<DeviceAuthBegin> {
  if (!clientId) throw new Error('Missing GitHub device client ID.')

  const body = new URLSearchParams({ client_id: clientId, scope: SCOPE })
  const res = await fetchFn(`${GITHUB_HOST}/login/device/code`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA
    },
    body
  })

  if (!res.ok) throw new Error(`Failed to request device code (${res.status}).`)

  const data = (await res.json()) as {
    device_code?: string
    user_code?: string
    verification_uri?: string
    interval?: number
    expires_in?: number
    error_description?: string
  }
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error(data.error_description || 'GitHub did not return a device code.')
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval ?? 5,
    expiresIn: data.expires_in ?? 900
  }
}

/**
 * Poll GitHub until the user authorizes (returns the access token) or the flow
 * expires/times out (throws a friendly error). Retries on authorization_pending,
 * backs off +5s on slow_down.
 */
export async function pollForToken(
  clientId: string,
  deviceCode: string,
  {
    intervalSeconds,
    expiresInSeconds,
    fetchFn = fetch,
    delayFn = realDelay
  }: {
    intervalSeconds: number
    expiresInSeconds: number
    fetchFn?: FetchFn
    delayFn?: DelayFn
  }
): Promise<string> {
  if (!clientId) throw new Error('Missing GitHub device client ID.')
  if (!deviceCode) throw new Error('Missing GitHub device code.')

  const deadline = Date.now() + Math.max(0, expiresInSeconds) * 1000
  let intervalMs = Math.max(1, intervalSeconds) * 1000

  while (Date.now() < deadline) {
    await delayFn(intervalMs)

    const body = new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
    const res = await fetchFn(`${GITHUB_HOST}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA
      },
      body
    })

    if (!res.ok) throw new Error(`Failed to poll for token (${res.status}).`)

    const data = (await res.json()) as {
      access_token?: string
      error?: string
      error_description?: string
    }
    if (data.access_token) return data.access_token

    if (data.error === 'authorization_pending') continue
    if (data.error === 'slow_down') {
      intervalMs += 5000
      continue
    }
    if (data.error === 'expired_token') {
      throw new Error('GitHub login expired before you authorized. Try again.')
    }
    throw new Error(data.error_description || data.error || 'GitHub OAuth failed.')
  }

  throw new Error('GitHub login timed out.')
}

/**
 * Resolve the authenticated user's login (used as the keyring label). Falls back
 * to 'github' on any error so sign-in still completes with a usable label.
 */
export async function fetchGithubLogin(token: string, fetchFn: FetchFn = fetch): Promise<string> {
  try {
    const res = await fetchFn(`${GITHUB_API}/user`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': UA
      }
    })
    if (!res.ok) return 'github'
    const data = (await res.json()) as { login?: string }
    return data.login || 'github'
  } catch {
    return 'github'
  }
}
