// ─────────────────────────────────────────────────────────────
// iframe.io — message authentication
//
// These craft raw messages and deliver them straight into a peer's window,
// which is the attacker's position: same origin, arbitrary payload. Going
// through emitSigned() would only ever produce well-formed input.
// ─────────────────────────────────────────────────────────────

import test from 'node:test'
import assert from 'node:assert/strict'
import nodeCrypto from 'node:crypto'

import { pair, settle } from './harness.mjs'

const SECRET = 'a-shared-master-secret'

const b64url = b => b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')

/** The canonical form signOutgoing() signs, reproduced exactly. */
const signed = ( _event, payload, { ts = Date.now(), nonce = nodeCrypto.randomBytes(16).toString('hex'), secret = SECRET } = {} ) => {
  const body = { v: 1, _event, payload, cid: undefined, timestamp: Date.now(), size: 0 }
  const canonical = JSON.stringify({
    v: body.v, _event: body._event, payload: body.payload,
    cid: body.cid, timestamp: body.timestamp, size: body.size, ts, nonce
  })
  const sig = b64url( nodeCrypto.createHmac('sha256', secret).update( canonical ).digest() )

  return { ...body, auth: { alg: 'HMAC-SHA256', ts, nonce, sig } }
}

/** A peer pair whose content side authenticates, plus a way to inject into it. */
const authed = async ( cryptoAuth = { secret: SECRET } ) => {
  const p = await pair({ contentOptions: { cryptoAuth, allowedIncomingEvents: [ 'msg' ] } })
  await p.connected

  const seen = [], errors = []
  p.content.on('msg', x => seen.push( x ))
  p.content.on('error', e => errors.push( e.type ))

  // Deliver as the host: same origin the content peer handshaked with.
  const inject = data => p.contentWindow.deliver({ data, origin: 'http://host.test', source: { postMessage(){} } })

  return { ...p, seen, errors, inject }
}

test('a correctly signed message is delivered', async t => {
  const a = await authed(); t.after( a.close )

  a.inject( signed('msg', { n: 1 }) )
  await settle()

  assert.deepEqual( a.seen, [ { n: 1 } ] )
})

test('a message signed with the wrong secret is refused', async t => {
  const a = await authed(); t.after( a.close )

  a.inject( signed('msg', { n: 2 }, { secret: 'not-the-secret' }) )
  await settle()

  assert.deepEqual( a.seen, [] )
  assert.ok( a.errors.includes('AUTH_FAILED') )
})

test('replaying a message is refused', async t => {
  const a = await authed(); t.after( a.close )

  const message = signed('msg', { n: 3 })
  a.inject( message )
  await settle()
  a.inject( message )
  await settle()

  assert.deepEqual( a.seen, [ { n: 3 } ], 'the replay must not be delivered a second time' )
  assert.ok( a.errors.includes('AUTH_FAILED') )
})

test('a message older than the skew window is refused', async t => {
  const a = await authed({ secret: SECRET, maxSkewMs: 1000 }); t.after( a.close )

  a.inject( signed('msg', { n: 4 }, { ts: Date.now() - 5000 }) )
  await settle()

  assert.deepEqual( a.seen, [] )
  assert.ok( a.errors.includes('AUTH_FAILED') )
})

test('a failed signature does not burn the nonce of a valid message', async t => {
  // The nonce used to be recorded before the signature was checked, so an
  // attacker could consume the nonce of a message still in flight and have the
  // genuine one thrown away as a replay.
  const a = await authed(); t.after( a.close )

  const nonce = 'a-nonce-a-legitimate-sender-will-use'

  a.inject( signed('msg', { n: 5 }, { nonce, secret: 'wrong' }) )
  await settle()
  assert.deepEqual( a.seen, [], 'the forgery is refused' )

  a.inject( signed('msg', { n: 5 }, { nonce }) )
  await settle()
  assert.deepEqual( a.seen, [ { n: 5 } ], 'and the genuine message still arrives' )
})

test('requireSigned refuses an unsigned message', async t => {
  const a = await authed({ secret: SECRET, requireSigned: true }); t.after( a.close )

  a.inject({ v: 1, _event: 'msg', payload: { n: 6 }, cid: undefined, timestamp: Date.now(), size: 0 })
  await settle()

  assert.deepEqual( a.seen, [] )
  assert.ok( a.errors.includes('AUTH_FAILED') )
})

test('without requireSigned an unsigned message is still accepted', async t => {
  // Documents the default rather than endorsing it: configuring cryptoAuth
  // alone changes nothing until requireSigned is set.
  const a = await authed(); t.after( a.close )

  a.inject({ v: 1, _event: 'msg', payload: { n: 7 }, cid: undefined, timestamp: Date.now(), size: 0 })
  await settle()

  assert.deepEqual( a.seen, [ { n: 7 } ] )
})

test('the allow-list still applies to an authenticated message', async t => {
  const a = await authed(); t.after( a.close )

  a.inject( signed('forbidden', { n: 8 }) )
  await settle()

  assert.ok( a.errors.includes('DISALLOWED_EVENT') )
})

test('session key events are ignored when session keys are off', async t => {
  const a = await authed(); t.after( a.close )

  a.inject({ v: 1, _event: '__session_key_init', payload: { sessionId: 'attacker' }, timestamp: Date.now(), size: 0 })
  await settle()

  assert.ok( a.errors.includes('SESSION_KEYS_DISABLED') )
})

test('a malformed session key event does not throw out of the handler', async t => {
  const a = await authed({ secret: SECRET, enableSessionKeys: true }); t.after( a.close )

  a.inject({ v: 1, _event: '__session_key_rotate', payload: undefined, timestamp: Date.now(), size: 0 })
  await settle()

  assert.ok( a.errors.includes('MALFORMED_SESSION_KEY_EVENT') )
})
