import { describe, it, expect, vi } from 'vitest'
import {
  beginDeviceAuth,
  pollForToken,
  fetchGithubLogin,
  GITHUB_DEVICE_CLIENT_ID
} from './githubAuth'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

// A delay that records the requested ms but never actually waits.
function recordingDelay(): { fn: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = []
  return { fn: (ms) => (calls.push(ms), Promise.resolve()), calls }
}

describe('GITHUB_DEVICE_CLIENT_ID', () => {
  it('defaults to the AxiBridge OAuth app client id', () => {
    expect(GITHUB_DEVICE_CLIENT_ID).toBe('Ov23liFh1ih9LAcnLACw')
  })
})

describe('beginDeviceAuth', () => {
  it('POSTs device/code with client_id + scope and returns parsed fields', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        device_code: 'DEV',
        user_code: 'WXYZ-1234',
        verification_uri: 'https://github.com/login/device',
        interval: 7,
        expires_in: 600
      })
    )
    const begin = await beginDeviceAuth('CID', fetchFn as unknown as typeof fetch)
    expect(begin).toEqual({
      deviceCode: 'DEV',
      userCode: 'WXYZ-1234',
      verificationUri: 'https://github.com/login/device',
      interval: 7,
      expiresIn: 600
    })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://github.com/login/device/code')
    const body = (init.body as URLSearchParams)
    expect(body.get('client_id')).toBe('CID')
    expect(body.get('scope')).toBe('repo read:user')
  })

  it('defaults interval/expiresIn when GitHub omits them', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ device_code: 'D', user_code: 'U', verification_uri: 'https://x' })
    )
    const begin = await beginDeviceAuth('CID', fetchFn as unknown as typeof fetch)
    expect(begin.interval).toBe(5)
    expect(begin.expiresIn).toBe(900)
  })

  it('throws when the device code is missing', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error_description: 'nope' }))
    await expect(beginDeviceAuth('CID', fetchFn as unknown as typeof fetch)).rejects.toThrow('nope')
  })

  it('throws on a non-ok response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 500))
    await expect(beginDeviceAuth('CID', fetchFn as unknown as typeof fetch)).rejects.toThrow('500')
  })
})

describe('pollForToken', () => {
  it('resolves with the access token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'gho_TOKEN' }))
    const delay = recordingDelay()
    const token = await pollForToken('CID', 'DEV', {
      intervalSeconds: 5,
      expiresInSeconds: 900,
      fetchFn: fetchFn as unknown as typeof fetch,
      delayFn: delay.fn
    })
    expect(token).toBe('gho_TOKEN')
    const body = fetchFn.mock.calls[0][1].body as URLSearchParams
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code')
    expect(body.get('device_code')).toBe('DEV')
  })

  it('retries on authorization_pending until the token arrives', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_OK' }))
    const delay = recordingDelay()
    const token = await pollForToken('CID', 'DEV', {
      intervalSeconds: 5,
      expiresInSeconds: 900,
      fetchFn: fetchFn as unknown as typeof fetch,
      delayFn: delay.fn
    })
    expect(token).toBe('gho_OK')
    expect(fetchFn).toHaveBeenCalledTimes(3)
    // interval held steady at 5000ms across pending retries
    expect(delay.calls).toEqual([5000, 5000, 5000])
  })

  it('increases the interval by 5s on slow_down', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'slow_down' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_SLOW' }))
    const delay = recordingDelay()
    const token = await pollForToken('CID', 'DEV', {
      intervalSeconds: 5,
      expiresInSeconds: 900,
      fetchFn: fetchFn as unknown as typeof fetch,
      delayFn: delay.fn
    })
    expect(token).toBe('gho_SLOW')
    expect(delay.calls).toEqual([5000, 10000])
  })

  it('throws a friendly error on expired_token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'expired_token' }))
    const delay = recordingDelay()
    await expect(
      pollForToken('CID', 'DEV', {
        intervalSeconds: 5,
        expiresInSeconds: 900,
        fetchFn: fetchFn as unknown as typeof fetch,
        delayFn: delay.fn
      })
    ).rejects.toThrow(/expired/i)
  })

  it('throws on timeout when expiry has passed', async () => {
    const fetchFn = vi.fn()
    const delay = recordingDelay()
    await expect(
      pollForToken('CID', 'DEV', {
        intervalSeconds: 5,
        expiresInSeconds: 0,
        fetchFn: fetchFn as unknown as typeof fetch,
        delayFn: delay.fn
      })
    ).rejects.toThrow(/timed out/i)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('fetchGithubLogin', () => {
  it('returns the login from /user', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ login: 'darkharasho' }))
    const login = await fetchGithubLogin('TOKEN', fetchFn as unknown as typeof fetch)
    expect(login).toBe('darkharasho')
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://api.github.com/user')
    expect(init.headers.Authorization).toBe('Bearer TOKEN')
  })

  it('falls back to "github" on a non-ok response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 401))
    expect(await fetchGithubLogin('TOKEN', fetchFn as unknown as typeof fetch)).toBe('github')
  })

  it('falls back to "github" when fetch throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network'))
    expect(await fetchGithubLogin('TOKEN', fetchFn as unknown as typeof fetch)).toBe('github')
  })
})
