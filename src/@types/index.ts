
type PeerType = 'WINDOW' | 'IFRAME'
export type Listener = ( payload?: any ) => void

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
}

export type Message = {
  origin: string
  data: MessageData,
  source: Window
}