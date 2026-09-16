// ─────────────────────────────────────────────────────────────
// iframe.io — an acknowledgement is a reply, not an inbound event
//
// `allowedIncomingEvents` exists so a peer can say which events the other side
// is allowed to push at it. acceptIncoming() applied it to every non-reserved
// message, and an acknowledgement is named `<event>--<cid>--@ack` — a name no
// host can put in an allowlist, because the cid is minted per call. So any peer
// that set an allowlist had its own acknowledged emits dropped on arrival:
// emitAsync() rejected on timeout while the other side had already answered,
// with nothing to see from either end.
// ─────────────────────────────────────────────────────────────

import test from 'node:test'
import assert from 'node:assert/strict'

import { pair, settle } from './harness.mjs'

/**
 * Run a test against a connected pair and always tear it down.
 *
 * Without the `finally` a failing assertion skips close(), the heartbeat
 * intervals keep Node alive, and the run hangs for minutes instead of
 * reporting the failure — which is exactly what a regression here would do.
 */
const withPair = async ( hostOptions, body ) => {
  const { host, content, connected, close } = await pair({ hostOptions })

  await connected
  try { await body( host, content ) }
  finally { close() }
}

const ALLOWLIST = { allowedIncomingEvents: ['ready'] }

test('an acknowledgement reaches its caller through an allowlist', () =>
  withPair( ALLOWLIST, async ( host, content ) => {
    content.on('bind', ( payload, ack ) => ack( false, 'bound' ) )

    assert.equal( await host.emitAsync('bind', { token: 'abc' }, 500 ), 'bound' )
  }) )

test('an acknowledgement carries its error back rather than timing out', () =>
  withPair( ALLOWLIST, async ( host, content ) => {
    content.on('bind', ( payload, ack ) => ack('refused') )

    await assert.rejects( host.emitAsync('bind', {}, 500 ), /refused/ )
  }) )

test('the allowlist still refuses an event the peer pushes on its own', () =>
  withPair( ALLOWLIST, async ( host, content ) => {
    const seen = []

    host.on('error', error => seen.push( error ) )
    host.on('pick:location', () => seen.push('delivered') )

    content.emit('pick:location', { lat: 1, lng: 2 })
    await settle()

    assert.equal( seen.length, 1 )
    assert.equal( seen[0].type, 'DISALLOWED_EVENT' )
  }) )

test('an allowlisted event is still delivered', () =>
  withPair( ALLOWLIST, async ( host, content ) => {
    let delivered = false

    host.on('ready', () => { delivered = true })

    content.emit('ready')
    await settle()

    assert.equal( delivered, true )
  }) )
