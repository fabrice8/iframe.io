export type PeerType = 'WINDOW' | 'IFRAME';
export type AckFunction = (error: boolean | string, ...args: any[]) => void;
export type Listener = (payload?: any, ack?: AckFunction) => void;
export type Options = {
    type?: PeerType;
    debug?: boolean;
    heartbeatInterval?: number;
    connectionTimeout?: number;
    maxMessageSize?: number;
    maxMessagesPerSecond?: number;
    autoReconnect?: boolean;
    messageQueueSize?: number;
};
export interface RegisteredEvents {
    [index: string]: Listener[];
}
export type Peer = {
    type: PeerType;
    source?: Window;
    origin?: string;
    connected?: boolean;
    lastHeartbeat?: number;
};
export type MessageData = {
    _event: string;
    payload: any;
    cid: string | undefined;
    timestamp?: number;
    size?: number;
};
export type Message = {
    origin: string;
    data: MessageData;
    source: Window;
};
export type QueuedMessage = {
    _event: string;
    payload: any;
    fn?: AckFunction;
    timestamp: number;
};
export default class IOF {
    Events: RegisteredEvents;
    peer: Peer;
    options: Options;
    private messageListener?;
    private heartbeatTimer?;
    private reconnectTimer?;
    private messageQueue;
    private messageRateTracker;
    private reconnectAttempts;
    private maxReconnectAttempts;
    constructor(options?: Options);
    debug(...args: any[]): void;
    isConnected(): boolean;
    private startHeartbeat;
    private stopHeartbeat;
    private handleConnectionLoss;
    private attemptReconnection;
    private checkRateLimit;
    private queueMessage;
    private processMessageQueue;
    /**
     * Establish a connection with an iframe containing
     * in the current window
     */
    initiate(contentWindow: MessageEventSource, iframeOrigin: string): this;
    /**
     * Listening to connection from the content window
     */
    listen(hostOrigin?: string): this;
    fire(_event: string, payload?: MessageData['payload'], cid?: string): void;
    emit<T = any>(_event: string, payload?: T | AckFunction, fn?: AckFunction): this;
    on(_event: string, fn: Listener): this;
    once(_event: string, fn: Listener): this;
    off(_event: string, fn?: Listener): this;
    removeListeners(fn?: Listener): this;
    emitAsync<T = any, R = any>(_event: string, payload?: T, timeout?: number): Promise<R>;
    onceAsync<T = any>(_event: string): Promise<T>;
    connectAsync(timeout?: number): Promise<void>;
    private cleanup;
    disconnect(fn?: () => void): this;
    getStats(): {
        connected: boolean;
        peerType: PeerType;
        origin: string | undefined;
        lastHeartbeat: number | undefined;
        queuedMessages: number;
        reconnectAttempts: number;
        activeListeners: number;
        messageRate: number;
    };
    clearQueue(): this;
}
