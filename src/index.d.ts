

type PeerType = 'WINDOW' | 'IFRAME'
export type Listener = ( payload?: any, callback?: ( error?: boolean | string, response?: any ) => void ) => void

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