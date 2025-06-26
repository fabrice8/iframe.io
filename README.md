# iframe.io

Easy and friendly API to connect and interact between content window and its containing iframe with enhanced security, reliability, and modern async/await support.

## New Features & Improvements

### 🆕 Version 1.1.0 Updates

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
  messageQueueSize: 50               // Max queued messages when disconnected
})
```

## New Async/Await Support

### Send Messages with Acknowledgments

```javascript
// Send message and wait for acknowledgment with timeout
try {
  const response = await iframeIO.emitAsync('getData', { id: 123 }, 10000) // 10s timeout
  console.log('Response:', response)
} catch (error) {
  console.error('Request failed:', error.message)
}

// Listen and acknowledge
iframeIO.on('getData', async (data, ack) => {
  try {
    const result = await fetchData(data.id)
    ack(false, result) // Success: ack(error, ...response)
  } catch (error) {
    ack(error.message) // Error: ack(errorMessage)
  }
})
```

### Wait for Connection

```javascript
// Wait for connection with timeout
try {
  await iframeIO.connectAsync(5000) // 5 second timeout
  console.log('Connection established!')
} catch (error) {
  console.error('Connection failed:', error.message)
}

// Wait for single event
const userData = await iframeIO.onceAsync('userProfile')
console.log('User data received:', userData)
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
//   messageRate: 2
// }
```

## Security Features

### Origin Validation

```javascript
// Strict origin checking
iframeIO.listen('https://trusted-domain.com') // Only accept from this origin

// Error handling for invalid origins
iframeIO.on('error', (error) => {
  if (error.type === 'INVALID_ORIGIN') {
    console.log(`Rejected message from ${error.received}`)
  }
})
```

### Message Sanitization

```javascript
// Automatic payload sanitization removes functions and undefined values
iframeIO.emit('data', {
  text: 'Hello',
  func: () => {}, // Functions are automatically removed
  undef: undefined // Undefined values are automatically removed
})
```

### Rate Limiting

```javascript
const iframeIO = new IOF({
  maxMessagesPerSecond: 10 // Limit to 10 messages per second
})

iframeIO.on('error', (error) => {
  if (error.type === 'RATE_LIMIT_EXCEEDED') {
    console.log(`Rate limited: ${error.current}/${error.limit}`)
  }
})
```

## Comprehensive Error Handling

```javascript
iframeIO.on('error', (error) => {
  switch (error.type) {
    case 'INVALID_ORIGIN':
      console.error(`Invalid origin: expected ${error.expected}, got ${error.received}`)
      break
    case 'ORIGIN_MISMATCH':
      console.error(`Origin mismatch: expected ${error.expected}, got ${error.received}`)
      break
    case 'RATE_LIMIT_EXCEEDED':
      console.warn(`Rate limit exceeded: ${error.current}/${error.limit} messages/second`)
      break
    case 'MESSAGE_HANDLING_ERROR':
      console.error(`Error handling event ${error.event}: ${error.error}`)
      break
    case 'EMIT_ERROR':
      console.error(`Error sending event ${error.event}: ${error.error}`)
      break
    case 'LISTENER_ERROR':
      console.error(`Error in listener for ${error.event}: ${error.error}`)
      break
    case 'NO_CONNECTION':
      console.error(`Attempted to send ${error.event} without connection`)
      break
    default:
      console.error('Unknown error:', error)
  }
})
```

## Message Queuing

```javascript
// Messages are automatically queued when disconnected
iframeIO.emit('important-data', { data: 'This will be queued if disconnected' })

// Clear queue manually if needed
iframeIO.clearQueue()

// Check queue status
const stats = iframeIO.getStats()
console.log(`${stats.queuedMessages} messages queued`)
```

## API Reference

### New Methods

#### Async Methods
- **`emitAsync(event, payload?, timeout?)`** - Send message and wait for response (Promise)
- **`connectAsync(timeout?)`** - Wait for connection with timeout (Promise)
- **`onceAsync(event)`** - Wait for single event (Promise)

#### Utility Methods
- **`getStats()`** - Get connection statistics
- **`clearQueue()`** - Clear queued messages

### Connection Methods

- **`initiate(contentWindow, iframeOrigin)`** - Establish connection (WINDOW peer only)
- **`listen(hostOrigin?)`** - Listen for connection (IFRAME peer only)
- **`disconnect(callback?)`** - Disconnect and cleanup
- **`isConnected()`** - Check connection status

### Messaging Methods

- **`emit(event, payload?, callback?)`** - Send message
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

#### Error Events
- **`error`** - Various error conditions with detailed error objects

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import IOF, { Options, Listener, AckFunction } from 'iframe.io'

const options: Options = {
  type: 'WINDOW',
  debug: true,
  heartbeatInterval: 30000,
  maxMessageSize: 512 * 1024
}

const iframeIO = new IOF(options)

// Typed event listeners
iframeIO.on('userAction', (data: { action: string; userId: number }) => {
  console.log(`User ${data.userId} performed ${data.action}`)
})

// Typed async responses
interface ApiResponse {
  success: boolean
  data: any[]
}

const response = await iframeIO.emitAsync<{ query: string }, ApiResponse>(
  'search',
  { query: 'hello' },
  5000 // 5 second timeout
)
```

## Error Types Reference

| Error Type | Description |
|------------|-------------|
| `INVALID_ORIGIN` | Message from unexpected origin |
| `ORIGIN_MISMATCH` | Origin changed during session |
| `MESSAGE_HANDLING_ERROR` | Error processing incoming message |
| `EMIT_ERROR` | Error sending message |
| `LISTENER_ERROR` | Error in event listener |
| `RATE_LIMIT_EXCEEDED` | Too many messages sent |
| `NO_CONNECTION` | Attempted to send without connection |

## Browser Compatibility

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## Migration Guide

### From v1.0.x to v1.1.0

All existing code continues to work without changes. New features are additive:

```javascript
// Old way (still works)
iframeIO.emit('getData', { id: 123 }, (error, result) => {
  if (error) {
    console.error('Error:', error)
  } else {
    console.log('Result:', result)
  }
})

// New async way
try {
  const result = await iframeIO.emitAsync('getData', { id: 123 })
  console.log('Result:', result)
} catch (error) {
  console.error('Error:', error.message)
}
```

## Performance Considerations

- **Message Size**: Keep messages under the configured `maxMessageSize` (default 1MB)
- **Rate Limiting**: Respect the `maxMessagesPerSecond` limit (default 100/sec)
- **Queue Size**: Monitor queued messages to avoid memory issues
- **Heartbeat**: Adjust `heartbeatInterval` based on your reliability needs

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our repository.

## Support

- Create an issue on GitHub for bug reports
- Check existing issues for common problems
- Review the documentation for usage examples
