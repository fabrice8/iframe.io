export declare type PeerType = 'WINDOW' | 'IFRAME';
export declare type CallbackFunction = (error: boolean | string, ...args: any[]) => void;
export declare type Listener = (payload?: any, callback?: CallbackFunction) => void;
export declare type Options = {
    type?: PeerType;
};
export interface RegisteredEvents {
    [index: string]: Listener[];
}
export declare type Peer = {
    type: PeerType;
    source?: Window;
    origin?: string;
};
export declare type MessageData = {
    _event: string;
    payload: any;
    cid: boolean;
};
export declare type Message = {
    origin: string;
    data: MessageData;
    source: Window;
};
export default class IOF {
    Events: RegisteredEvents;
    peer: Peer;
    options: Options;
    constructor(options: Options);
    debug(...args: any[]): void;
    initiate(contentWindow: MessageEventSource, iframeOrigin: string): this;
    listen(hostOrigin?: string): this;
    fire(_event: string, payload?: MessageData['payload'], cid?: boolean): void;
    emit(_event: string, payload?: MessageData['payload'], fn?: CallbackFunction): this;
    on(_event: string, fn: Listener): this;
    once(_event: string, fn: Listener): this;
    off(_event: string, fn?: Listener): this;
    removeListeners(fn?: Listener): this;
}
