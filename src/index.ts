export type PeerType = 'WINDOW' | 'IFRAME'

export type AckFunction = ( error: boolean | string, ...args: any[] ) => void
export type Listener = ( payload?: any, ack?: AckFunction ) => void

export type Options = {
  type?: PeerType
  debug?: boolean
  heartbeatInterval?: number
  connectionTimeout?: number
  maxMessageSize?: number
  maxMessagesPerSecond?: number
  autoReconnect?: boolean
  messageQueueSize?: number
}

export interface RegisteredEvents {
  [index: string]: Listener[]
}

export type Peer = {
  type: PeerType
  source?: Window
  origin?: string
  connected?: boolean
  lastHeartbeat?: number
}

export type MessageData = {
  _event: string
  payload: any
  cid: string | undefined
  timestamp?: number
  size?: number
}

export type Message = {
  origin: string
  data: MessageData
  source: Window
}

export type QueuedMessage = {
  _event: string
  payload: any
  fn?: AckFunction
  timestamp: number
}

function newObject( data: object ){
  return JSON.parse( JSON.stringify( data ) )
}

function getMessageSize( data: any ): number {
  try { return JSON.stringify( data ).length }
  catch { return 0 }
}

function sanitizePayload( payload: any, maxSize: number ): any {
  if( !payload ) return payload

  const size = getMessageSize( payload )
  if( size > maxSize )
    throw new Error(`Message size ${size} exceeds limit ${maxSize}`)

  // Basic sanitization - remove functions and undefined values
  return JSON.parse( JSON.stringify( payload ) )
}

const ackId = () => {
  const
  rmin = 100000,
  rmax = 999999,
  timestamp = Date.now(),
  random = Math.floor( Math.random() * ( rmax - rmin + 1 ) + rmin )

  return `${timestamp}_${random}`
}

const RESERVED_EVENTS = [
  'ping',
  'pong',
  '__heartbeat',
  '__heartbeat_response'
]

export default class IOF {
  Events: RegisteredEvents
  peer: Peer
  options: Options
  private messageListener?: ( event: MessageEvent ) => void
  private heartbeatTimer?: NodeJS.Timeout
  private reconnectTimer?: NodeJS.Timeout
  private messageQueue: QueuedMessage[] = []
  private messageRateTracker: number[] = []
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 5

  constructor( options: Options = {} ){
    if( options && typeof options !== 'object' )
      throw new Error('Invalid Options')

    this.options = {
      debug: false,
      heartbeatInterval: 30000, // 30 seconds
      connectionTimeout: 10000, // 10 seconds
      maxMessageSize: 1024 * 1024, // 1MB
      maxMessagesPerSecond: 100,
      autoReconnect: true,
      messageQueueSize: 50,
      ...options
    }
    this.Events = {}
    this.peer = { type: 'IFRAME', connected: false }

    if( options.type )
      this.peer.type = options.type.toUpperCase() as PeerType
  }

  debug( ...args: any[] ){
    this.options.debug && console.debug( ...args )
  }

  isConnected(): boolean {
    return !!this.peer.connected && !!this.peer.source
  }

  // Enhanced connection health monitoring
  private startHeartbeat(){
    if( !this.options.heartbeatInterval ) return

    this.heartbeatTimer = setInterval(() => {
      if( this.isConnected() ){
        const now = Date.now()

        // Check if peer is still responsive
        if( this.peer.lastHeartbeat
            && ( now - this.peer.lastHeartbeat ) > ( this.options.heartbeatInterval! * 2 ) ){
          this.debug(`[${this.peer.type}] Heartbeat timeout detected`)
          this.handleConnectionLoss()

          return
        }

        // Send heartbeat
        try { this.emit('__heartbeat', { timestamp: now }) }
        catch( error ){
          this.debug(`[${this.peer.type}] Heartbeat send failed:`, error)
          this.handleConnectionLoss()
        }
      }
    }, this.options.heartbeatInterval )
  }

  private stopHeartbeat(){
    if( !this.heartbeatTimer ) return

    clearInterval( this.heartbeatTimer )
    this.heartbeatTimer = undefined
  }

  // Handle connection loss and potential reconnection
  private handleConnectionLoss(){
    if( !this.peer.connected ) return

    this.peer.connected = false
    this.stopHeartbeat()
    this.fire('disconnect', { reason: 'CONNECTION_LOST' })

    this.options.autoReconnect
    && this.reconnectAttempts < this.maxReconnectAttempts
    && this.attemptReconnection()
  }

  private attemptReconnection(){
    if( this.reconnectTimer ) return

    this.reconnectAttempts++
    const delay = Math.min( 1000 * Math.pow( 2, this.reconnectAttempts - 1 ), 30000 ) // Exponential backoff, max 30s

    this.debug(`[${this.peer.type}] Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`)
    this.fire('reconnecting', { attempt: this.reconnectAttempts, delay })

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined

      // Re-initiate connection for WINDOW type
      this.peer.type === 'WINDOW'
      && this.peer.source
      && this.peer.origin
      && this.emit('ping')

      // For IFRAME type, just wait for incoming connection

      // Set timeout for this reconnection attempt
      setTimeout(() => {
        if( this.peer.connected ) return

        this.reconnectAttempts < this.maxReconnectAttempts
            ? this.attemptReconnection()
            : this.fire('reconnection_failed', { attempts: this.reconnectAttempts })
      }, this.options.connectionTimeout!)
    }, delay)
  }

  // Message rate limiting
  private checkRateLimit(): boolean {
    if( !this.options.maxMessagesPerSecond ) return true

    const
    now = Date.now(),
    aSecondAgo = now - 1000

    // Clean old entries
    this.messageRateTracker = this.messageRateTracker.filter( timestamp => timestamp > aSecondAgo )

    // Check if limit exceeded
    if( this.messageRateTracker.length >= this.options.maxMessagesPerSecond ){
      this.fire('error', {
        type: 'RATE_LIMIT_EXCEEDED',
        limit: this.options.maxMessagesPerSecond,
        current: this.messageRateTracker.length
      })

      return false
    }

    this.messageRateTracker.push( now )
    return true
  }

  // Queue messages when not connected
  private queueMessage( _event: string, payload?: any, fn?: AckFunction ){
    if( this.messageQueue.length >= this.options.messageQueueSize! ){
      // Remove oldest message
      const removed = this.messageQueue.shift()
      this.debug(`[${this.peer.type}] Message queue full, removed oldest message:`, removed?._event)
    }

    this.messageQueue.push({
      _event,
      payload,
      fn,
      timestamp: Date.now()
    })

    this.debug(`[${this.peer.type}] Queued message: ${_event} (queue size: ${this.messageQueue.length})`)
  }

  // Process queued messages when connection is established
  private processMessageQueue(){
    if( !this.isConnected() || this.messageQueue.length === 0 ) return

    this.debug(`[${this.peer.type}] Processing ${this.messageQueue.length} queued messages`)

    const queue = [...this.messageQueue]
    this.messageQueue = []

    queue.forEach( message => {
      try { this.emit( message._event, message.payload, message.fn ) }
      catch( error ){ this.debug(`[${this.peer.type}] Failed to send queued message:`, error) }
    })
  }

  /**
   * Establish a connection with an iframe containing
   * in the current window
   */
  initiate( contentWindow: MessageEventSource, iframeOrigin: string ){
    if( !contentWindow || !iframeOrigin )
      throw new Error('Invalid Connection initiation arguments')

    if( this.peer.type === 'IFRAME' )
      throw new Error('Expect IFRAME to <listen> and WINDOW to <initiate> a connection')

    // Clean up existing listener if any
    this.cleanup()

    this.peer.source = contentWindow as Window
    this.peer.origin = iframeOrigin
    this.peer.connected = false
    this.reconnectAttempts = 0

    this.messageListener = ({ origin, data, source }) => {
      try {
        // Enhanced security: check valid message structure
        if( origin !== this.peer.origin
            || !source
            || typeof data !== 'object'
            || !data.hasOwnProperty('_event') ) return

        const { _event, payload, cid, timestamp } = data as Message['data']

        // Handle heartbeat responses
        if( _event === '__heartbeat_response' ){
          this.peer.lastHeartbeat = Date.now()
          return
        }

        // Handle heartbeat requests
        if( _event === '__heartbeat' ){
          this.emit('__heartbeat_response', { timestamp: Date.now() })
          this.peer.lastHeartbeat = Date.now()
          return
        }

        this.debug(`[${this.peer.type}] Message: ${_event}`, payload || '')

        // Handshake or availability check events
        if( _event == 'pong' ){
          // Content Window is connected to iframe
          this.peer.connected = true
          this.reconnectAttempts = 0
          this.peer.lastHeartbeat = Date.now()
          
          this.startHeartbeat()
          this.fire('connect')
          this.processMessageQueue()
          this.debug(`[${this.peer.type}] connected`)

          return
        }

        // Fire available event listeners
        this.fire( _event, payload, cid )
      }
      catch( error ){
        this.debug(`[${this.peer.type}] Message handling error:`, error)
        this.fire('error', {
          type: 'MESSAGE_HANDLING_ERROR',
          error: error instanceof Error ? error.message : String(error),
          origin
        })
      }
    }

    window.addEventListener('message', this.messageListener, false)

    this.debug(`[${this.peer.type}] Initiate connection: IFrame origin <${iframeOrigin}>`)
    this.emit('ping')

    return this
  }

  /**
   * Listening to connection from the content window
   */
  listen( hostOrigin?: string ){
    this.peer.type = 'IFRAME' // iframe.io connection listener is automatically set as IFRAME
    this.peer.connected = false
    this.reconnectAttempts = 0

    this.debug(`[${this.peer.type}] Listening to connect${hostOrigin ? `: Host <${hostOrigin}>` : ''}`)

    // Clean up existing listener if any
    this.cleanup()

    this.messageListener = ({ origin, data, source }) => {
      try {
        // Enhanced security: check host origin where event must only come from
        if( hostOrigin && hostOrigin !== origin ){
          this.fire('error', {
            type: 'INVALID_ORIGIN',
            expected: hostOrigin,
            received: origin
          })
          return
        }

        // Enhanced security: check valid message structure
        if( !source
            || typeof data !== 'object'
            || !data.hasOwnProperty('_event') ) return

        // Define peer source window and origin
        if( !this.peer.source ){
          this.peer = { ...this.peer, source: source as Window, origin }
          this.debug(`[${this.peer.type}] Connect to ${origin}`)
        }

        // Origin different from handshaked source origin
        else if( origin !== this.peer.origin ){
          this.fire('error', {
            type: 'ORIGIN_MISMATCH',
            expected: this.peer.origin,
            received: origin
          })
          return
        }

        const { _event, payload, cid, timestamp } = data

        // Handle heartbeat responses
        if( _event === '__heartbeat_response' ){
          this.peer.lastHeartbeat = Date.now()
          return
        }

        // Handle heartbeat requests
        if( _event === '__heartbeat' ){
          this.emit('__heartbeat_response', { timestamp: Date.now() })
          this.peer.lastHeartbeat = Date.now()
          return
        }

        this.debug(`[${this.peer.type}] Message: ${_event}`, payload || '')

        // Handshake or availability check events
        if( _event == 'ping' ){
          this.emit('pong')

          // Iframe is connected to content window
          this.peer.connected = true
          this.reconnectAttempts = 0
          this.peer.lastHeartbeat = Date.now()
          this.startHeartbeat()
          this.fire('connect')
          this.processMessageQueue()

          this.debug(`[${this.peer.type}] connected`)
          return
        }

        // Fire available event listeners
        this.fire( _event, payload, cid )
      }
      catch( error ){
        this.debug(`[${this.peer.type}] Message handling error:`, error)
        this.fire('error', {
          type: 'MESSAGE_HANDLING_ERROR',
          error: error instanceof Error ? error.message : String(error),
          origin
        })
      }
    }

    window.addEventListener('message', this.messageListener, false)

    return this
  }

  fire( _event: string, payload?: MessageData['payload'], cid?: string ){
    // Volatile event - check if any listeners exist
    if( !this.Events[_event] && !this.Events[_event + '--@once'] ){
      this.debug(`[${this.peer.type}] No <${_event}> listener defined`)
      return
    }

    const ackFn = cid
      ? ( error: boolean | string, ...args: any[] ): void => {
          this.emit(`${_event}--${cid}--@ack`, { error: error || false, args })
          return
        }
      : undefined
    let listeners: Listener[] = []

    if( this.Events[_event + '--@once'] ){
      // Once triggable event
      _event += '--@once'
      listeners = this.Events[_event]
      // Delete once event listeners after fired
      delete this.Events[_event]
    }
    else listeners = this.Events[_event]

    // Fire listeners with error handling
    listeners.forEach( fn => {
      try { payload !== undefined ? fn( payload, ackFn ) : fn( ackFn ) }
      catch( error ){
        this.debug(`[${this.peer.type}] Listener error for ${_event}:`, error)
        this.fire('error', {
          type: 'LISTENER_ERROR',
          event: _event,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })
  }

  emit<T = any>( _event: string, payload?: T | AckFunction, fn?: AckFunction ){
    // Check rate limiting
    if( !this.checkRateLimit() ) return this

    /**
     * Queue message if not connected: Except for
     * connection-related events
     */
    if( !this.isConnected() && !RESERVED_EVENTS.includes(_event) ){
      this.queueMessage( _event, payload, fn )
      return this
    }

    if( !this.peer.source ){
      this.fire('error', { type: 'NO_CONNECTION', event: _event })
      return this
    }

    if( typeof payload == 'function' ){
      fn = payload as AckFunction
      payload = undefined
    }

    try {
      // Enhanced security: sanitize and validate payload
      const sanitizedPayload = payload
        ? sanitizePayload( payload, this.options.maxMessageSize! )
        : payload

      // Acknowledge event listener
      let cid: string | undefined
      if( typeof fn === 'function' ){
        const ackFunction = fn

        cid = ackId()
        this.once(`${_event}--${cid}--@ack`, ({ error, args }) => ackFunction( error, ...args ))
      }

      const messageData = {
        _event,
        payload: sanitizedPayload,
        cid,
        timestamp: Date.now(),
        size: getMessageSize( sanitizedPayload )
      }

      this.peer.source.postMessage( newObject( messageData ), this.peer.origin as string )
    }
    catch( error ){
      this.debug(`[${this.peer.type}] Emit error:`, error)
      this.fire('error', {
        type: 'EMIT_ERROR',
        event: _event,
        error: error instanceof Error ? error.message : String(error)
      })

      // Call acknowledgment with error if provided
      typeof fn === 'function'
      && fn( error instanceof Error ? error.message : String(error) )
    }

    return this
  }

  on( _event: string, fn: Listener ){
    // Add Event listener
    if( !this.Events[_event] ) this.Events[_event] = []
    this.Events[_event].push( fn )

    this.debug(`[${this.peer.type}] New <${_event}> listener on`)
    return this
  }

  once( _event: string, fn: Listener ){
    // Add Once Event listener
    _event += '--@once'

    if( !this.Events[_event] ) this.Events[_event] = []
    this.Events[_event].push( fn )

    this.debug(`[${this.peer.type}] New <${_event} once> listener on`)
    return this
  }

  off( _event: string, fn?: Listener ){
    // Remove Event listener
    if( fn && this.Events[_event] ){
      // Remove specific listener if provided
      const index = this.Events[_event].indexOf( fn )
      if( index > -1 ){
        this.Events[_event].splice( index, 1 )

        // Remove event array if empty
        if( this.Events[_event].length === 0 )
          delete this.Events[_event]
      }
    }
    // Remove all listeners for event
    else delete this.Events[_event]

    typeof fn == 'function' && fn()
    this.debug(`[${this.peer.type}] <${_event}> listener off`)

    return this
  }

  removeListeners( fn?: Listener ){
    // Clear all event listeners
    this.Events = {}
    typeof fn == 'function' && fn()

    this.debug(`[${this.peer.type}] All listeners removed`)
    return this
  }

  emitAsync<T = any, R = any>( _event: string, payload?: T, timeout: number = 5000 ): Promise<R> {
    return new Promise(( resolve, reject ) => {
      const timeoutId = setTimeout(() => {
        reject( new Error(`Event '${_event}' acknowledgment timeout after ${timeout}ms`) )
      }, timeout )

      try {
        this.emit( _event, payload, ( error, ...args ) => {
          clearTimeout( timeoutId )

          error
            ? reject( new Error( typeof error === 'string' ? error : 'Ack error' ) )
            : resolve( args.length === 0 ? undefined : args.length === 1 ? args[0] : args )
        })
      }
      catch( error ){
        clearTimeout( timeoutId )
        reject( error )
      }
    })
  }

  onceAsync<T = any>( _event: string ): Promise<T> {
    return new Promise( resolve => this.once( _event, resolve ) )
  }

  connectAsync( timeout?: number ): Promise<void> {
    return new Promise(( resolve, reject ) => {
      if( this.isConnected() ) return resolve()

      const timeoutId = setTimeout(() => {
        this.off('connect', connectHandler)
        reject( new Error('Connection timeout') )
      }, timeout || this.options.connectionTimeout)

      const connectHandler = () => {
        clearTimeout( timeoutId )
        resolve()
      }

      this.once('connect', connectHandler)
    })
  }

  // Clean up all resources
  private cleanup(){
    if( this.messageListener ){
      window.removeEventListener('message', this.messageListener)
      this.messageListener = undefined
    }

    this.stopHeartbeat()

    if( this.reconnectTimer ){
      clearTimeout( this.reconnectTimer )
      this.reconnectTimer = undefined
    }
  }

  disconnect( fn?: () => void ){
    // Cleanup on disconnect
    this.cleanup()

    this.peer.connected = false
    this.peer.source = undefined
    this.peer.origin = undefined
    this.peer.lastHeartbeat = undefined
    this.messageQueue = []
    this.messageRateTracker = []
    this.reconnectAttempts = 0

    this.removeListeners()

    typeof fn == 'function' && fn()
    this.debug(`[${this.peer.type}] Disconnected`)

    return this
  }

  // Get connection statistics
  getStats(){
    return {
      connected: this.isConnected(),
      peerType: this.peer.type,
      origin: this.peer.origin,
      lastHeartbeat: this.peer.lastHeartbeat,
      queuedMessages: this.messageQueue.length,
      reconnectAttempts: this.reconnectAttempts,
      activeListeners: Object.keys( this.Events ).length,
      messageRate: this.messageRateTracker.length
    }
  }

  // Clear message queue manually
  clearQueue(){
    const queueSize = this.messageQueue.length
    this.messageQueue = []

    this.debug(`[${this.peer.type}] Cleared ${queueSize} queued messages`)
    return this
  }
}
