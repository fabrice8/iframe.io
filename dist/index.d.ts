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
    /**
     * Enable session-derived keys for enhanced security.
     * When enabled, a unique session key is derived from the master secret
     * and exchanged session IDs during connection handshake.
     * Recommended for long-lived connections and high-security applications.
     * Default: false
     */
    enableSessionKeys?: boolean;
    /**
     * How often to rotate session keys (in milliseconds).
     * Only applies when enableSessionKeys is true.
     * Default: 3600000 (1 hour)
     */
    sessionKeyRotationInterval?: number;
};
export type SessionKeyInfo = {
    keyId: string;
    key: string;
    createdAt: number;
    expiresAt: number;
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
    protocolVersion?: number;
    sessionId?: string;
};
export type MessageData = {
    v: number;
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
        keyId?: string;
    };
    sessionId?: string;
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
    private sessionKeyRotationTimer?;
    private messageQueue;
    private messageRateTracker;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private seenNonces;
    private currentSessionKey?;
    private pendingSessionKey?;
    private previousSessionKey?;
    private mySessionId?;
    constructor(options?: Options);
    private cryptoCfg;
    /**
     * Forget nonces that can no longer be replayed, and only then cap the map.
     *
     * Age is what actually decides replayability: a captured message is refused
     * once its `ts` falls outside maxSkewMs, so a nonce is only worth keeping
     * that long. Pruning purely by count — as this did — made the two defaults
     * contradict each other: 500 remembered nonces at the default 100 messages a
     * second is five seconds of history guarding a two-minute acceptance window,
     * so anything captured could simply be replayed after five seconds.
     *
     * The count cap stays as a memory bound. Reaching it means the rate limiter
     * is admitting more traffic than the window can remember, so it is reported
     * rather than applied in silence.
     */
    private pruneNonces;
    /**
     * Get the appropriate secret for signing messages
     * Uses session key if available, otherwise falls back to master secret
     */
    private getSigningSecret;
    /**
     * Get the appropriate secret for verifying incoming messages
     * Tries current key, then pending, then previous, then master
     */
    private getVerificationSecrets;
    /**
     * Application-level admission check for one incoming message.
     *
     * Reserved events bypass it deliberately: the handshake and the heartbeats
     * must survive an allow-list that does not name them, or configuring one
     * would silently sever the connection.
     *
     * This lives in a method because it used to be written out at each place a
     * message can arrive — the authenticated and unauthenticated branches of
     * `initiate()` and of `listen()` — and `listen()`'s unauthenticated branch
     * never got a copy. An embedded bridge configured with an allow-list and no
     * cryptoAuth, which is exactly how de.eui runs it, therefore accepted every
     * event name a host cared to send.
     */
    private acceptIncoming;
    /**
     * Initialize session key exchange
     * Called after connection is established if enableSessionKeys is true
     */
    private initiateSessionKeyExchange;
    /**
     * Handle incoming session key initialization
     */
    private handleSessionKeyInit;
    /**
     * Handle session key acknowledgment
     */
    private handleSessionKeyAck;
    /**
     * Derive and store a session key
     */
    private deriveAndStoreSessionKey;
    /**
     * Start session key rotation timer
     */
    private startSessionKeyRotation;
    /**
     * Rotate session key
     */
    private rotateSessionKey;
    /**
     * Handle incoming session key rotation
     */
    private handleSessionKeyRotate;
    /**
     * Stop session key rotation timer
     */
    private stopSessionKeyRotation;
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
        protocolVersion: number;
        peerProtocolVersion: number | undefined;
        sessionKeyActive: boolean;
        sessionKeyId: string | undefined;
    };
    clearQueue(): this;
}
