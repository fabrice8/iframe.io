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
var callbackId = function () {
    var rmin = 10, rmax = 9999;
    return Date.now() + String(Math.floor(Math.random() * (rmax - rmin + 1) + (rmin + 1)));
};
var IOF = /** @class */ (function () {
    function IOF(options) {
        if (options && typeof options !== 'object')
            throw new Error('Invalid Options');
        this.options = options;
        this.Events = {};
        this.peer = { type: 'IFRAME' };
        if (options.type)
            this.peer.type = options.type.toUpperCase();
    }
    IOF.prototype.debug = function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        console.debug.apply(console, args);
    };
    IOF.prototype.initiate = function (contentWindow, iframeOrigin) {
        var _this = this;
        // Establish a connection with an iframe containing in the current window
        if (!contentWindow || !iframeOrigin)
            throw new Error('Invalid Connection initiation arguments');
        if (this.peer.type === 'IFRAME')
            throw new Error('Expect IFRAME to <listen> and WINDOW to <initiate> a connection');
        this.peer.source = contentWindow;
        this.peer.origin = iframeOrigin;
        window.addEventListener('message', function (_a) {
            var origin = _a.origin, data = _a.data, source = _a.source;
            // Check valid message
            if (origin !== _this.peer.origin
                || !source
                || typeof data !== 'object'
                || !data.hasOwnProperty('_event'))
                return;
            var _b = data, _event = _b._event, payload = _b.payload, cid = _b.cid;
            _this.debug("[".concat(_this.peer.type, "] Message: ").concat(_event), payload || '');
            // Handshake or availability check events
            if (_event == 'pong') {
                // Content Window is connected to iframe
                _this.fire('connect');
                return _this.debug("[".concat(_this.peer.type, "] connected"));
            }
            // Fire available event listeners
            _this.fire(_event, payload, cid);
        }, false);
        this.debug("[".concat(this.peer.type, "] Initiate connection: IFrame origin <").concat(iframeOrigin, ">"));
        this.emit('ping');
        return this;
    };
    IOF.prototype.listen = function (hostOrigin) {
        // Listening to connection from the content window
        var _this = this;
        this.peer.type = 'IFRAME'; // iframe.io connection listener is automatically set as IFRAME
        this.debug("[".concat(this.peer.type, "] Listening to connect").concat(hostOrigin ? ": Host <".concat(hostOrigin, ">") : ''));
        window.addEventListener('message', function (_a) {
            var origin = _a.origin, data = _a.data, source = _a.source;
            // Check host origin where event must only come from.
            if (hostOrigin && hostOrigin !== origin)
                throw new Error('Invalid Event Origin');
            // Check valid message
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
            else if (origin !== _this.peer.origin)
                throw new Error('Invalid Origin');
            var _event = data._event, payload = data.payload, cid = data.cid;
            _this.debug("[".concat(_this.peer.type, "] Message: ").concat(_event), payload || '');
            // Handshake or availability check events
            if (_event == 'ping') {
                _this.emit('pong');
                // Iframe is connected to content window
                _this.fire('connect');
                return _this.debug("[".concat(_this.peer.type, "] connected"));
            }
            // Fire available event listeners
            _this.fire(_event, payload, cid);
        }, false);
        return this;
    };
    IOF.prototype.fire = function (_event, payload, cid) {
        var _this = this;
        // Volatile event
        if (!this.Events[_event]
            && !this.Events[_event + '--@once'])
            return this.debug("[".concat(this.peer.type, "] No <").concat(_event, "> listener defined"));
        var callbackFn = cid ?
            function (error) {
                var args = [];
                for (var _i = 1; _i < arguments.length; _i++) {
                    args[_i - 1] = arguments[_i];
                }
                _this.emit("".concat(_event, "--").concat(cid, "--@callback"), { error: error || false, args: args });
                return;
            } : undefined;
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
        // Fire listeners
        listeners.map(function (fn) { return payload !== undefined ? fn(payload, callbackFn) : fn(callbackFn); });
    };
    IOF.prototype.emit = function (_event, payload, fn) {
        if (!this.peer.source)
            throw new Error('No Connection initiated');
        if (typeof payload == 'function') {
            fn = payload;
            payload = null;
        }
        // Acknowledge/callback event listener
        var cid;
        if (typeof fn === 'function') {
            var callbackFunction_1 = fn;
            cid = callbackId();
            this.once("".concat(_event, "--").concat(cid, "--@callback"), function (_a) {
                var error = _a.error, args = _a.args;
                return callbackFunction_1.apply(void 0, __spreadArray([error], args, false));
            });
        }
        this.peer.source.postMessage(newObject({ _event: _event, payload: payload, cid: cid }), this.peer.origin);
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
    return IOF;
}());
exports.default = IOF;
