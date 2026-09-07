// ─────────────────────────────────────────────────────────────
// iframe.io — transport, allow-list and message validation
//
// The library had no tests at all when these were written, which is how the
// allow-list regression below survived: `initiate()` and `listen()` carry two
// near-identical ~180-line message handlers, and the unauthenticated branch of
// the validation was only ever added to one of them.
// ─────────────────────────────────────────────────────────────

import test from 'node:test'
import assert from 'node:assert/strict'

import { pair, settle } from './harness.mjs'

test('the two peers complete a handshake', async t => {
  const p = await pair()
  t.after( p.close )

  await p.connected
  assert.equal( p.host.isConnected(), true )
})

test('an allowed event reaches the content side', async t => {
  const p = await pair({ contentOptions: { allowedIncomingEvents: [ 'allowed' ] } })
  t.after( p.close )
  await p.connected

  const seen = []
  p.content.on('allowed', payload => seen.push( payload ))

  p.host.emit('allowed', { n: 1 })
  await settle()

  assert.deepEqual( seen, [ { n: 1 } ] )
})

test('an event outside the allow-list never reaches a listener', async t => {
  // The regression. `listen()` applied allowedIncomingEvents only inside the
  // cryptoAuth branch, so an unauthenticated bridge — which is exactly how
  // de.eui configures it — accepted every event name that was sent to it.
  const p = await pair({ contentOptions: { allowedIncomingEvents: [ 'allowed' ] } })
  t.after( p.close )
  await p.connected

  const seen = [], errors = []
  p.content.on('forbidden', () => seen.push('forbidden'))
  p.content.on('error', e => errors.push( e.type ))

  p.host.emit('forbidden', { n: 2 })
  await settle()

  assert.deepEqual( seen, [], 'a disallowed event must not be dispatched' )
  assert.ok( errors.includes('DISALLOWED_EVENT'), 'and it must be reported' )
})

test('the allow-list is enforced on the host side too', async t => {
  const p = await pair({ hostOptions: { allowedIncomingEvents: [ 'allowed' ] } })
  t.after( p.close )
  await p.connected

  const seen = [], errors = []
  p.host.on('forbidden', () => seen.push('forbidden'))
  p.host.on('error', e => errors.push( e.type ))

  p.content.emit('forbidden', { n: 3 })
  await settle()

  assert.deepEqual( seen, [] )
  assert.ok( errors.includes('DISALLOWED_EVENT') )
})

test('validateIncoming can refuse an otherwise allowed event', async t => {
  const p = await pair({
    contentOptions: {
      allowedIncomingEvents: [ 'allowed' ],
      validateIncoming: ( _event, payload ) => payload?.ok === true
    }
  })
  t.after( p.close )
  await p.connected

  const seen = [], errors = []
  p.content.on('allowed', x => seen.push( x ))
  p.content.on('error', e => errors.push( e.type ))

  p.host.emit('allowed', { ok: false })
  await settle()

  assert.deepEqual( seen, [] )
  assert.ok( errors.includes('INVALID_MESSAGE') )
})

test('reserved events are never filtered by the allow-list', async t => {
  // Heartbeats and the handshake must survive an allow-list that does not
  // mention them, or configuring one would silently sever the connection.
  const p = await pair({ contentOptions: { allowedIncomingEvents: [ 'nothing-else' ] } })
  t.after( p.close )

  await p.connected
  assert.equal( p.host.isConnected(), true )
})
