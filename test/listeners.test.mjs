// ─────────────────────────────────────────────────────────────
// iframe.io: taking a listener off, and an error listener that throws
//
// off( event, fn ) called fn after removing it, so the listener ran once more
// with no payload as it was taken off. And a listener for `error` that threw
// was handed its own failure as another `error`, which threw again, until
// the stack ran out.
// ─────────────────────────────────────────────────────────────

import test from 'node:test'
import assert from 'node:assert/strict'
import { IOF as Peer } from './harness.mjs'

test('off removes a listener without running it', () => {
  const peer = new Peer({ type: 'WINDOW' })
  let calls = 0
  const listener = () => calls++

  peer.on('zone:click', listener )
  peer.off('zone:click', listener )
  peer.fire('zone:click', { id: 'a' })

  assert.equal( calls, 0 )
})

test('an error listener that throws stops there', () => {
  const peer = new Peer({ type: 'WINDOW' })
  let calls = 0

  peer.on('error', () => { calls++; throw new Error('no one listening') })
  peer.fire('error', { type: 'NO_CONNECTION' })

  assert.equal( calls, 1 )
})
