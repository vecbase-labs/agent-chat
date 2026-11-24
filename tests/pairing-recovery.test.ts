import { randomBytes } from 'node:crypto'
import { expect, test } from 'vitest'
import { sealCredential, openCredential } from '../src/server/pairing-recovery'

test('recovery ciphertext rejects another secret, grant or tampered payload', () => {
  const secret = randomBytes(32).toString('base64url')
  const token = randomBytes(32).toString('base64url')
  const bound = 'https://chat.example.com:enrollment:actor'
  const ciphertext = sealCredential(token, secret, bound)
  expect(openCredential(ciphertext, secret, bound)).toBe(token)
  expect(() =>
    openCredential(ciphertext, randomBytes(32).toString('base64url'), bound),
  ).toThrow()
  expect(() => openCredential(ciphertext, secret, bound + '-other')).toThrow()
  const damaged = Buffer.from(ciphertext, 'base64url')
  damaged[damaged.length - 1] ^= 1
  expect(() =>
    openCredential(damaged.toString('base64url'), secret, bound),
  ).toThrow()
  expect(sealCredential(token, secret, bound)).not.toBe(ciphertext)
})
