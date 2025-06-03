# iframe.io

Easy and friendly API to connect and interact between content window and its containing iframe with enhanced features like heartbeat monitoring, automatic reconnection, message queuing, and rate limiting.

## Features

- 🔄 **Bi-directional Communication** - Seamless messaging between parent window and iframe
- 💓 **Heartbeat Monitoring** - Automatic connection health checking
- 🔌 **Auto Reconnection** - Automatic reconnection with exponential backoff
- 📦 **Message Queuing** - Queue messages when connection is lost
- 🛡️ **Security** - Origin validation and message sanitization
- ⚡ **Rate Limiting** - Prevent message flooding
- 🎯 **Event System** - Robust event-driven architecture
- ✨ **Promise Support** - Async/await compatible methods
- 📊 **Connection Stats** - Real-time connection statistics

## Installation

```bash
npm install iframe.io
```

## Quick Start

### Parent Window (WINDOW type)

```javascript
import IOF from 'iframe.io'

// Create iframe and get reference
const iframe = document.createElement('iframe')
iframe.src = 'https://example.com/iframe-content'
document.body.appendChild(iframe)

// Initialize connection
const iof = new IOF({ type: 'WINDOW', debug: true })

iframe.onload = () => {
  // Initiate connection with iframe
  iof.initiate(iframe.contentWindow, 'https://example.com')
  
  // Listen for connection
  iof.on('connect', () => {
    console.log('Connected to iframe!')
    
    // Send message
    iof.emit('hello', { message: 'Hello from parent!' })
  })
  
  // Listen for messages
  iof.on('response', (data) => {
    console.log('Received:', data)
  })
}
```

### Iframe Content (IFRAME type)

```javascript
import IOF from 'iframe.io'

// Create connection listener
const iof = new IOF({ type: 'IFRAME', debug: true })

// Listen for parent connection
iof.listen('https://parent-domain.com')

// Handle connection
iof.on('connect', () => {
  console.log('Connected to parent!')
})

// Listen for messages
iof.on('hello', (data, ack) => {
  console.log('Received from parent:', data)
  
  // Send response
  iof.emit('response', { message: 'Hello from iframe!' })
  
  // Acknowledge receipt (optional)
  if (ack) ack(false, 'Message received')
})
```

## API Reference

### Constructor

```javascript
new IOF(options?)
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | `'WINDOW' \| 'IFRAME'` | `'IFRAME'` | Connection type |
| `debug` | `boolean` | `false` | Enable debug logging |
| `heartbeatInterval` | `number` | `30000` | Heartbeat interval in ms |
| `connectionTimeout` | `number` | `10000` | Connection timeout in ms |
| `maxMessageSize` | `number` | `1048576` | Max message size (1MB) |
| `maxMessagesPerSecond` | `number` | `100` | Rate limit for messages |
| `autoReconnect` | `boolean` | `true` | Enable auto reconnection |
| `messageQueueSize` | `number` | `50` | Max queued messages |

### Connection Methods

#### `initiate(contentWindow, iframeOrigin)`

Establish connection with an iframe (WINDOW type only).

```javascript
iof.initiate(iframe.contentWindow, 'https://iframe-origin.com')
```

**Parameters:**
- `contentWindow` - The iframe's contentWindow
- `iframeOrigin` - The iframe's origin URL

#### `listen(hostOrigin?)`

Listen for connection from parent window (IFRAME type).

```javascript
iof.listen('https://parent-origin.com') // Optional origin restriction
```

**Parameters:**
- `hostOrigin` (optional) - Restrict connections to specific origin

#### `disconnect(callback?)`

Disconnect and clean up all resources.

```javascript
iof.disconnect(() => {
  console.log('Disconnected!')
})
```

### Messaging Methods

#### `emit(event, payload?, callback?)`

Send a message to the peer.

```javascript
// Simple message
iof.emit('myEvent', { data: 'hello' })

// With acknowledgment
iof.emit('myEvent', { data: 'hello' }, (error, response) => {
  if (error) {
    console.error('Error:', error)
  } else {
    console.log('Response:', response)
  }
})

// Callback as second parameter
iof.emit('myEvent', (error, response) => {
  console.log('Response:', response)
})
```

#### `on(event, listener)`

Add event listener.

```javascript
iof.on('myEvent', (data, ack) => {
  console.log('Received:', data)
  
  // Send acknowledgment (optional)
  if (ack) ack(false, 'Success response')
})
```

#### `once(event, listener)`

Add one-time event listener.

```javascript
iof.once('myEvent', (data) => {
  console.log('This will only fire once:', data)
})
```

#### `off(event, listener?)`

Remove event listener(s).

```javascript
// Remove specific listener
iof.off('myEvent', myListener)

// Remove all listeners for event
iof.off('myEvent')
```

#### `removeListeners(callback?)`

Remove all event listeners.

```javascript
iof.removeListeners(() => {
  console.log('All listeners removed')
})
```

### Async Methods

#### `emitAsync(event, payload?)`

Send message and return Promise.

```javascript
try {
  const response = await iof.emitAsync('getData', { id: 123 })
  console.log('Response:', response)
} catch (error) {
  console.error('Error:', error)
}
```

#### `onceAsync(event)`

Wait for single event occurrence.

```javascript
const data = await iof.onceAsync('dataReady')
console.log('Data received:', data)
```

#### `connectAsync(timeout?)`

Wait for connection to be established.

```javascript
try {
  await iof.connectAsync(5000) // 5 second timeout
  console.log('Connected!')
} catch (error) {
  console.error('Connection timeout')
}
```

### Utility Methods

#### `isConnected()`

Check if connection is active.

```javascript
if (iof.isConnected()) {
  console.log('Connection is active')
}
```

#### `getStats()`

Get connection statistics.

```javascript
const stats = iof.getStats()
console.log('Stats:', stats)
/*
{
  connected: true,
  peerType: 'WINDOW',
  origin: 'https://example.com',
  lastHeartbeat: 1640995200000,
  queuedMessages: 0,
  reconnectAttempts: 0,
  activeListeners: 5,
  messageRate: 10
}
*/
```

#### `clearQueue()`

Clear queued messages.

```javascript
iof.clearQueue()
```

## Events

### Built-in Events

| Event | Description | Data |
|-------|-------------|------|
| `connect` | Connection established | - |
| `disconnect` | Connection lost | `{ reason: string }` |
| `reconnecting` | Reconnection attempt | `{ attempt: number, delay: number }` |
| `reconnection_failed` | All reconnection attempts failed | `{ attempts: number }` |
| `error` | Error occurred | `{ type: string, ...details }` |

### Error Types

- `RATE_LIMIT_EXCEEDED` - Message rate limit exceeded
- `MESSAGE_HANDLING_ERROR` - Error processing received message
- `EMIT_ERROR` - Error sending message
- `LISTENER_ERROR` - Error in event listener
- `INVALID_ORIGIN` - Message from unauthorized origin
- `ORIGIN_MISMATCH` - Origin doesn't match established connection
- `NO_CONNECTION` - Attempted to send without connection

## Advanced Usage

### Message Acknowledgments

```javascript
// Sender
iof.emit('processData', { data: [...] }, (error, result) => {
  if (error) {
    console.error('Processing failed:', error)
  } else {
    console.log('Processing result:', result)
  }
})

// Receiver
iof.on('processData', async (data, ack) => {
  try {
    const result = await processData(data.data)
    ack(false, result) // Success: ack(error, ...args)
  } catch (error) {
    ack(error.message) // Error: ack(errorMessage)
  }
})
```

### Connection Monitoring

```javascript
const iof = new IOF({
  heartbeatInterval: 10000, // 10 seconds
  connectionTimeout: 5000,  // 5 seconds
  autoReconnect: true
})

iof.on('disconnect', ({ reason }) => {
  console.log('Connection lost:', reason)
})

iof.on('reconnecting', ({ attempt, delay }) => {
  console.log(`Reconnecting (${attempt}/5) in ${delay}ms`)
})

iof.on('reconnection_failed', ({ attempts }) => {
  console.log(`Failed to reconnect after ${attempts} attempts`)
})
```

### Message Queuing

```javascript
const iof = new IOF({
  messageQueueSize: 100,
  autoReconnect: true
})

// Messages sent while disconnected are automatically queued
iof.emit('queuedMessage', { data: 'This will be queued if disconnected' })

// Check queue status
const stats = iof.getStats()
console.log(`Queued messages: ${stats.queuedMessages}`)
```

### Rate Limiting

```javascript
const iof = new IOF({
  maxMessagesPerSecond: 50,
  maxMessageSize: 512 * 1024 // 512KB
})

iof.on('error', ({ type, limit, current }) => {
  if (type === 'RATE_LIMIT_EXCEEDED') {
    console.log(`Rate limit exceeded: ${current}/${limit} messages per second`)
  }
})
```

### Security Best Practices

```javascript
// Always specify allowed origins
iof.listen('https://trusted-parent.com')

// Handle security errors
iof.on('error', ({ type, expected, received }) => {
  if (type === 'INVALID_ORIGIN') {
    console.warn(`Rejected message from ${received}, expected ${expected}`)
  }
})

// Validate message content
iof.on('userData', (data, ack) => {
  if (!isValidUserData(data)) {
    return ack('Invalid data format')
  }
  // Process valid data...
})
```

## Browser Support

- Modern browsers with postMessage API support
- Chrome 2+
- Firefox 3+
- Safari 4+
- IE 8+
- Edge (all versions)

## TypeScript Support

The library is written in TypeScript and includes full type definitions:

```typescript
import IOF, { Options, PeerType, AckFunction, Listener } from 'iframe.io'

const options: Options = {
  type: 'WINDOW',
  debug: true,
  heartbeatInterval: 15000
}

const iof = new IOF(options)

// Type-safe event handling
iof.on('myEvent', (data: { message: string }, ack?: AckFunction) => {
  console.log(data.message)
  ack?.(false, 'success')
})

// Type-safe async emissions
const response = await iof.emitAsync<{ query: string }, { result: any }>('search', { 
  query: 'typescript' 
})
```

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our repository.

## Support

- Create an issue on GitHub for bug reports
- Check existing issues for common problems
- Review the documentation for usage examples