# iframe.io

Easy and friendly API to connect and interact between content window and its containing iframe with enhanced security, reliability, and modern async/await support.

## New Features & Improvements

### 🆕 Version 1.3.0 Updates

- **📋 Protocol Versioning**: Message format versioning for future-proof evolution
- **🔐 Session Key Rotation**: Opt-in session-derived keys for high-security applications
- **🔒 Enhanced Security**: Origin validation, message sanitization, and payload size limits
- **🔄 Auto-Reconnection**: Automatic reconnection with exponential backoff strategy
- **💓 Heartbeat Monitoring**: Connection health monitoring with configurable intervals
- **📦 Message Queuing**: Queue messages when disconnected and replay on reconnection
- **⚡ Rate Limiting**: Configurable message rate limiting to prevent spam
- **🎯 Promise Support**: Modern async/await APIs with timeout handling
- **📊 Connection Statistics**: Real-time connection and performance metrics
- **🛡️ Comprehensive Error Handling**: Detailed error types and handling mechanisms

## Installation

```bash
npm install iframe.io
```

## Basic Usage

### Parent Window (WINDOW peer)

```javascript
import IOF from 'iframe.io'

const iframe = document.getElementById('myIframe')
const iframeIO = new IOF({
  type: 'WINDOW',
  debug: true
})

// Establish connection
iframeIO.initiate(iframe.contentWindow, 'https://child-domain.com')

// Listen for connection
iframeIO.on('connect', () => {
  console.log('Connected to iframe!')

  // Send a message
  iframeIO.emit('hello', { message: 'Hello from parent!' })
})

// Listen for messages
iframeIO.on('response', (data) => {
  console.log('Received:', data)
})
```

### Child Window (IFRAME peer)

```javascript
import IOF from 'iframe.io'

const iframeIO = new IOF({
  type: 'IFRAME',
  debug: true
})

// Listen for parent connection
iframeIO.listen('https://parent-domain.com')

// Handle connection
iframeIO.on('connect', () => {
  console.log('Connected to parent!')
})

// Listen for messages
iframeIO.on('hello', (data) => {
  console.log('Received:', data)

  // Send response
  iframeIO.emit('response', { received: true })
})
```

## Protocol Versioning

### What is Protocol Versioning?

Every message sent includes a protocol version number (`v` field). This allows the library to evolve over time while maintaining backward compatibility. If a peer receives a message with an unsupported version, it can handle it gracefully.

### Current Version

The current protocol version is **v1**.

### How It Works

```javascript
// All messages automatically include version
const messageData = {
  v: 1,                    // Protocol version
  _event: 'userAction',
  payload: { action: 'click' },
  timestamp: 1609459200000
}
```

### Version Checking

```javascript
// Library automatically handles version checking
iframeIO.on('error', (error) => {
  if (error.type === 'UNSUPPORTED_VERSION') {
    console.log(`Peer using v${error.received}, we support v${error.supported}`)
    // Handle gracefully - maybe show upgrade notice
  }
})
```

### Get Version Information

```javascript
const stats = iframeIO.getStats()
console.log(`Our version: v${stats.protocolVersion}`)
console.log(`Peer version: v${stats.peerProtocolVersion}`)
```

### Future-Proofing Benefits

1. **Seamless Upgrades**: Deploy new versions without breaking old clients
2. **Feature Detection**: Enable features based on peer capabilities
3. **Debugging**: Identify which version caused issues
4. **Graceful Degradation**: Fall back to older protocol when needed

## Session Key Rotation (Opt-In)

### When to Use Session Keys

Enable session key rotation for:
- ✅ **Long-lived connections** (> 1 hour)
- ✅ **High-security applications** (banking, healthcare)
- ✅ **Compliance requirements** (PCI-DSS, HIPAA, SOC 2)
- ✅ **Multiple concurrent iframe connections**
- ✅ **Applications handling sensitive data**

Don't enable for:
- ❌ Short-lived connections (< 30 minutes)
- ❌ Low-risk internal tools
- ❌ Same-origin communication
- ❌ Applications with minimal security requirements

### Basic Configuration

```javascript
const iframeIO = new IOF({
  type: 'WINDOW',
  cryptoAuth: {
    secret: 'your-master-secret-key',
    requireSigned: true,
    
    // Enable session key rotation
    enableSessionKeys: true,
    sessionKeyRotationInterval: 3600000  // 1 hour (default)
  }
})
```

### How It Works

1. **Connection**: Normal ping/pong handshake
2. **Key Exchange**: Peers exchange random session IDs
3. **Key Derivation**: Both derive identical session key using HKDF
4. **Secure Communication**: All signed messages use session key
5. **Periodic Rotation**: New key derived every rotation interval
6. **Graceful Transition**: Old key accepted during grace period

```
Parent                           IFrame
  |                                |
  |---- ping -------------------->|
  |<--- pong ----------------------|
  |                                |
  |-- __session_key_init -------->|
  |   (sessionId: abc123)          |
  |                                |
  |<- __session_key_ack -----------|
  |   (sessionId: def456, keyId)   |
  |                                |
  [Both derive: key = HKDF(master, abc123+def456, keyId)]
  |                                |
  |-- signed message (keyId) ---->|
  |<- signed message (keyId) ------|
  |                                |
  [After rotation interval]        |
  |-- __session_key_rotate ------>|
  |   (newKeyId)                   |
  |                                |
  [Both derive new key]            |
```

### Configuration Options

```javascript
const iframeIO = new IOF({
  type: 'WINDOW',
  debug: true,
  cryptoAuth: {
    // Master secret (never transmitted)
    secret: 'replace-with-shared-secret',
    
    // Require all messages to be signed
    requireSigned: true,
    
    // Clock skew tolerance (2 minutes default)
    maxSkewMs: 120000,
    
    // Replay protection window (500 nonces default)
    replayWindowSize: 500,
    
    // SESSION KEY ROTATION (opt-in)
    enableSessionKeys: true,
    
    // Rotate every hour (adjust based on security needs)
    // - High security: 15-30 minutes
    // - Standard: 1 hour
    // - Low risk: 2-4 hours
    sessionKeyRotationInterval: 3600000
  }
})
```

### Monitoring Session Keys

```javascript
// Listen for session key events
iframeIO.on('session_key_established', (data) => {
  console.log(`Session key established: ${data.keyId}`)
})

iframeIO.on('session_key_rotating', (data) => {
  console.log(`Rotating to new key: ${data.keyId}`)
})

iframeIO.on('session_key_rotated', (data) => {
  console.log(`Peer rotated to: ${data.keyId}`)
})

// Check current key status
const stats = iframeIO.getStats()
console.log(`Session key active: ${stats.sessionKeyActive}`)
console.log(`Current key ID: ${stats.sessionKeyId}`)
```

### Security Considerations

**✅ What Session Keys Provide:**
- Forward secrecy: Past sessions remain secure if master key leaks
- Session isolation: Each connection uses unique keys
- Automatic rotation: Limits exposure window
- Replay protection: Per-session nonce tracking

**⚠️ Important Security Notes:**

1. **Not a Sandbox Boundary**: If attacker can execute JS in either peer, they can read keys
2. **Master Secret Security**: Protect your master secret like a password
3. **HTTPS Required**: Always use HTTPS for iframe communication
4. **Origin Validation**: Session keys don't replace origin checking

### Performance Impact

Session key rotation has minimal performance impact:
- **Key derivation**: ~5-10ms (uses WebCrypto HKDF)
- **Memory**: ~1KB per active key
- **Network**: 3 small handshake messages on connect
- **CPU**: Negligible during rotation (background process)

### Example: Banking Application

```javascript
// High-security banking app
const bankingIO = new IOF({
  type: 'WINDOW',
  debug: false,
  cryptoAuth: {
    secret: process.env.IFRAME_MASTER_SECRET,
    requireSigned: true,
    enableSessionKeys: true,
    sessionKeyRotationInterval: 1800000  // 30 minutes
  },
  // Additional security
  allowedIncomingEvents: [
    'transaction_request',
    'balance_query',
    'account_info'
  ],
  validateIncoming: (event, payload, origin) => {
    // Validate payload structure
    if (event === 'transaction_request') {
      return payload && 
             typeof payload.amount === 'number' &&
             typeof payload.recipient === 'string'
    }
    return true
  }
})

// Monitor security events
bankingIO.on('session_key_rotating', () => {
  console.log('Security: Rotating session keys')
  // Log to security audit trail
})

bankingIO.on('error', (error) => {
  if (error.type === 'AUTH_FAILED') {
    console.error('Security: Authentication failed')
    // Trigger security alert
  }
})
```

### Example: Healthcare Application (HIPAA Compliance)

```javascript
// HIPAA-compliant healthcare app
const healthcareIO = new IOF({
  type: 'IFRAME',
  debug: false,
  cryptoAuth: {
    secret: process.env.PHI_MASTER_SECRET,
    requireSigned: true,
    enableSessionKeys: true,
    sessionKeyRotationInterval: 3600000  // 1 hour
  },
  maxMessageSize: 512 * 1024,  // 512KB limit for PHI
  heartbeatInterval: 60000      // 1 minute health check
})

// Audit logging
healthcareIO.on('session_key_established', (data) => {
  auditLog({
    event: 'SESSION_KEY_ESTABLISHED',
    keyId: data.keyId,
    timestamp: new Date().toISOString(),
    user: getCurrentUser()
  })
})

healthcareIO.on('connect', () => {
  // Send encrypted patient data
  healthcareIO.emitSigned('patient_data', {
    patientId: 'encrypted-id',
    records: encryptedRecords
  })
})
```

## Enhanced Configuration Options

```javascript
const iframeIO = new IOF({
  type: 'WINDOW',                    // 'WINDOW' or 'IFRAME'
  debug: false,                      // Enable debug logging
  heartbeatInterval: 30000,          // Heartbeat interval in ms (30s)
  connectionTimeout: 10000,          // Connection timeout in ms (10s)
  maxMessageSize: 1024 * 1024,       // Max message size in bytes (1MB)
  maxMessagesPerSecond: 100,         // Rate limit (100 messages/second)
  autoReconnect: true,               // Enable automatic reconnection
  messageQueueSize: 50,              // Max queued messages when disconnected
  allowedIncomingEvents: ['hello', 'response'], // Optional incoming event allowlist
  validateIncoming: (event, payload, origin) => true, // Optional custom validator
  cryptoAuth: {
    secret: 'replace-with-shared-secret',
    requireSigned: false,
    maxSkewMs: 120000,               // 2 minutes clock skew
    replayWindowSize: 500,
    // Session key rotation (opt-in)
    enableSessionKeys: false,        // Set to true for high-security apps
    sessionKeyRotationInterval: 3600000  // 1 hour
  }
})
```

## New Async/Await Support

### Send Messages with Acknowledgments

```javascript
// Send message and wait for response with timeout
try {
  const response = await iframeIO.emitAsync('getData', { id: 123 }, 10000)
  console.log('Response:', response)
} catch (error) {
  console.error('Request failed:', error.message)
}

// Listen and acknowledge
iframeIO.on('getData', async (data, ack) => {
  try {
    const result = await fetchData(data.id)
    ack(false, result)
  } catch (error) {
    ack(error.message)
  }
})
```

### Wait for Connection

```javascript
// Wait for connection with timeout
try {
  await iframeIO.connectAsync(5000)
  console.log('Connection established!')
} catch (error) {
  console.error('Connection failed:', error.message)
}
```

## Enhanced Connection Management

### Auto-Reconnection

```javascript
// Handle connection events
iframeIO.on('disconnect', (data) => {
  console.log('Disconnected:', data.reason)
})

iframeIO.on('reconnecting', (data) => {
  console.log(`Reconnection attempt ${data.attempt}, delay: ${data.delay}ms`)
})

iframeIO.on('reconnection_failed', (data) => {
  console.error(`Failed to reconnect after ${data.attempts} attempts`)
})
```

### Connection Statistics

```javascript
const stats = iframeIO.getStats()
console.log(stats)
// {
//   connected: true,
//   peerType: 'WINDOW',
//   origin: 'https://example.com',
//   lastHeartbeat: 1609459200000,
//   queuedMessages: 0,
//   reconnectAttempts: 0,
//   activeListeners: 5,
//   messageRate: 2,
//   protocolVersion: 1,
//   peerProtocolVersion: 1,
//   sessionKeyActive: true,
//   sessionKeyId: 'key-1609459200000-abc123'
// }
```

## Security Features

### Origin Validation

```javascript
// Strict origin checking
iframeIO.listen('https://trusted-domain.com')

iframeIO.on('error', (error) => {
  if (error.type === 'INVALID_ORIGIN') {
    console.log(`Rejected message from ${error.received}`)
  }
})
```

### Message Sanitization

```javascript
// Automatic payload sanitization
iframeIO.emit('data', {
  text: 'Hello',
  func: () => {},      // Automatically removed
  undef: undefined     // Automatically removed
})
```

### Cryptographic Message Authentication

```javascript
const iframeIO = new IOF({
  type: 'WINDOW',
  cryptoAuth: {
    secret: 'replace-with-shared-secret',
    requireSigned: true
  }
})

// Send signed messages
await iframeIO.emitSigned('hello', { msg: 'signed' })
const reply = await iframeIO.emitAsyncSigned('getData', { id: 123 }, 5000)
```

## API Reference

### New Methods

#### Async Methods
- **`emitAsync(event, payload?, timeout?)`** - Send message and wait for response
- **`emitAsyncSigned(event, payload?, timeout?)`** - Send signed message and wait for response
- **`connectAsync(timeout?)`** - Wait for connection with timeout
- **`onceAsync(event)`** - Wait for single event

#### Utility Methods
- **`getStats()`** - Get connection statistics (includes version and session key info)
- **`clearQueue()`** - Clear queued messages

### Connection Methods

- **`initiate(contentWindow, iframeOrigin)`** - Establish connection (WINDOW peer)
- **`listen(hostOrigin?)`** - Listen for connection (IFRAME peer)
- **`disconnect(callback?)`** - Disconnect and cleanup
- **`isConnected()`** - Check connection status

### Messaging Methods

- **`emit(event, payload?, callback?)`** - Send message
- **`emitSigned(event, payload?, callback?)`** - Send signed message
- **`on(event, listener)`** - Add event listener
- **`once(event, listener)`** - Add one-time event listener
- **`off(event, listener?)`** - Remove event listener(s)
- **`removeListeners(callback?)`** - Remove all listeners

### Events

#### Connection Events
- **`connect`** - Connection established
- **`disconnect`** - Connection lost with reason
- **`reconnecting`** - Reconnection attempt started
- **`reconnection_failed`** - All reconnection attempts failed

#### Session Key Events (when enabled)
- **`session_key_established`** - Session key derived and active
- **`session_key_rotating`** - New key being generated
- **`session_key_rotated`** - Peer rotated to new key

#### Error Events
- **`error`** - Various error conditions with detailed error objects

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import IOF, { Options, Listener, AckFunction, SessionKeyInfo } from 'iframe.io'

const options: Options = {
  type: 'WINDOW',
  debug: true,
  cryptoAuth: {
    secret: 'my-secret',
    enableSessionKeys: true,
    sessionKeyRotationInterval: 1800000
  }
}

const iframeIO = new IOF(options)

// Session key events are typed
iframeIO.on('session_key_established', (data: { keyId: string }) => {
  console.log(`Key established: ${data.keyId}`)
})
```

## Error Types Reference

| Error Type | Description |
|------------|-------------|
| `INVALID_ORIGIN` | Message from unexpected origin |
| `ORIGIN_MISMATCH` | Origin changed during session |
| `UNSUPPORTED_VERSION` | Peer using unsupported protocol version |
| `MESSAGE_HANDLING_ERROR` | Error processing incoming message |
| `EMIT_ERROR` | Error sending message |
| `LISTENER_ERROR` | Error in event listener |
| `DISALLOWED_EVENT` | Event rejected by allowlist |
| `INVALID_MESSAGE` | Message rejected by validator |
| `AUTH_FAILED` | Cryptographic authentication failed |
| `AUTH_ERROR` | Crypto verification errored |
| `RATE_LIMIT_EXCEEDED` | Too many messages sent |
| `NO_CONNECTION` | Attempted send without connection |

## Browser Compatibility

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

WebCrypto API required for session key rotation feature.

## Migration Guide

### From v1.2.x to v1.3.0

All existing code continues to work without changes. New features are additive:

```javascript
// Old way (still works)
const iframeIO = new IOF({
  type: 'WINDOW',
  cryptoAuth: {
    secret: 'my-secret'
  }
})

// New way with session keys (opt-in)
const iframeIO = new IOF({
  type: 'WINDOW',
  cryptoAuth: {
    secret: 'my-secret',
    enableSessionKeys: true  // Enable for high-security apps
  }
})

// Protocol version is automatic - no code changes needed
```

## Performance Considerations

- **Message Size**: Keep under `maxMessageSize` (default 1MB)
- **Rate Limiting**: Respect `maxMessagesPerSecond` (default 100/sec)
- **Queue Size**: Monitor queued messages to avoid memory issues
- **Heartbeat**: Adjust `heartbeatInterval` based on needs
- **Session Keys**: Minimal overhead (~5-10ms derivation, ~1KB memory)

## Best Practices

### Security

1. **Always use HTTPS** for production deployments
2. **Validate origins** strictly in both peers
3. **Enable session keys** for applications handling sensitive data
4. **Use allowedIncomingEvents** to limit attack surface
5. **Implement custom validation** for critical payloads
6. **Monitor error events** for security incidents
7. **Rotate master secrets** periodically (outside of session rotation)

### Performance

1. **Batch related messages** when possible
2. **Use appropriate queue sizes** for your use case
3. **Monitor connection stats** regularly
4. **Adjust heartbeat intervals** based on reliability needs
5. **Set reasonable rotation intervals** (1 hour is good default)

### Reliability

1. **Handle all error types** appropriately
2. **Implement retry logic** at application level for critical operations
3. **Use `emitAsync`** for operations requiring acknowledgment
4. **Monitor reconnection events** and alert on failures
5. **Test disconnection scenarios** thoroughly

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our repository.

## Support

- Create an issue on GitHub for bug reports
- Check existing issues for common problems
- Review the documentation for usage examples

## Changelog

### v1.3.0
- Added protocol versioning for future-proof evolution
- Added optional session key rotation for high-security applications
- Enhanced connection statistics with version and key information
- Improved error handling for version mismatches
- Added comprehensive documentation and examples

### v1.2.0
- Enhanced security features (origin validation, sanitization, rate limiting)
- Auto-reconnection with exponential backoff
- Heartbeat monitoring
- Message queuing
- Modern async/await APIs
- Comprehensive error handling

### v1.1.0
- Initial release
- Basic iframe communication
- Event-based API