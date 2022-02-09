

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