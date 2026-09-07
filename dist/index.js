"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Current protocol version
const PROTOCOL_VERSION = 1;
function newObject(data) {
    return JSON.parse(JSON.stringify(data));
}
function getMessageSize(data) {
    try {
        return JSON.stringify(data).length;
    }
    catch {
        return 0;
    }
}
function sanitizePayload(payload, maxSize) {
    if (!payload)
        return payload;
    const size = getMessageSize(payload);
    if (size > maxSize)
        throw new Error(`Message size ${size} exceeds limit ${maxSize}`);
    // Basic sanitization - remove functions and undefined values
    return JSON.parse(JSON.stringify(payload));
}
function constantTimeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let out = 0;
    for (let i = 0; i < a.length; i++)
        out |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return out === 0;
}
function getGlobalCrypto() {
    return (typeof crypto !== 'undefined'
        ? crypto
        : (typeof window !== 'undefined' && window.crypto)
            || (typeof globalThis !== 'undefined' && globalThis.crypto));
}
function randomHex(bytes) {
    try {
        const globalCrypto = getGlobalCrypto();
        if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
            const buf = new Uint8Array(bytes);
            globalCrypto.getRandomValues(buf);
            return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
        }
    }
    catch { }
    // Fallback (NOT cryptographically strong)
    return Array.from({ length: bytes }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
}
async function hmacSha256Base64Url(secret, message) {
    // Browser/WebCrypto
    try {
        const globalCrypto = getGlobalCrypto();
        const subtle = globalCrypto?.subtle;
        if (subtle && typeof subtle.importKey === 'function') {
            const enc = new TextEncoder();
            const key = await subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
            const sig = await subtle.sign('HMAC', key, enc.encode(message));
            const bytes = new Uint8Array(sig);
            const b64 = btoa(String.fromCharCode(...bytes));
            return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        }
    }
    catch {
        // fallthrough to Node implementation
    }
    // Node.js (commonjs) - optional
    try {
        const nodeCrypto = globalThis.__iof_node_crypto
            || (globalThis.__iof_node_crypto = (typeof globalThis.require === 'function'
                ? globalThis.require('crypto')
                : undefined));
        if (!nodeCrypto)
            throw new Error('node crypto unavailable');
        const b64 = nodeCrypto.createHmac('sha256', secret).update(message).digest('base64');
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }
    catch {
        throw new Error('No crypto implementation available for HMAC-SHA256');
    }
}
/**
 * Derive a session key using HKDF-like construction
 * HKDF(masterSecret, salt, info) where:
 * - masterSecret: the shared secret
 * - salt: combined session IDs
 * - info: context string
 */
async function deriveSessionKey(masterSecret, sessionId1, sessionId2, keyId) {
    /**
     * Two HMAC steps, both through `hmacSha256Base64Url`, deliberately.
     *
     * This used to have a WebCrypto branch alongside this one, and the two did
     * not agree: the WebCrypto path fed the extract step's RAW bytes into the
     * expand step and appended \x01 to the info string, while this path fed the
     * base64url TEXT of those bytes and appended nothing. Same inputs, different
     * keys.
     *
     * Peers do not have to share an implementation for that to matter, only an
     * environment: `crypto.subtle` is undefined outside a secure context, so a
     * WebView or iframe served over plain HTTP took one branch while an HTTPS
     * host took the other. Every signed message then failed to verify — and
     * because the WebCrypto branch was also entered from a silent catch, a
     * single transient failure on one side desynchronised the pair for the rest
     * of the connection.
     *
     * `hmacSha256Base64Url` already resolves WebCrypto vs Node internally and
     * returns the same string either way, so deriving through it twice is both
     * shorter and the only version that can agree with itself.
     */
    const salt = sessionId1 + '|' + sessionId2, 
    // Extract: PRK = HMAC( masterSecret, salt )
    prk = await hmacSha256Base64Url(masterSecret, salt), 
    // Expand: OKM = HMAC( PRK, info )
    info = 'iframe.io-session-key-' + keyId;
    return await hmacSha256Base64Url(prk, info);
}
const ackId = () => {
    // Prefer cryptographically strong randomness when available
    try {
        const globalCrypto = getGlobalCrypto();
        if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
            const buffer = new Uint32Array(4);
            globalCrypto.getRandomValues(buffer);
            const randomPart = Array.from(buffer).map(n => n.toString(16)).join('');
            return `${Date.now()}_${randomPart}`;
        }
    }
    catch {
        // Fall back to Math.random-based implementation below
    }
    const rmin = 100000, rmax = 999999, timestampFallback = Date.now(), randomFallback = Math.floor(Math.random() * (rmax - rmin + 1) + rmin);
    return `${timestampFallback}_${randomFallback}`;
};
// Answered before authentication, so they are gated separately — see the
// handlers in initiate() and listen().
const RESERVED_SESSION_KEY_EVENTS = [
    '__session_key_init',
    '__session_key_rotate',
    '__session_key_ack'
];
const RESERVED_EVENTS = [
    'ping',
    'pong',
    '__heartbeat',
    '__heartbeat_response',
    '__session_key_init',
    '__session_key_rotate',
    '__session_key_ack'
];
class IOF {
    constructor(options = {}) {
        this.messageQueue = [];
        this.messageRateTracker = [];
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.seenNonces = new Map();
        if (options && typeof options !== 'object')
            throw new Error('Invalid Options');
        this.options = {
            debug: false,
            heartbeatInterval: 30000,
            connectionTimeout: 10000,
            maxMessageSize: 1024 * 1024,
            maxMessagesPerSecond: 100,
            autoReconnect: true,
            messageQueueSize: 50,
            ...options
        };
        this.Events = {};
        this.peer = { type: 'IFRAME', connected: false };
        if (options.type)
            this.peer.type = options.type.toUpperCase();
    }
    cryptoCfg() {
        if (!this.options.cryptoAuth)
            return undefined;
        return {
            secret: this.options.cryptoAuth.secret,
            requireSigned: !!this.options.cryptoAuth.requireSigned,
            maxSkewMs: this.options.cryptoAuth.maxSkewMs ?? 2 * 60 * 1000,
            replayWindowSize: this.options.cryptoAuth.replayWindowSize ?? 500,
            enableSessionKeys: !!this.options.cryptoAuth.enableSessionKeys,
            sessionKeyRotationInterval: this.options.cryptoAuth.sessionKeyRotationInterval ?? 3600000 // 1 hour
        };
    }
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
    pruneNonces(maxSize) {
        const cutoff = Date.now() - (this.cryptoCfg()?.maxSkewMs ?? 2 * 60 * 1000);
        for (const [nonce, ts] of this.seenNonces)
            if (ts < cutoff)
                this.seenNonces.delete(nonce);
        if (this.seenNonces.size <= maxSize)
            return;
        this.fire('error', {
            type: 'REPLAY_WINDOW_EXCEEDED',
            remembered: this.seenNonces.size,
            maxSize
        });
        // Oldest first — Map iterates in insertion order, and nonces are inserted
        // as they arrive.
        const toRemove = this.seenNonces.size - maxSize;
        let i = 0;
        for (const key of this.seenNonces.keys()) {
            this.seenNonces.delete(key);
            if (++i >= toRemove)
                break;
        }
    }
    /**
     * Get the appropriate secret for signing messages
     * Uses session key if available, otherwise falls back to master secret
     */
    getSigningSecret() {
        const cfg = this.cryptoCfg();
        if (!cfg)
            return { secret: '' };
        // Use session key if enabled and available
        if (cfg.enableSessionKeys && this.currentSessionKey) {
            return {
                secret: this.currentSessionKey.key,
                keyId: this.currentSessionKey.keyId
            };
        }
        // Fall back to master secret
        return { secret: cfg.secret };
    }
    /**
     * Get the appropriate secret for verifying incoming messages
     * Tries current key, then pending, then previous, then master
     */
    getVerificationSecrets() {
        const cfg = this.cryptoCfg();
        if (!cfg)
            return [];
        const secrets = [];
        if (cfg.enableSessionKeys) {
            // Try current session key first
            if (this.currentSessionKey) {
                secrets.push({
                    secret: this.currentSessionKey.key,
                    keyId: this.currentSessionKey.keyId
                });
            }
            // Try pending key during rotation
            if (this.pendingSessionKey) {
                secrets.push({
                    secret: this.pendingSessionKey.key,
                    keyId: this.pendingSessionKey.keyId
                });
            }
            // Try previous key for grace period
            if (this.previousSessionKey) {
                const now = Date.now();
                if (now < this.previousSessionKey.expiresAt) {
                    secrets.push({
                        secret: this.previousSessionKey.key,
                        keyId: this.previousSessionKey.keyId
                    });
                }
            }
        }
        // Always try master secret as fallback
        secrets.push({ secret: cfg.secret });
        return secrets;
    }
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
    acceptIncoming(_event, payload, origin) {
        if (RESERVED_EVENTS.includes(_event))
            return true;
        if (this.options.allowedIncomingEvents
            && !this.options.allowedIncomingEvents.includes(_event)) {
            this.fire('error', {
                type: 'DISALLOWED_EVENT',
                direction: 'incoming',
                event: _event,
                origin
            });
            return false;
        }
        if (this.options.validateIncoming
            && !this.options.validateIncoming(_event, payload, origin)) {
            this.fire('error', {
                type: 'INVALID_MESSAGE',
                direction: 'incoming',
                event: _event,
                origin
            });
            return false;
        }
        return true;
    }
    /**
     * Initialize session key exchange
     * Called after connection is established if enableSessionKeys is true
     */
    async initiateSessionKeyExchange() {
        const cfg = this.cryptoCfg();
        if (!cfg || !cfg.enableSessionKeys)
            return;
        this.debug(`[${this.peer.type}] Initiating session key exchange`);
        // Generate my session ID
        this.mySessionId = randomHex(32);
        // Send session ID to peer
        this.emit('__session_key_init', { sessionId: this.mySessionId });
    }
    /**
     * Handle incoming session key initialization
     */
    async handleSessionKeyInit(peerSessionId) {
        const cfg = this.cryptoCfg();
        if (!cfg || !cfg.enableSessionKeys)
            return;
        this.debug(`[${this.peer.type}] Received session key init from peer`);
        // Generate my session ID if not already done
        if (!this.mySessionId) {
            this.mySessionId = randomHex(32);
        }
        // Store peer session ID
        this.peer.sessionId = peerSessionId;
        // Derive session key
        const keyId = `key-${Date.now()}-${randomHex(8)}`;
        const sessionKey = await this.deriveAndStoreSessionKey(keyId);
        // Send acknowledgment with my session ID
        this.emit('__session_key_ack', {
            sessionId: this.mySessionId,
            keyId: keyId
        });
        this.debug(`[${this.peer.type}] Session key established: ${keyId}`);
        // Start rotation timer
        this.startSessionKeyRotation();
    }
    /**
     * Handle session key acknowledgment
     */
    async handleSessionKeyAck(data) {
        const cfg = this.cryptoCfg();
        if (!cfg || !cfg.enableSessionKeys)
            return;
        this.debug(`[${this.peer.type}] Received session key ack from peer`);
        // Store peer session ID
        this.peer.sessionId = data.sessionId;
        // Derive session key using the same keyId
        await this.deriveAndStoreSessionKey(data.keyId);
        this.debug(`[${this.peer.type}] Session key established: ${data.keyId}`);
        // Start rotation timer
        this.startSessionKeyRotation();
    }
    /**
     * Derive and store a session key
     */
    async deriveAndStoreSessionKey(keyId) {
        const cfg = this.cryptoCfg();
        if (!cfg || !this.mySessionId || !this.peer.sessionId) {
            throw new Error('Cannot derive session key: missing session IDs');
        }
        // Ensure consistent ordering of session IDs
        const [id1, id2] = [this.mySessionId, this.peer.sessionId].sort();
        const key = await deriveSessionKey(cfg.secret, id1, id2, keyId);
        const now = Date.now();
        const sessionKeyInfo = {
            keyId,
            key,
            createdAt: now,
            expiresAt: now + cfg.sessionKeyRotationInterval + 60000 // Grace period of 1 minute
        };
        // Rotate keys: current -> previous, new -> current
        if (this.currentSessionKey) {
            this.previousSessionKey = this.currentSessionKey;
        }
        this.currentSessionKey = sessionKeyInfo;
        this.fire('session_key_established', { keyId });
        return sessionKeyInfo;
    }
    /**
     * Start session key rotation timer
     */
    startSessionKeyRotation() {
        const cfg = this.cryptoCfg();
        if (!cfg || !cfg.enableSessionKeys)
            return;
        // Clear existing timer
        if (this.sessionKeyRotationTimer) {
            clearInterval(this.sessionKeyRotationTimer);
        }
        this.sessionKeyRotationTimer = setInterval(() => {
            this.rotateSessionKey();
        }, cfg.sessionKeyRotationInterval);
        this.debug(`[${this.peer.type}] Session key rotation timer started (${cfg.sessionKeyRotationInterval}ms)`);
    }
    /**
     * Rotate session key
     */
    async rotateSessionKey() {
        const cfg = this.cryptoCfg();
        if (!cfg || !cfg.enableSessionKeys || !this.isConnected())
            return;
        this.debug(`[${this.peer.type}] Rotating session key`);
        const newKeyId = `key-${Date.now()}-${randomHex(8)}`;
        // Derive new key
        const newSessionKey = await this.deriveAndStoreSessionKey(newKeyId);
        // Set as pending until peer acknowledges
        this.pendingSessionKey = newSessionKey;
        // Notify peer of rotation
        this.emit('__session_key_rotate', { keyId: newKeyId });
        this.fire('session_key_rotating', { keyId: newKeyId });
    }
    /**
     * Handle incoming session key rotation
     */
    async handleSessionKeyRotate(data) {
        const cfg = this.cryptoCfg();
        if (!cfg || !cfg.enableSessionKeys)
            return;
        this.debug(`[${this.peer.type}] Peer rotating session key to: ${data.keyId}`);
        // Derive the same key
        await this.deriveAndStoreSessionKey(data.keyId);
        this.fire('session_key_rotated', { keyId: data.keyId });
    }
    /**
     * Stop session key rotation timer
     */
    stopSessionKeyRotation() {
        if (this.sessionKeyRotationTimer) {
            clearInterval(this.sessionKeyRotationTimer);
            this.sessionKeyRotationTimer = undefined;
        }
    }
    async signOutgoing(messageData) {
        const cfg = this.cryptoCfg();
        if (!cfg)
            return undefined;
        const { secret, keyId } = this.getSigningSecret();
        const ts = Date.now();
        const nonce = randomHex(16);
        const canonical = JSON.stringify({
            v: messageData.v,
            _event: messageData._event,
            payload: messageData.payload,
            cid: messageData.cid,
            timestamp: messageData.timestamp,
            size: messageData.size,
            ts,
            nonce
        });
        const sig = await hmacSha256Base64Url(secret, canonical);
        return { alg: 'HMAC-SHA256', ts, nonce, sig, keyId };
    }
    async verifyIncomingAuth(data, origin) {
        const cfg = this.cryptoCfg();
        if (!cfg)
            return true;
        if (!data.auth) {
            return !cfg.requireSigned;
        }
        const { alg, ts, nonce, sig, keyId } = data.auth;
        if (alg !== 'HMAC-SHA256')
            return false;
        if (typeof ts !== 'number' || typeof nonce !== 'string' || typeof sig !== 'string')
            return false;
        const now = Date.now();
        if (Math.abs(now - ts) > cfg.maxSkewMs)
            return false;
        // Replay protection. The nonce is only recorded once the signature has been
        // checked, further down: burning it here let an unsigned or badly signed
        // message consume the nonce of a legitimate one still in flight.
        if (this.seenNonces.has(nonce))
            return false;
        const canonical = JSON.stringify({
            v: data.v,
            _event: data._event,
            payload: data.payload,
            cid: data.cid,
            timestamp: data.timestamp,
            size: data.size,
            ts,
            nonce
        });
        // Try all available secrets
        const secrets = this.getVerificationSecrets();
        for (const { secret, keyId: secretKeyId } of secrets) {
            // If message has keyId, only try matching secret
            if (keyId && secretKeyId && keyId !== secretKeyId)
                continue;
            try {
                const expected = await hmacSha256Base64Url(secret, canonical);
                if (constantTimeEqual(expected, sig)) {
                    this.seenNonces.set(nonce, ts);
                    this.pruneNonces(cfg.replayWindowSize);
                    this.debug(`[${this.peer.type}] Auth verified${keyId ? ` with key: ${keyId}` : ''}`);
                    return true;
                }
            }
            catch (error) {
                this.debug(`[${this.peer.type}] Auth verification error:`, error);
            }
        }
        return false;
    }
    debug(...args) {
        this.options.debug && console.debug(...args);
    }
    isConnected() {
        return !!this.peer.connected && !!this.peer.source;
    }
    // Enhanced connection health monitoring
    startHeartbeat() {
        if (!this.options.heartbeatInterval)
            return;
        this.heartbeatTimer = setInterval(() => {
            if (this.isConnected()) {
                const now = Date.now();
                // Check if peer is still responsive
                if (this.peer.lastHeartbeat
                    && (now - this.peer.lastHeartbeat) > (this.options.heartbeatInterval * 2)) {
                    this.debug(`[${this.peer.type}] Heartbeat timeout detected`);
                    this.handleConnectionLoss();
                    return;
                }
                // Send heartbeat
                try {
                    this.emit('__heartbeat', { timestamp: now });
                }
                catch (error) {
                    this.debug(`[${this.peer.type}] Heartbeat send failed:`, error);
                    this.handleConnectionLoss();
                }
            }
        }, this.options.heartbeatInterval);
    }
    stopHeartbeat() {
        if (!this.heartbeatTimer)
            return;
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
    }
    // Handle connection loss and potential reconnection
    handleConnectionLoss() {
        if (!this.peer.connected)
            return;
        this.peer.connected = false;
        this.stopHeartbeat();
        this.stopSessionKeyRotation();
        this.fire('disconnect', { reason: 'CONNECTION_LOST' });
        this.options.autoReconnect
            && this.reconnectAttempts < this.maxReconnectAttempts
            && this.attemptReconnection();
    }
    attemptReconnection() {
        if (this.reconnectTimer)
            return;
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000); // Exponential backoff, max 30s
        this.debug(`[${this.peer.type}] Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
        this.fire('reconnecting', { attempt: this.reconnectAttempts, delay });
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            // Re-initiate connection for WINDOW type
            this.peer.type === 'WINDOW'
                && this.peer.source
                && this.peer.origin
                && this.emit('ping');
            // For IFRAME type, just wait for incoming connection
            // Set timeout for this reconnection attempt
            setTimeout(() => {
                if (this.peer.connected)
                    return;
                this.reconnectAttempts < this.maxReconnectAttempts
                    ? this.attemptReconnection()
                    : this.fire('reconnection_failed', { attempts: this.reconnectAttempts });
            }, this.options.connectionTimeout);
        }, delay);
    }
    // Message rate limiting
    checkRateLimit() {
        if (!this.options.maxMessagesPerSecond)
            return true;
        const now = Date.now(), aSecondAgo = now - 1000;
        // Clean old entries
        this.messageRateTracker = this.messageRateTracker.filter(timestamp => timestamp > aSecondAgo);
        // Check if limit exceeded
        if (this.messageRateTracker.length >= this.options.maxMessagesPerSecond) {
            this.fire('error', {
                type: 'RATE_LIMIT_EXCEEDED',
                limit: this.options.maxMessagesPerSecond,
                current: this.messageRateTracker.length
            });
            return false;
        }
        this.messageRateTracker.push(now);
        return true;
    }
    // Queue messages when not connected
    queueMessage(_event, payload, fn) {
        if (this.messageQueue.length >= this.options.messageQueueSize) {
            // Remove oldest message
            const removed = this.messageQueue.shift();
            this.debug(`[${this.peer.type}] Message queue full, removed oldest message:`, removed?._event);
        }
        this.messageQueue.push({
            _event,
            payload,
            fn,
            timestamp: Date.now()
        });
        this.debug(`[${this.peer.type}] Queued message: ${_event} (queue size: ${this.messageQueue.length})`);
    }
    // Process queued messages when connection is established
    processMessageQueue() {
        if (!this.isConnected() || this.messageQueue.length === 0)
            return;
        this.debug(`[${this.peer.type}] Processing ${this.messageQueue.length} queued messages`);
        const queue = [...this.messageQueue];
        this.messageQueue = [];
        queue.forEach(message => {
            try {
                this.emit(message._event, message.payload, message.fn);
            }
            catch (error) {
                this.debug(`[${this.peer.type}] Failed to send queued message:`, error);
            }
        });
    }
    /**
     * Establish a connection with an iframe containing
     * in the current window
     */
    initiate(contentWindow, iframeOrigin) {
        if (!contentWindow || !iframeOrigin)
            throw new Error('Invalid Connection initiation arguments');
        if (this.peer.type === 'IFRAME')
            throw new Error('Expect IFRAME to <listen> and WINDOW to <initiate> a connection');
        // Clean up existing listener if any
        this.cleanup();
        this.peer.source = contentWindow;
        this.peer.origin = iframeOrigin;
        this.peer.connected = false;
        this.reconnectAttempts = 0;
        this.messageListener = ({ origin, data, source }) => {
            try {
                // Enhanced security: check valid message structure
                if (origin !== this.peer.origin
                    || !source
                    || typeof data !== 'object'
                    || !data.hasOwnProperty('_event'))
                    return;
                const { v, _event, payload, cid, timestamp, sessionId } = data;
                // Protocol version check
                const messageVersion = v || 1;
                if (messageVersion > PROTOCOL_VERSION) {
                    this.fire('error', {
                        type: 'UNSUPPORTED_VERSION',
                        received: messageVersion,
                        supported: PROTOCOL_VERSION
                    });
                    return;
                }
                // Store peer protocol version
                if (!this.peer.protocolVersion || this.peer.protocolVersion < messageVersion) {
                    this.peer.protocolVersion = messageVersion;
                }
                /**
                 * Session key control events.
                 *
                 * These are answered before authentication — they are what establishes
                 * the key authentication will use — so they are gated on the feature
                 * actually being switched on. Without that, a peer that never enabled
                 * session keys would still derive and rotate them on request, and a
                 * malformed payload would throw out of the handler.
                 */
                if (RESERVED_SESSION_KEY_EVENTS.includes(_event)) {
                    if (!this.cryptoCfg()?.enableSessionKeys) {
                        this.fire('error', { type: 'SESSION_KEYS_DISABLED', event: _event, origin });
                        return;
                    }
                    if (!payload || typeof payload !== 'object') {
                        this.fire('error', { type: 'MALFORMED_SESSION_KEY_EVENT', event: _event, origin });
                        return;
                    }
                    if (_event === '__session_key_init')
                        this.handleSessionKeyInit(payload.sessionId);
                    else if (_event === '__session_key_ack')
                        this.handleSessionKeyAck(payload);
                    else
                        this.handleSessionKeyRotate(payload);
                    return;
                }
                // Handle heartbeat responses
                if (_event === '__heartbeat_response') {
                    this.peer.lastHeartbeat = Date.now();
                    return;
                }
                // Handle heartbeat requests
                if (_event === '__heartbeat') {
                    this.emit('__heartbeat_response', { timestamp: Date.now() });
                    this.peer.lastHeartbeat = Date.now();
                    return;
                }
                this.debug(`[${this.peer.type}] Message v${messageVersion}: ${_event}`, payload || '');
                // Handshake or availability check events
                if (_event == 'pong') {
                    // Content Window is connected to iframe
                    this.peer.connected = true;
                    this.reconnectAttempts = 0;
                    this.peer.lastHeartbeat = Date.now();
                    this.startHeartbeat();
                    this.fire('connect');
                    // Initiate session key exchange if enabled
                    this.initiateSessionKeyExchange();
                    this.processMessageQueue();
                    this.debug(`[${this.peer.type}] connected`);
                    return;
                }
                // Cryptographic authentication (optional)
                if (this.options.cryptoAuth) {
                    this.verifyIncomingAuth(data, origin)
                        .then(ok => {
                        if (!ok) {
                            this.fire('error', { type: 'AUTH_FAILED', origin, event: _event });
                            return;
                        }
                        if (!this.acceptIncoming(_event, payload, origin))
                            return;
                        this.fire(_event, payload, cid);
                    })
                        .catch(error => this.fire('error', { type: 'AUTH_ERROR', origin, event: _event, error: String(error) }));
                    return;
                }
                if (!this.acceptIncoming(_event, payload, origin))
                    return;
                // Fire available event listeners
                this.fire(_event, payload, cid);
            }
            catch (error) {
                this.debug(`[${this.peer.type}] Message handling error:`, error);
                this.fire('error', {
                    type: 'MESSAGE_HANDLING_ERROR',
                    error: error instanceof Error ? error.message : String(error),
                    origin
                });
            }
        };
        window.addEventListener('message', this.messageListener, false);
        this.debug(`[${this.peer.type}] Initiate connection: IFrame origin <${iframeOrigin}>`);
        this.emit('ping');
        return this;
    }
    /**
     * Listening to connection from the content window
     */
    listen(hostOrigin) {
        this.peer.type = 'IFRAME'; // iframe.io connection listener is automatically set as IFRAME
        this.peer.connected = false;
        this.reconnectAttempts = 0;
        this.debug(`[${this.peer.type}] Listening to connect${hostOrigin ? `: Host <${hostOrigin}>` : ''}`);
        // Clean up existing listener if any
        this.cleanup();
        this.messageListener = ({ origin, data, source }) => {
            try {
                // Enhanced security: check host origin where event must only come from
                if (hostOrigin && hostOrigin !== origin) {
                    this.fire('error', {
                        type: 'INVALID_ORIGIN',
                        expected: hostOrigin,
                        received: origin
                    });
                    return;
                }
                // Enhanced security: check valid message structure
                if (!source
                    || typeof data !== 'object'
                    || !data.hasOwnProperty('_event'))
                    return;
                // Define peer source window and origin
                if (!this.peer.source) {
                    this.peer = { ...this.peer, source: source, origin };
                    this.debug(`[${this.peer.type}] Connect to ${origin}`);
                }
                // Origin different from handshaked source origin
                else if (origin !== this.peer.origin) {
                    this.fire('error', {
                        type: 'ORIGIN_MISMATCH',
                        expected: this.peer.origin,
                        received: origin
                    });
                    return;
                }
                const { v, _event, payload, cid, timestamp } = data;
                // Protocol version check
                const messageVersion = v || 1;
                if (messageVersion > PROTOCOL_VERSION) {
                    this.fire('error', {
                        type: 'UNSUPPORTED_VERSION',
                        received: messageVersion,
                        supported: PROTOCOL_VERSION
                    });
                    return;
                }
                // Store peer protocol version
                if (!this.peer.protocolVersion || this.peer.protocolVersion < messageVersion) {
                    this.peer.protocolVersion = messageVersion;
                }
                /**
                 * Session key control events.
                 *
                 * These are answered before authentication — they are what establishes
                 * the key authentication will use — so they are gated on the feature
                 * actually being switched on. Without that, a peer that never enabled
                 * session keys would still derive and rotate them on request, and a
                 * malformed payload would throw out of the handler.
                 */
                if (RESERVED_SESSION_KEY_EVENTS.includes(_event)) {
                    if (!this.cryptoCfg()?.enableSessionKeys) {
                        this.fire('error', { type: 'SESSION_KEYS_DISABLED', event: _event, origin });
                        return;
                    }
                    if (!payload || typeof payload !== 'object') {
                        this.fire('error', { type: 'MALFORMED_SESSION_KEY_EVENT', event: _event, origin });
                        return;
                    }
                    if (_event === '__session_key_init')
                        this.handleSessionKeyInit(payload.sessionId);
                    else if (_event === '__session_key_ack')
                        this.handleSessionKeyAck(payload);
                    else
                        this.handleSessionKeyRotate(payload);
                    return;
                }
                // Handle heartbeat responses
                if (_event === '__heartbeat_response') {
                    this.peer.lastHeartbeat = Date.now();
                    return;
                }
                // Handle heartbeat requests
                if (_event === '__heartbeat') {
                    this.emit('__heartbeat_response', { timestamp: Date.now() });
                    this.peer.lastHeartbeat = Date.now();
                    return;
                }
                this.debug(`[${this.peer.type}] Message v${messageVersion}: ${_event}`, payload || '');
                // Handshake or availability check events
                if (_event == 'ping') {
                    this.emit('pong');
                    // Iframe is connected to content window
                    this.peer.connected = true;
                    this.reconnectAttempts = 0;
                    this.peer.lastHeartbeat = Date.now();
                    this.startHeartbeat();
                    this.fire('connect');
                    // Initiate session key exchange if enabled
                    this.initiateSessionKeyExchange();
                    this.processMessageQueue();
                    this.debug(`[${this.peer.type}] connected`);
                    return;
                }
                // Cryptographic authentication (optional)
                if (this.options.cryptoAuth) {
                    this.verifyIncomingAuth(data, origin)
                        .then(ok => {
                        if (!ok) {
                            this.fire('error', { type: 'AUTH_FAILED', origin, event: _event });
                            return;
                        }
                        if (!this.acceptIncoming(_event, payload, origin))
                            return;
                        this.fire(_event, payload, cid);
                    })
                        .catch(error => this.fire('error', { type: 'AUTH_ERROR', origin, event: _event, error: String(error) }));
                    return;
                }
                if (!this.acceptIncoming(_event, payload, origin))
                    return;
                // Fire available event listeners
                this.fire(_event, payload, cid);
            }
            catch (error) {
                this.debug(`[${this.peer.type}] Message handling error:`, error);
                this.fire('error', {
                    type: 'MESSAGE_HANDLING_ERROR',
                    error: error instanceof Error ? error.message : String(error),
                    origin
                });
            }
        };
        window.addEventListener('message', this.messageListener, false);
        return this;
    }
    fire(_event, payload, cid) {
        // Volatile event - check if any listeners exist
        if (!this.Events[_event] && !this.Events[_event + '--@once']) {
            this.debug(`[${this.peer.type}] No <${_event}> listener defined`);
            return;
        }
        const ackFn = cid
            ? (error, ...args) => {
                this.emit(`${_event}--${cid}--@ack`, { error: error || false, args });
                return;
            }
            : undefined;
        let listeners = [];
        if (this.Events[_event + '--@once']) {
            // Once triggable event
            _event += '--@once';
            listeners = this.Events[_event];
            // Delete once event listeners after fired
            delete this.Events[_event];
        }
        else
            listeners = this.Events[_event];
        // Fire listeners with error handling
        listeners.forEach(fn => {
            try {
                payload !== undefined ? fn(payload, ackFn) : fn(ackFn);
            }
            catch (error) {
                this.debug(`[${this.peer.type}] Listener error for ${_event}:`, error);
                this.fire('error', {
                    type: 'LISTENER_ERROR',
                    event: _event,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
    }
    emit(_event, payload, fn) {
        // Check rate limiting
        if (!this.checkRateLimit())
            return this;
        /**
         * Queue message if not connected: Except for
         * connection-related events
         */
        if (!this.isConnected() && !RESERVED_EVENTS.includes(_event)) {
            this.queueMessage(_event, payload, fn);
            return this;
        }
        if (!this.peer.source) {
            this.fire('error', { type: 'NO_CONNECTION', event: _event });
            return this;
        }
        if (typeof payload == 'function') {
            fn = payload;
            payload = undefined;
        }
        try {
            // Enhanced security: sanitize and validate payload
            const sanitizedPayload = payload
                ? sanitizePayload(payload, this.options.maxMessageSize)
                : payload;
            // Acknowledge event listener
            let cid;
            if (typeof fn === 'function') {
                const ackFunction = fn;
                cid = ackId();
                this.once(`${_event}--${cid}--@ack`, ({ error, args }) => ackFunction(error, ...args));
            }
            const messageData = {
                v: PROTOCOL_VERSION,
                _event,
                payload: sanitizedPayload,
                cid,
                timestamp: Date.now(),
                size: getMessageSize(sanitizedPayload)
            };
            this.peer.source.postMessage(newObject(messageData), this.peer.origin);
        }
        catch (error) {
            this.debug(`[${this.peer.type}] Emit error:`, error);
            this.fire('error', {
                type: 'EMIT_ERROR',
                event: _event,
                error: error instanceof Error ? error.message : String(error)
            });
            // Call acknowledgment with error if provided
            typeof fn === 'function'
                && fn(error instanceof Error ? error.message : String(error));
        }
        return this;
    }
    /**
     * Send a signed message (HMAC-SHA256) when `options.cryptoAuth` is configured.
     * This is async because WebCrypto signing is async.
     */
    async emitSigned(_event, payload, fn) {
        // Check rate limiting
        if (!this.checkRateLimit())
            return this;
        if (!this.options.cryptoAuth) {
            // If auth not enabled, fall back to normal emit behavior
            this.emit(_event, payload, fn);
            return this;
        }
        if (!this.isConnected() && !RESERVED_EVENTS.includes(_event)) {
            this.queueMessage(_event, payload, fn);
            return this;
        }
        if (!this.peer.source) {
            this.fire('error', { type: 'NO_CONNECTION', event: _event });
            return this;
        }
        if (typeof payload == 'function') {
            fn = payload;
            payload = undefined;
        }
        try {
            const sanitizedPayload = payload
                ? sanitizePayload(payload, this.options.maxMessageSize)
                : payload;
            let cid;
            if (typeof fn === 'function') {
                const ackFunction = fn;
                cid = ackId();
                this.once(`${_event}--${cid}--@ack`, ({ error, args }) => ackFunction(error, ...args));
            }
            const unsigned = {
                v: PROTOCOL_VERSION,
                _event,
                payload: sanitizedPayload,
                cid,
                timestamp: Date.now(),
                size: getMessageSize(sanitizedPayload)
            };
            const auth = await this.signOutgoing(unsigned);
            const messageData = { ...unsigned, auth };
            this.peer.source.postMessage(newObject(messageData), this.peer.origin);
        }
        catch (error) {
            this.debug(`[${this.peer.type}] EmitSigned error:`, error);
            this.fire('error', {
                type: 'EMIT_ERROR',
                event: _event,
                error: error instanceof Error ? error.message : String(error)
            });
            typeof fn === 'function'
                && fn(error instanceof Error ? error.message : String(error));
        }
        return this;
    }
    async emitAsyncSigned(_event, payload, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => reject(new Error(`Event '${_event}' acknowledgment timeout after ${timeout}ms`)), timeout);
            this.emitSigned(_event, payload, (error, ...args) => {
                clearTimeout(timeoutId);
                error
                    ? reject(new Error(typeof error === 'string' ? error : 'Ack error'))
                    : resolve(args.length === 0 ? undefined : args.length === 1 ? args[0] : args);
            }).catch(err => {
                clearTimeout(timeoutId);
                reject(err);
            });
        });
    }
    on(_event, fn) {
        // Add Event listener
        if (!this.Events[_event])
            this.Events[_event] = [];
        this.Events[_event].push(fn);
        this.debug(`[${this.peer.type}] New <${_event}> listener on`);
        return this;
    }
    once(_event, fn) {
        // Add Once Event listener
        _event += '--@once';
        if (!this.Events[_event])
            this.Events[_event] = [];
        this.Events[_event].push(fn);
        this.debug(`[${this.peer.type}] New <${_event} once> listener on`);
        return this;
    }
    off(_event, fn) {
        // Remove Event listener
        if (fn && this.Events[_event]) {
            // Remove specific listener if provided
            const index = this.Events[_event].indexOf(fn);
            if (index > -1) {
                this.Events[_event].splice(index, 1);
                // Remove event array if empty
                if (this.Events[_event].length === 0)
                    delete this.Events[_event];
            }
        }
        // Remove all listeners for event
        else
            delete this.Events[_event];
        typeof fn == 'function' && fn();
        this.debug(`[${this.peer.type}] <${_event}> listener off`);
        return this;
    }
    removeListeners(fn) {
        // Clear all event listeners
        this.Events = {};
        typeof fn == 'function' && fn();
        this.debug(`[${this.peer.type}] All listeners removed`);
        return this;
    }
    emitAsync(_event, payload, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Event '${_event}' acknowledgment timeout after ${timeout}ms`));
            }, timeout);
            try {
                this.emit(_event, payload, (error, ...args) => {
                    clearTimeout(timeoutId);
                    error
                        ? reject(new Error(typeof error === 'string' ? error : 'Ack error'))
                        : resolve(args.length === 0 ? undefined : args.length === 1 ? args[0] : args);
                });
            }
            catch (error) {
                clearTimeout(timeoutId);
                reject(error);
            }
        });
    }
    onceAsync(_event) {
        return new Promise(resolve => this.once(_event, resolve));
    }
    connectAsync(timeout) {
        return new Promise((resolve, reject) => {
            if (this.isConnected())
                return resolve();
            const timeoutId = setTimeout(() => {
                this.off('connect', connectHandler);
                reject(new Error('Connection timeout'));
            }, timeout || this.options.connectionTimeout);
            const connectHandler = () => {
                clearTimeout(timeoutId);
                resolve();
            };
            this.once('connect', connectHandler);
        });
    }
    // Clean up all resources
    cleanup() {
        if (this.messageListener) {
            window.removeEventListener('message', this.messageListener);
            this.messageListener = undefined;
        }
        this.stopHeartbeat();
        this.stopSessionKeyRotation();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }
    disconnect(fn) {
        // Cleanup on disconnect
        this.cleanup();
        this.peer.connected = false;
        this.peer.source = undefined;
        this.peer.origin = undefined;
        this.peer.lastHeartbeat = undefined;
        this.peer.protocolVersion = undefined;
        this.peer.sessionId = undefined;
        this.messageQueue = [];
        this.messageRateTracker = [];
        this.reconnectAttempts = 0;
        // Clear session keys
        this.currentSessionKey = undefined;
        this.pendingSessionKey = undefined;
        this.previousSessionKey = undefined;
        this.mySessionId = undefined;
        this.removeListeners();
        typeof fn == 'function' && fn();
        this.debug(`[${this.peer.type}] Disconnected`);
        return this;
    }
    // Get connection statistics
    getStats() {
        return {
            connected: this.isConnected(),
            peerType: this.peer.type,
            origin: this.peer.origin,
            lastHeartbeat: this.peer.lastHeartbeat,
            queuedMessages: this.messageQueue.length,
            reconnectAttempts: this.reconnectAttempts,
            activeListeners: Object.keys(this.Events).length,
            messageRate: this.messageRateTracker.length,
            protocolVersion: PROTOCOL_VERSION,
            peerProtocolVersion: this.peer.protocolVersion,
            sessionKeyActive: !!this.currentSessionKey,
            sessionKeyId: this.currentSessionKey?.keyId
        };
    }
    // Clear message queue manually
    clearQueue() {
        const queueSize = this.messageQueue.length;
        this.messageQueue = [];
        this.debug(`[${this.peer.type}] Cleared ${queueSize} queued messages`);
        return this;
    }
}
exports.default = IOF;
