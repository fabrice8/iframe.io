// ─────────────────────────────────────────────────────────────
// A two-peer postMessage harness, with no browser and no dependencies.
//
// iframe.io touches a very small part of the DOM — window.addEventListener,
// window.removeEventListener and source.postMessage( data, origin ) — so the
// whole transport can be exercised in Node by supplying those three and wiring
// two peers to each other.
//
// Each peer gets its OWN window, because the library registers its listener on
// whatever `window` is global at the moment `initiate()`/`listen()` is called.
// Swapping the global between constructions is what keeps the two sides apart.
// ─────────────────────────────────────────────────────────────

import { createRequire } from 'node:module'

const require = createRequire( import.meta.url )

export const IOF = require('../dist/index.js').default

/** A window whose message listeners can be driven by hand. */
const makeWindow = () => {
  const listeners = new Set()

  return {
    addEventListener: ( type, fn ) => { type === 'message' && listeners.add( fn ) },
    removeEventListener: ( type, fn ) => { type === 'message' && listeners.delete( fn ) },
    deliver: event => { for( const fn of [ ...listeners ] ) fn( event ) },
    get size(){ return listeners.size }
  }
}

/**
 * Two connected peers, host ⇄ content.
 *
 * `hostOptions` / `contentOptions` are passed straight to the constructors, so
 * a test says what it is testing and nothing else.
 */
export const pair = async ({ hostOptions = {}, contentOptions = {}, origin = 'http://content.test' } = {}) => {
  const
  hostWindow = makeWindow(),
  contentWindow = makeWindow(),
  hostOrigin = 'http://host.test',

  // What each side sees as `event.source` — postMessage on it delivers to the
  // other peer's window, carrying the sender's origin.
  contentHandle = { postMessage: ( data ) => contentWindow.deliver({ data, origin: hostOrigin, source: hostHandle }) },
  hostHandle = { postMessage: ( data ) => hostWindow.deliver({ data, origin, source: contentHandle }) }

  const previous = globalThis.window

  globalThis.window = contentWindow
  const content = new IOF({ ...contentOptions })
  content.listen( hostOrigin )

  globalThis.window = hostWindow
  const host = new IOF({ type: 'WINDOW', ...hostOptions })

  /**
   * The listener is attached BEFORE initiate(), because with both peers in one
   * process the handshake completes synchronously inside it — a test that waits
   * for 'connect' afterwards waits for an event that has already fired.
   */
  const connected = new Promise( resolve => host.once('connect', resolve) )

  host.initiate( contentHandle, origin )

  globalThis.window = previous

  /**
   * Stop both peers. `cleanup()` calls window.removeEventListener on whatever
   * `window` is global at that moment, so each side is torn down under its own
   * window — and without this the heartbeat interval keeps Node alive and the
   * test run never exits.
   */
  const close = () => {
    const saved = globalThis.window

    globalThis.window = hostWindow
    try { host.disconnect() } catch {}

    globalThis.window = contentWindow
    try { content.disconnect() } catch {}

    globalThis.window = saved
  }

  return { host, content, hostWindow, contentWindow, connected, close }
}

/** Resolve once `event` fires on `peer`, or reject after `ms`. */
export const waitFor = ( peer, event, ms = 1000 ) =>
  new Promise( ( resolve, reject ) => {
    const timer = setTimeout( () => reject( new Error(`timed out waiting for '${event}'`) ), ms )
    peer.once( event, payload => { clearTimeout( timer ); resolve( payload ) })
  })

/** Let queued microtasks and timers settle. */
export const settle = ( ms = 50 ) => new Promise( resolve => setTimeout( resolve, ms ) )
