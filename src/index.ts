
export type PeerType = 'WINDOW' | 'IFRAME'

export type CallbackFunction = ( error: boolean | string, ...args: any[] ) => void
export type Listener = ( payload?: any, callback?: CallbackFunction ) => void

export type Options = {
  type?: PeerType
  debug?: boolean
}

export interface RegisteredEvents {
  [index: string]: Listener[]
}

export type Peer = {
  type: PeerType
  source?: Window
  origin?: string
}

export type MessageData = {
  _event: string
  payload: any
  callback: boolean
}

export type Message = {
  origin: string
  data: MessageData,
  source: Window
}

function newObject( data: object ){
  return JSON.parse( JSON.stringify( data ) )
}

export default class IOF {

  Events: RegisteredEvents
  peer: Peer
  options: Options

  constructor( options: Options ){

    if( options && typeof options !== 'object' )
      throw new Error('Invalid Options')
    
    this.options = options
	  this.Events = {}
    this.peer = { type: 'IFRAME' }

    if( options.type ) 
      this.peer.type = options.type.toUpperCase() as PeerType
  }

  debug( ...args: any[] ){ this.options && this.options.debug && console.log( ...args ) }

  initiate( contentWindow: MessageEventSource, iframeOrigin: string ){
    // Establish a connection with an iframe containing in the current window
    if( !contentWindow || !iframeOrigin )
      throw new Error('Invalid Connection initiation arguments')
    
    if( this.peer.type === 'IFRAME' )
      throw new Error('Expect IFRAME to <listen> and WINDOW to <initiate> a connection')

    this.peer.source = contentWindow as Window
    this.peer.origin = iframeOrigin
    
    window.addEventListener( 'message', ({ origin, data, source }) => {
      // Check valid message
      if( origin !== this.peer.origin
          || !source
          || typeof data !== 'object'
          || !data.hasOwnProperty('_event') ) return
          
      const { _event, payload, callback } = data as Message['data']
      this.debug( `[${this.peer.type}] Message: ${_event}`, payload || '' )

      // Handshake or availability check events
      if( _event == 'pong' ){
        // Content Window is connected to iframe
        this.fire('connect')
        return this.debug(`[${this.peer.type}] connected`)
      }

      // Fire available event listeners
      this.fire( _event, payload, callback )
    }, false )

    this.debug(`[${this.peer.type}] Initiate connection: IFrame origin <${iframeOrigin}>`)
    this.emit('ping')

    return this
  }

  listen( hostOrigin?: string ){
    // Listening to connection from the content window
    
    this.peer.type = 'IFRAME' // iframe.io connection listener is automatically set as IFRAME
    this.debug(`[${this.peer.type}] Listening to connect${hostOrigin ? `: Host <${hostOrigin}>` : ''}`)

    window.addEventListener( 'message', ({ origin, data, source }) => {
      // Check host origin where event must only come from.
      if( hostOrigin && hostOrigin !== origin )
        throw new Error('Invalid Event Origin')
        
      // Check valid message
      if( !source
          || typeof data !== 'object'
          || !data.hasOwnProperty('_event') ) return

      // Define peer source window and origin
      if( !this.peer.source ){
        this.peer = { ...this.peer, source: source as Window, origin }
        this.debug(`[${this.peer.type}] Connect to ${origin}`)
      }

      // Origin different from handshaked source origin
      else if( origin !== this.peer.origin )
        throw new Error('Invalid Origin')
      
      const { _event, payload, callback } = data
      this.debug( `[${this.peer.type}] Message: ${_event}`, payload || '' )

      // Handshake or availability check events
      if( _event == 'ping' ){
        this.emit('pong')

        // Iframe is connected to content window
        this.fire('connect')
        return this.debug(`[${this.peer.type}] connected`)
      }

      // Fire available event listeners
      this.fire( _event, payload, callback )
    }, false )

    return this
  }

  fire( _event: string, payload?: MessageData['payload'], callback?: boolean ){
    // Volatile event
    if( !this.Events[ _event ] 
        && !this.Events[ _event +'--@once'] )
      return this.debug(`[${this.peer.type}] No <${_event}> listener defined`)

    const callbackFn = callback ? 
                  ( error: boolean | string, ...args: any[] ): void => {
                    this.emit( _event +'--@callback', { error: error || false, args } )
                    return
                  } : undefined
    let listeners: Listener[] = []

    if( this.Events[ _event +'--@once'] ){
      // Once triggable event
      _event += '--@once'
      listeners = this.Events[ _event ]
      // Delete once event listeners after fired
      delete this.Events[ _event ]
    }
    else listeners = this.Events[ _event ]
    
    // Fire listeners
    listeners.map( fn => payload ? fn( payload, callbackFn ) : fn( callbackFn ) )
  }

  emit( _event: string, payload?: MessageData['payload'], fn?: CallbackFunction ){

    if( !this.peer.source )
      throw new Error('No Connection initiated')

		if( typeof payload == 'function' ){
			fn = payload
			payload = null
		}

    // Acknowledge/callback event listener
    let hasCallback = false
    if( typeof fn === 'function' ){
      const callbackFunction = fn

		  this.once( _event +'--@callback', ({ error, args }) => callbackFunction( error, ...args ) )
      hasCallback = true
    }
    
    this.peer.source.postMessage( newObject({ _event, payload, callback: hasCallback }), this.peer.origin as string )

		return this
  }
  
  on( _event: string, fn: Listener ){
		// Add Event listener
		if( !this.Events[ _event ] ) this.Events[ _event ] = []
		this.Events[ _event ].push( fn )
    
    this.debug(`[${this.peer.type}] New <${_event}> listener on`)
		return this
	}
  
  once( _event: string, fn: Listener ){
		// Add Once Event listener
    _event += '--@once'

		if( !this.Events[ _event ] ) this.Events[ _event ] = []
		this.Events[ _event ].push( fn )
    
    this.debug(`[${this.peer.type}] New <${_event} once> listener on`)
		return this
	}

	off( _event: string, fn?: Listener ){
		// Remove Event listener
		delete this.Events[ _event ]
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
}