"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
function newObject(data) {
    return JSON.parse(JSON.stringify(data));
}
function getMessageSize(data) {
    try {
        return JSON.stringify(data).length;
    }
    catch (_a) {
        return 0;
    }
}
function sanitizePayload(payload, maxSize) {
    if (!payload)
        return payload;
    var size = getMessageSize(payload);
    if (size > maxSize) {
        throw new Error("Message size ".concat(size, " exceeds limit ").concat(maxSize));
    }
    // Basic sanitization - remove functions and undefined values
    return JSON.parse(JSON.stringify(payload));
}
var ackId = function () {
    var rmin = 100000, rmax = 999999;
    var timestamp = Date.now();
    var random = Math.floor(Math.random() * (rmax - rmin + 1) + rmin);
    return "".concat(timestamp, "_").concat(random);
};
var IOF = /** @class */ (function () {
    function IOF(options) {
        if (options === void 0) { options = {}; }
        this.messageQueue = [];
        this.messageRateTracker = [];
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        if (options && typeof options !== 'object')
            throw new Error('Invalid Options');
        this.options = __assign({ debug: false, heartbeatInterval: 30000, connectionTimeout: 10000, maxMessageSize: 1024 * 1024, maxMessagesPerSecond: 100, autoReconnect: true, messageQueueSize: 50 }, options);
        this.Events = {};
        this.peer = { type: 'IFRAME', connected: false };
        if (options.type)
            this.peer.type = options.type.toUpperCase();
    }
    IOF.prototype.debug = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        this.options.debug && console.debug.apply(console, args);
    };
    IOF.prototype.isConnected = function () {
        return !!this.peer.connected && !!this.peer.source;
    };
    // Enhanced connection health monitoring
    IOF.prototype.startHeartbeat = function () {
        var _this = this;
        if (!this.options.heartbeatInterval)
            return;
        this.heartbeatTimer = setInterval(function () {
            if (_this.isConnected()) {
                var now = Date.now();
                // Check if peer is still responsive
                if (_this.peer.lastHeartbeat && (now - _this.peer.lastHeartbeat) > (_this.options.heartbeatInterval * 2)) {
                    _this.debug("[".concat(_this.peer.type, "] Heartbeat timeout detected"));
                    _this.handleConnectionLoss();
                    return;
                }
                // Send heartbeat
                try {
                    _this.emit('__heartbeat', { timestamp: now });
                }
                catch (error) {
                    _this.debug("[".concat(_this.peer.type, "] Heartbeat send failed:"), error);
                    _this.handleConnectionLoss();
                }
            }
        }, this.options.heartbeatInterval);
    };
    IOF.prototype.stopHeartbeat = function () {
        if (!this.heartbeatTimer)
            return;
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
    };
    // Handle connection loss and potential reconnection
    IOF.prototype.handleConnectionLoss = function () {
        if (!this.peer.connected)
            return;
        this.peer.connected = false;
        this.stopHeartbeat();
        this.fire('disconnect', { reason: 'CONNECTION_LOST' });
        this.options.autoReconnect
            && this.reconnectAttempts < this.maxReconnectAttempts
            && this.attemptReconnection();
    };
    IOF.prototype.attemptReconnection = function () {
        var _this = this;
        if (this.reconnectTimer)
            return;
        this.reconnectAttempts++;
        var delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000); // Exponential backoff, max 30s
        this.debug("[".concat(this.peer.type, "] Attempting reconnection ").concat(this.reconnectAttempts, "/").concat(this.maxReconnectAttempts, " in ").concat(delay, "ms"));
        this.fire('reconnecting', { attempt: this.reconnectAttempts, delay: delay });
        this.reconnectTimer = setTimeout(function () {
            _this.reconnectTimer = undefined;
            // Re-initiate connection for WINDOW type
            _this.peer.type === 'WINDOW'
                && _this.peer.source
                && _this.peer.origin
                && _this.emit('ping');
            // For IFRAME type, just wait for incoming connection
            // Set timeout for this reconnection attempt
            setTimeout(function () {
                if (!_this.peer.connected) {
                    _this.reconnectAttempts < _this.maxReconnectAttempts
                        ? _this.attemptReconnection()
                        : _this.fire('reconnection_failed', { attempts: _this.reconnectAttempts });
                }
            }, _this.options.connectionTimeout);
        }, delay);
    };
    // Message rate limiting
    IOF.prototype.checkRateLimit = function () {
        if (!this.options.maxMessagesPerSecond)
            return true;
        var now = Date.now(), aSecondAgo = now - 1000;
        // Clean old entries
        this.messageRateTracker = this.messageRateTracker.filter(function (timestamp) { return timestamp > aSecondAgo; });
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
    };
    // Queue messages when not connected
    IOF.prototype.queueMessage = function (_event, payload, fn) {
        if (this.messageQueue.length >= this.options.messageQueueSize) {
            // Remove oldest message
            var removed = this.messageQueue.shift();
            this.debug("[".concat(this.peer.type, "] Message queue full, removed oldest message:"), removed === null || removed === void 0 ? void 0 : removed._event);
        }
        this.messageQueue.push({
            _event: _event,
            payload: payload,
            fn: fn,
            timestamp: Date.now()
        });
        this.debug("[".concat(this.peer.type, "] Queued message: ").concat(_event, " (queue size: ").concat(this.messageQueue.length, ")"));
    };
    // Process queued messages when connection is established
    IOF.prototype.processMessageQueue = function () {
        var _this = this;
        if (!this.isConnected() || this.messageQueue.length === 0)
            return;
        this.debug("[".concat(this.peer.type, "] Processing ").concat(this.messageQueue.length, " queued messages"));
        var queue = __spreadArray([], this.messageQueue, true);
        this.messageQueue = [];
        queue.forEach(function (message) {
            try {
                _this.emit(message._event, message.payload, message.fn);
            }
            catch (error) {
                _this.debug("[".concat(_this.peer.type, "] Failed to send queued message:"), error);
            }
        });
    };
    /**
     * Establish a connection with an iframe containing
     * in the current window
     */
    IOF.prototype.initiate = function (contentWindow, iframeOrigin) {
        var _this = this;
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
        this.messageListener = function (_a) {
            var origin = _a.origin, data = _a.data, source = _a.source;
            try {
                // Enhanced security: check valid message structure
                if (origin !== _this.peer.origin
                    || !source
                    || typeof data !== 'object'
                    || !data.hasOwnProperty('_event'))
                    return;
                var _b = data, _event = _b._event, payload = _b.payload, cid = _b.cid, timestamp = _b.timestamp;
                // Handle heartbeat responses
                if (_event === '__heartbeat_response') {
                    _this.peer.lastHeartbeat = Date.now();
                    return;
                }
                // Handle heartbeat requests
                if (_event === '__heartbeat') {
                    _this.emit('__heartbeat_response', { timestamp: Date.now() });
                    _this.peer.lastHeartbeat = Date.now();
                    return;
                }
                _this.debug("[".concat(_this.peer.type, "] Message: ").concat(_event), payload || '');
                // Handshake or availability check events
                if (_event == 'pong') {
                    // Content Window is connected to iframe
                    _this.peer.connected = true;
                    _this.reconnectAttempts = 0;
                    _this.peer.lastHeartbeat = Date.now();
                    _this.startHeartbeat();
                    _this.fire('connect');
                    _this.processMessageQueue();
                    return _this.debug("[".concat(_this.peer.type, "] connected"));
                }
                // Fire available event listeners
                _this.fire(_event, payload, cid);
            }
            catch (error) {
                _this.debug("[".concat(_this.peer.type, "] Message handling error:"), error);
                _this.fire('error', {
                    type: 'MESSAGE_HANDLING_ERROR',
                    error: error instanceof Error ? error.message : String(error),
                    origin: origin
                });
            }
        };
        window.addEventListener('message', this.messageListener, false);
        this.debug("[".concat(this.peer.type, "] Initiate connection: IFrame origin <").concat(iframeOrigin, ">"));
        this.emit('ping');
        return this;
    };
    /**
     * Listening to connection from the content window
     */
    IOF.prototype.listen = function (hostOrigin) {
        var _this = this;
        this.peer.type = 'IFRAME'; // iframe.io connection listener is automatically set as IFRAME
        this.peer.connected = false;
        this.reconnectAttempts = 0;
        this.debug("[".concat(this.peer.type, "] Listening to connect").concat(hostOrigin ? ": Host <".concat(hostOrigin, ">") : ''));
        // Clean up existing listener if any
        this.cleanup();
        this.messageListener = function (_a) {
            var origin = _a.origin, data = _a.data, source = _a.source;
            try {
                // Enhanced security: check host origin where event must only come from
                if (hostOrigin && hostOrigin !== origin) {
                    _this.fire('error', { type: 'INVALID_ORIGIN', expected: hostOrigin, received: origin });
                    return;
                }
                // Enhanced security: check valid message structure
                if (!source
                    || typeof data !== 'object'
                    || !data.hasOwnProperty('_event'))
                    return;
                // Define peer source window and origin
                if (!_this.peer.source) {
                    _this.peer = __assign(__assign({}, _this.peer), { source: source, origin: origin });
                    _this.debug("[".concat(_this.peer.type, "] Connect to ").concat(origin));
                }
                // Origin different from handshaked source origin
                else if (origin !== _this.peer.origin) {
                    _this.fire('error', { type: 'ORIGIN_MISMATCH', expected: _this.peer.origin, received: origin });
                    return;
                }
                var _event = data._event, payload = data.payload, cid = data.cid, timestamp = data.timestamp;
                // Handle heartbeat responses
                if (_event === '__heartbeat_response') {
                    _this.peer.lastHeartbeat = Date.now();
                    return;
                }
                // Handle heartbeat requests
                if (_event === '__heartbeat') {
                    _this.emit('__heartbeat_response', { timestamp: Date.now() });
                    _this.peer.lastHeartbeat = Date.now();
                    return;
                }
                _this.debug("[".concat(_this.peer.type, "] Message: ").concat(_event), payload || '');
                // Handshake or availability check events
                if (_event == 'ping') {
                    _this.emit('pong');
                    // Iframe is connected to content window
                    _this.peer.connected = true;
                    _this.reconnectAttempts = 0;
                    _this.peer.lastHeartbeat = Date.now();
                    _this.startHeartbeat();
                    _this.fire('connect');
                    _this.processMessageQueue();
                    return _this.debug("[".concat(_this.peer.type, "] connected"));
                }
                // Fire available event listeners
                _this.fire(_event, payload, cid);
            }
            catch (error) {
                _this.debug("[".concat(_this.peer.type, "] Message handling error:"), error);
                _this.fire('error', {
                    type: 'MESSAGE_HANDLING_ERROR',
                    error: error instanceof Error ? error.message : String(error),
                    origin: origin
                });
            }
        };
        window.addEventListener('message', this.messageListener, false);
        return this;
    };
    IOF.prototype.fire = function (_event, payload, cid) {
        var _this = this;
        // Volatile event - check if any listeners exist
        if (!this.Events[_event]
            && !this.Events[_event + '--@once'])
            return this.debug("[".concat(this.peer.type, "] No <").concat(_event, "> listener defined"));
        var ackFn = cid
            ? function (error) {
                var args = [];
                for (var _i = 1; _i < arguments.length; _i++) {
                    args[_i - 1] = arguments[_i];
                }
                _this.emit("".concat(_event, "--").concat(cid, "--@ack"), { error: error || false, args: args });
                return;
            }
            : undefined;
        var listeners = [];
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
        listeners.forEach(function (fn) {
            try {
                payload !== undefined ? fn(payload, ackFn) : fn(ackFn);
            }
            catch (error) {
                _this.debug("[".concat(_this.peer.type, "] Listener error for ").concat(_event, ":"), error);
                _this.fire('error', {
                    type: 'LISTENER_ERROR',
                    event: _event,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
    };
    IOF.prototype.emit = function (_event, payload, fn) {
        // Check rate limiting
        if (!this.checkRateLimit())
            return this;
        // Queue message if not connected (except for connection-related events)
        if (!this.isConnected() && !['ping', 'pong', '__heartbeat', '__heartbeat_response'].includes(_event)) {
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
            var sanitizedPayload = payload ? sanitizePayload(payload, this.options.maxMessageSize) : payload;
            // Acknowledge event listener
            var cid = void 0;
            if (typeof fn === 'function') {
                var ackFunction_1 = fn;
                cid = ackId();
                this.once("".concat(_event, "--").concat(cid, "--@ack"), function (_a) {
                    var error = _a.error, args = _a.args;
                    return ackFunction_1.apply(void 0, __spreadArray([error], args, false));
                });
            }
            var messageData = {
                _event: _event,
                payload: sanitizedPayload,
                cid: cid,
                timestamp: Date.now(),
                size: getMessageSize(sanitizedPayload)
            };
            this.peer.source.postMessage(newObject(messageData), this.peer.origin);
        }
        catch (error) {
            this.debug("[".concat(this.peer.type, "] Emit error:"), error);
            this.fire('error', {
                type: 'EMIT_ERROR',
                event: _event,
                error: error instanceof Error ? error.message : String(error)
            });
            // Call acknowledgment with error if provided
            if (typeof fn === 'function') {
                fn(error instanceof Error ? error.message : String(error));
            }
        }
        return this;
    };
    IOF.prototype.on = function (_event, fn) {
        // Add Event listener
        if (!this.Events[_event])
            this.Events[_event] = [];
        this.Events[_event].push(fn);
        this.debug("[".concat(this.peer.type, "] New <").concat(_event, "> listener on"));
        return this;
    };
    IOF.prototype.once = function (_event, fn) {
        // Add Once Event listener
        _event += '--@once';
        if (!this.Events[_event])
            this.Events[_event] = [];
        this.Events[_event].push(fn);
        this.debug("[".concat(this.peer.type, "] New <").concat(_event, " once> listener on"));
        return this;
    };
    IOF.prototype.off = function (_event, fn) {
        // Remove Event listener
        if (fn && this.Events[_event]) {
            // Remove specific listener if provided
            var index = this.Events[_event].indexOf(fn);
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
        this.debug("[".concat(this.peer.type, "] <").concat(_event, "> listener off"));
        return this;
    };
    IOF.prototype.removeListeners = function (fn) {
        // Clear all event listeners
        this.Events = {};
        typeof fn == 'function' && fn();
        this.debug("[".concat(this.peer.type, "] All listeners removed"));
        return this;
    };
    IOF.prototype.emitAsync = function (_event, payload) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            try {
                _this.emit(_event, payload, function (error) {
                    var args = [];
                    for (var _i = 1; _i < arguments.length; _i++) {
                        args[_i - 1] = arguments[_i];
                    }
                    error
                        ? reject(new Error(typeof error === 'string' ? error : 'Ack error'))
                        : resolve(args.length === 0 ? undefined : args.length === 1 ? args[0] : args);
                });
            }
            catch (error) {
                reject(error);
            }
        });
    };
    IOF.prototype.onceAsync = function (_event) {
        var _this = this;
        return new Promise(function (resolve) { return _this.once(_event, resolve); });
    };
    IOF.prototype.connectAsync = function (timeout) {
        var _this = this;
        if (timeout === void 0) { timeout = 5000; }
        return new Promise(function (resolve, reject) {
            if (_this.isConnected())
                return resolve();
            var timeoutId = setTimeout(function () {
                _this.off('connect', connectHandler);
                reject(new Error('Connection timeout'));
            }, timeout);
            var connectHandler = function () {
                clearTimeout(timeoutId);
                resolve();
            };
            _this.once('connect', connectHandler);
        });
    };
    // Clean up all resources
    IOF.prototype.cleanup = function () {
        if (this.messageListener) {
            window.removeEventListener('message', this.messageListener);
            this.messageListener = undefined;
        }
        this.stopHeartbeat();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    };
    IOF.prototype.disconnect = function (fn) {
        // Clean disconnect method
        this.cleanup();
        this.peer.connected = false;
        this.peer.source = undefined;
        this.peer.origin = undefined;
        this.peer.lastHeartbeat = undefined;
        this.messageQueue = [];
        this.messageRateTracker = [];
        this.reconnectAttempts = 0;
        this.removeListeners();
        typeof fn == 'function' && fn();
        this.debug("[".concat(this.peer.type, "] Disconnected"));
        return this;
    };
    // Get connection statistics
    IOF.prototype.getStats = function () {
        return {
            connected: this.isConnected(),
            peerType: this.peer.type,
            origin: this.peer.origin,
            lastHeartbeat: this.peer.lastHeartbeat,
            queuedMessages: this.messageQueue.length,
            reconnectAttempts: this.reconnectAttempts,
            activeListeners: Object.keys(this.Events).length,
            messageRate: this.messageRateTracker.length
        };
    };
    // Clear message queue manually
    IOF.prototype.clearQueue = function () {
        var queueSize = this.messageQueue.length;
        this.messageQueue = [];
        this.debug("[".concat(this.peer.type, "] Cleared ").concat(queueSize, " queued messages"));
        return this;
    };
    return IOF;
}());
exports.default = IOF;
