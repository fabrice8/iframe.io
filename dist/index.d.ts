export type PeerType = 'WINDOW' | 'IFRAME';
export type AckFunction = (error: boolean | string, ...args: any[]) => void;
export type Listener = (payload?: any, ack?: AckFunction) => void;
export type CryptoAuthOptions = {
    /**
     * Shared secret used for HMAC-SHA256 signing.
     *
     * IMPORTANT: If an attacker can execute JS in either peer, they can read the secret.
     * This is for authenticity/integrity between cooperating peers, not a sandbox boundary.
     */
    secret: string;
    /**
     * If true, drop any incoming message that doesn't carry valid auth.
     * Default: false (accept unsigned messages)
     */
    requireSigned?: boolean;
    /**
     * Maximum allowed clock skew for signed messages (ms).
     * Default: 2 minutes
     */
    maxSkewMs?: number;
    /**
     * Replay window size (max number of nonces kept in memory).
     * Default: 500
     */
    replayWindowSize?: number;
};
export type Options = {
    type?: PeerType;
    debug?: boolean;
    heartbeatInterval?: number;
    connectionTimeout?: number;
    maxMessageSize?: number;
    maxMessagesPerSecond?: number;
    autoReconnect?: boolean;
    messageQueueSize?: number;
    /**
     * Optional allowlist of incoming application-level events.
     * Reserved internal events (ping/pong/heartbeats) are always allowed.
     */
    allowedIncomingEvents?: string[];
    /**
     * Optional custom validator for incoming messages.
     * Return false to drop a message; an 'error' event will be emitted.
     */
    validateIncoming?: (event: string, payload: any, origin: string) => boolean;
    /**
     * Optional cryptographic message authentication (HMAC-SHA256).
     * When enabled, use `emitSigned` / `emitAsyncSigned` to send signed messages.
     */
    cryptoAuth?: CryptoAuthOptions;
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
    auth?: {
        alg: 'HMAC-SHA256';
        ts: number;
        nonce: string;
        sig: string;
    };
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
    private seenNonces;
    constructor(options?: Options);
    private cryptoCfg;
    private pruneNonces;
    private signOutgoing;
    private verifyIncomingAuth;
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
    /**
     * Send a signed message (HMAC-SHA256) when `options.cryptoAuth` is configured.
     * This is async because WebCrypto signing is async.
     */
    emitSigned<T = any>(_event: string, payload?: T | AckFunction, fn?: AckFunction): Promise<this>;
    emitAsyncSigned<T = any, R = any>(_event: string, payload?: T, timeout?: number): Promise<R>;
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
