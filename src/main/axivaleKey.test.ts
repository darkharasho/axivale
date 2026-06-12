import { describe, it, expect } from 'vitest'
import { parseAxivaleKey } from './axivaleKey'

function b64url(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64url')
}

describe('parseAxivaleKey', () => {
  it('decodes the base URL and keeps the full key as the bearer token', () => {
    const key = `axt1.${b64url('http://127.0.0.1:8642')}.abc-DEF_123`
    expect(parseAxivaleKey(key)).toEqual({ baseUrl: 'http://127.0.0.1:8642', token: key })
  })

  it('trims surrounding whitespace', () => {
    const key = `axt1.${b64url('https://bot.example.com')}.secret`
    const parsed = parseAxivaleKey(`  ${key}\n`)
    expect(parsed).toEqual({ baseUrl: 'https://bot.example.com', token: key })
  })

  it('strips a trailing slash from the decoded URL', () => {
    const key = `axt1.${b64url('https://bot.example.com/')}.secret`
    expect(parseAxivaleKey(key)?.baseUrl).toBe('https://bot.example.com')
  })

  it('rejects keys without the axt1 prefix', () => {
    expect(parseAxivaleKey(`axt2.${b64url('http://x')}.s`)).toBeNull()
    expect(parseAxivaleKey('just-a-token')).toBeNull()
    expect(parseAxivaleKey('')).toBeNull()
  })

  it('rejects keys whose URL part is not a valid http(s) URL', () => {
    expect(parseAxivaleKey(`axt1.${b64url('not a url')}.s`)).toBeNull()
    expect(parseAxivaleKey(`axt1.${b64url('ftp://x')}.s`)).toBeNull()
    expect(parseAxivaleKey('axt1.!!!.s')).toBeNull()
  })

  it('rejects keys missing the secret part', () => {
    expect(parseAxivaleKey(`axt1.${b64url('http://x')}`)).toBeNull()
    expect(parseAxivaleKey(`axt1.${b64url('http://x')}.`)).toBeNull()
  })
})
