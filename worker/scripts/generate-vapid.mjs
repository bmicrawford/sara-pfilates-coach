/**
 * Print a new VAPID key pair to stdout. Do not commit the output.
 *
 *   node worker/scripts/generate-vapid.mjs
 *
 * Then, from worker/:
 *   printf '%s' "$VAPID_PUBLIC_KEY" | npx wrangler secret put VAPID_PUBLIC_KEY
 *   printf '%s' "$VAPID_PRIVATE_KEY" | npx wrangler secret put VAPID_PRIVATE_KEY
 *   printf '%s' "$VAPID_SUBJECT" | npx wrangler secret put VAPID_SUBJECT
 *
 * VAPID_SUBJECT is a mailto: address or an https URL. It is not a person's inbox password.
 */

import { bytesToBase64Url } from '../../server/webPush.mjs'

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const rawPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)

console.log(`VAPID_PUBLIC_KEY=${bytesToBase64Url(rawPublic)}`)
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`)
console.log('VAPID_SUBJECT=mailto:ops@example.com')
console.log('Do not commit these values. Put them on the Worker with wrangler secret put.')
