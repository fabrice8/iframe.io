
export type * as IFrameIOTop from '..'

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


export interface IFrameIOClass {
  Events: RegisteredEvents
  peer: Peer
  options: Options

  // constructor: ( options: Options ) => void
  debug: ( ...args: any[] ) => void
  initiate: ( contentWindow: MessageEventSource, iframeOrigin: string ) => this
  listen: ( hostOrigin?: string ) => this
  fire: ( _event: string, payload?: MessageData['payload'], callback?: boolean ) => void 
  emit: ( _event: string, payload?: MessageData['payload'], fn?: Listener ) => void
  on: ( _event: string, fn: Listener ) => void
  once: ( _event: string, fn: Listener ) => void
	off: ( _event: string, fn: Listener ) => void
	removeListeners: ( fn: Listener ) => void
}