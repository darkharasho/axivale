// src/main/shareId.ts
import { randomBytes } from 'crypto'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Unguessable URL-safe slug for a public share (base62, crypto RNG). */
export function makeShareId(len = 20): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}
