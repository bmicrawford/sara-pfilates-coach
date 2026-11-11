/**
 * Web Push (VAPID + aes128gcm) using WebCrypto.
 * Shared by the Node API and the Cloudflare Worker. No secrets in this file.
 */

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function bytesToBase64Url(bytes) {
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlToBytes(value) {
  const raw = String(value ?? '').trim()
  if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return null
  const padded = raw.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (raw.length % 4)) % 4)
  let bin
  try {
    bin = atob(padded)
  } catch {
    return null
  }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

async function hmacSha256(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data))
}

async function hkdfExtract(salt, ikm) {
  return hmacSha256(salt, ikm)
}

async function hkdfExpand(prk, info, length) {
  const block = await hmacSha256(prk, concat(info, new Uint8Array([1])))
  return block.slice(0, length)
}

async function ecdhX(privateKey, publicRaw) {
  const publicKey = await crypto.subtle.importKey(
    'raw',
    publicRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  return new Uint8Array(bits)
}

function uint32be(value) {
  const out = new Uint8Array(4)
  out[0] = (value >>> 24) & 0xff
  out[1] = (value >>> 16) & 0xff
  out[2] = (value >>> 8) & 0xff
  out[3] = value & 0xff
  return out
}

/**
 * RFC 8291 / RFC 8188 single-record body.
 * `userPublicKey` and `userAuth` are the browser subscription keys (base64url).
 */
export async function encryptWebPush({ userPublicKey, userAuth, payload }) {
  const uaPublic = base64UrlToBytes(userPublicKey)
  const authSecret = base64UrlToBytes(userAuth)
  if (!uaPublic || uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('invalid_p256dh')
  if (!authSecret || authSecret.length < 16) throw new Error('invalid_auth')
  const plain = typeof payload === 'string' ? textEncoder.encode(payload) : payload

  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const ecdhSecret = await ecdhX(local.privateKey, uaPublic)
  const keyInfo = concat(textEncoder.encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic)
  const ikm = await hkdfExpand(await hkdfExtract(authSecret, ecdhSecret), keyInfo, 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const prk = await hkdfExtract(salt, ikm)
  const cek = await hkdfExpand(prk, textEncoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdfExpand(prk, textEncoder.encode('Content-Encoding: nonce\0'), 12)
  const padded = concat(plain, new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded),
  )
  const rs = 4096
  const body = concat(salt, uint32be(rs), new Uint8Array([asPublic.length]), asPublic, cipher)
  return body
}

/** Decrypt with the subscription ECDH private key. Used by the smoke test. */
export async function decryptWebPushRecord({ body, userPrivateKey, userPublicKey, userAuth }) {
  const authSecret = base64UrlToBytes(userAuth)
  const uaPublic = base64UrlToBytes(userPublicKey)
  if (!authSecret || !uaPublic || body.length < 22) throw new Error('invalid_record')
  const salt = body.slice(0, 16)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const cipher = body.slice(21 + idlen)
  if (asPublic.length !== 65) throw new Error('invalid_keyid')
  const ecdhSecret = await ecdhX(userPrivateKey, asPublic)
  const keyInfo = concat(textEncoder.encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic)
  const ikm = await hkdfExpand(await hkdfExtract(authSecret, ecdhSecret), keyInfo, 32)
  const prk = await hkdfExtract(salt, ikm)
  const cek = await hkdfExpand(prk, textEncoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdfExpand(prk, textEncoder.encode('Content-Encoding: nonce\0'), 12)
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, cipher),
  )
  let end = padded.length
  while (end > 0 && padded[end - 1] === 0) end -= 1
  if (end === 0 || padded[end - 1] !== 2) throw new Error('bad_padding')
  return textDecoder.decode(padded.slice(0, end - 1))
}

export async function importVapidSigningKey(publicKey, privateKey) {
  const raw = base64UrlToBytes(publicKey)
  if (!raw || raw.length !== 65 || raw[0] !== 4) throw new Error('invalid_vapid_public')
  const d = String(privateKey ?? '').trim()
  if (!d || !/^[A-Za-z0-9_-]+$/.test(d)) throw new Error('invalid_vapid_private')
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToBase64Url(raw.slice(1, 33)),
      y: bytesToBase64Url(raw.slice(33, 65)),
      d,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

export async function vapidAuthorization({ endpoint, publicKey, privateKey, subject, nowSec = Math.floor(Date.now() / 1000) }) {
  const origin = new URL(endpoint).origin
  const header = bytesToBase64Url(textEncoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = bytesToBase64Url(
    textEncoder.encode(JSON.stringify({ aud: origin, exp: nowSec + 12 * 60 * 60, sub: subject })),
  )
  const unsigned = `${header}.${claims}`
  const key = await importVapidSigningKey(publicKey, privateKey)
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, textEncoder.encode(unsigned)),
  )
  return {
    jwt: `${unsigned}.${bytesToBase64Url(sig)}`,
    origin,
    authorization: `vapid t=${unsigned}.${bytesToBase64Url(sig)}, k=${publicKey}`,
  }
}

export async function sendWebPush({
  endpoint,
  p256dh,
  auth,
  payload,
  vapid,
  ttl = 3600,
  fetchFn = fetch,
}) {
  const body = await encryptWebPush({ userPublicKey: p256dh, userAuth: auth, payload })
  const signed = await vapidAuthorization({
    endpoint,
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
    subject: vapid.subject,
  })
  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers: {
      TTL: String(ttl),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: signed.authorization,
    },
    body,
  })
  const gone = res.status === 404 || res.status === 410
  return { ok: res.status >= 200 && res.status < 300, status: res.status, gone }
}
