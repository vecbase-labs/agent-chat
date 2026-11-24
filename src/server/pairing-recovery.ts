import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto'

// The client holds this random secret. Neither the recovery key nor plaintext
// credential is stored in the database; each ciphertext is bound to its grant.
function key(secret: string) {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'base64url'),
      'agent-chat',
      'pairing-recovery-v1',
      32,
    ),
  )
}
export function sealCredential(token: string, secret: string, binding: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  cipher.setAAD(Buffer.from(binding))
  const ciphertext = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    'base64url',
  )
}
export function openCredential(
  sealed: string,
  secret: string,
  binding: string,
) {
  const bytes = Buffer.from(sealed, 'base64url')
  const cipher = createDecipheriv(
    'aes-256-gcm',
    key(secret),
    bytes.subarray(0, 12),
  )
  cipher.setAuthTag(bytes.subarray(12, 28))
  cipher.setAAD(Buffer.from(binding))
  return Buffer.concat([
    cipher.update(bytes.subarray(28)),
    cipher.final(),
  ]).toString('utf8')
}
