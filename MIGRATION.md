# Migration Guide: v1.2.x to v1.3.0

## Overview

Version 1.3.0 introduces two major features:
1. **Protocol Versioning** - Automatic message version tracking
2. **Session Key Rotation** - Opt-in session-derived keys for high-security applications

**Good news:** All existing code continues to work without any changes! These features are backward compatible and additive.

## Breaking Changes

**None!** This is a fully backward-compatible release.

## New Features

### 1. Protocol Versioning (Automatic)

Protocol versioning is automatically enabled and requires **no code changes**.

#### What Changed

Every message now includes a `v` field:
```javascript
// Old message format (still supported when receiving)
{
  _event: 'hello',
  payload: { msg: 'hi' },
  timestamp: 1609459200000
}

// New message format (v1.3.0+)
{
  v: 1,  // Protocol version added automatically
  _event: 'hello',
  payload: { msg: 'hi' },
  timestamp: 1609459200000
}
```

#### What You Get

- **Future-proofing**: Protocol can evolve without breaking changes
- **Version detection**: Know which version your peers are using
- **Graceful degradation**: Handle unsupported versions elegantly

#### Optional: Monitor Versions

```javascript
// NEW: Get version information
const stats = iframeIO.getStats()
console.log(`Our version: v${stats.protocolVersion}`)
console.log(`Peer version: v${stats.peerProtocolVersion}`)

// NEW: Handle version mismatches
iframeIO.on('error', (error) => {
  if (error.type === 'UNSUPPORTED_VERSION') {
    console.log(`Peer using unsupported version v${error.received}`)
    // Handle gracefully - maybe show upgrade notice
  }
})
```

### 2. Session Key Rotation (Opt-In)

Session key rotation is **completely optional** and requires explicit opt-in.

#### When to Enable

Enable session keys if you have:
- ✅ Long-lived connections (> 1 hour)
- ✅ High-security requirements (banking, healthcare)
- ✅ Compliance requirements (PCI-DSS, HIPAA, SOC 2)
- ✅ Applications handling sensitive data

Don't enable if you have:
- ❌ Short-lived connections (< 30 minutes)
- ❌ Low-risk applications
- ❌ Performance-critical scenarios where every millisecond counts

#### Migration Steps

**Before (v1.2.x):**
```javascript
const iframeIO = new IOF({
  type: 'WINDOW',
  cryptoAuth: {
    secret: 'my-master-secret',
    requireSigned: true
  }
})
```

**After (v1.3.0) - No changes required:**
```javascript
// Existing code works exactly the same
const iframeIO = new IOF({
  type: 'WINDOW',
  cryptoAuth: {
    secret: 'my-master-secret',
    requireSigned: true
  }
})
```

**After (v1.3.0) - With session keys enabled:**
```javascript
const iframeIO = new IOF({
  type: 'WINDOW',
  cryptoAuth: {
    secret: 'my-master-secret',
    requireSigned: true,
    
    // NEW: Enable session key rotation
    enableSessionKeys: true,
    
    // NEW: Optional rotation interval (default: 1 hour)
    sessionKeyRotationInterval: 3600000
  }
})
```

#### Session Key Events

If you enable session keys, you can optionally monitor them:

```javascript
// NEW: Monitor session key lifecycle
iframeIO.on('session_key_established', (data) => {
  console.log(`Session key established: ${data.keyId}`)
  // Optional: Log to audit trail
})

iframeIO.on('session_key_rotating', (data) => {
  console.log(`Rotating to new key: ${data.keyId}`)
})

iframeIO.on('session_key_rotated', (data) => {
  console.log(`Peer rotated to: ${data.keyId}`)
})
```

## Updated APIs

### getStats() - New Fields

```javascript
// v1.2.x
const stats = iframeIO.getStats()
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

// v1.3.0 - Added fields
const stats = iframeIO.getStats()
// {
//   connected: true,
//   peerType: 'WINDOW',
//   origin: 'https://example.com',
//   lastHeartbeat: 1609459200000,
//   queuedMessages: 0,
//   reconnectAttempts: 0,
//   activeListeners: 5,
//   messageRate: 2,
//   protocolVersion: 1,           // NEW
//   peerProtocolVersion: 1,       // NEW
//   sessionKeyActive: false,      // NEW
//   sessionKeyId: undefined       // NEW
// }
```

### Error Types - New Type

```javascript
// NEW error type
iframeIO.on('error', (error) => {
  if (error.type === 'UNSUPPORTED_VERSION') {
    // Peer using version we don't support
    console.log(`Received: v${error.received}`)
    console.log(`Supported: v${error.supported}`)
  }
})
```

## TypeScript Changes

### New Types Exported

```typescript
// NEW types available for import
import IOF, { 
  Options,
  Listener,
  AckFunction,
  SessionKeyInfo  // NEW
} from 'iframe.io'

// SessionKeyInfo type
type SessionKeyInfo = {
  keyId: string
  key: string
  createdAt: number
  expiresAt: number
}
```

### Updated Types

```typescript
// CryptoAuthOptions - New fields
type CryptoAuthOptions = {
  secret: string
  requireSigned?: boolean
  maxSkewMs?: number
  replayWindowSize?: number
  enableSessionKeys?: boolean          // NEW
  sessionKeyRotationInterval?: number  // NEW
}

// MessageData - Version field added
type MessageData = {
  v: number  // NEW
  _event: string
  payload: any
  cid: string | undefined
  timestamp?: number
  size?: number
  auth?: {
    alg: 'HMAC-SHA256'
    ts: number
    nonce: string
    sig: string
    keyId?: string  // NEW
  }
}
```

## Performance Considerations

### Protocol Versioning

**Impact:** Negligible
- Adds 1 integer field to each message (~5 bytes)
- No processing overhead
- No memory impact

### Session Key Rotation

**Impact:** Minimal (only when enabled)

**Initial Connection:**
- Key derivation: ~5-10ms (one-time)
- 3 additional handshake messages
- Memory: ~1KB per active key

**During Rotation:**
- Background process, non-blocking
- Key derivation: ~5-10ms
- Memory: ~2-3KB during grace period

**Recommendation:** Monitor your application's performance after enabling. For most applications, the impact is imperceptible.

## Testing Your Migration

### Step 1: Update Package

```bash
npm install iframe.io@1.3.0
# or
yarn add iframe.io@1.3.0
```

### Step 2: Run Existing Tests

Your existing tests should pass without any changes:

```bash
npm test
```

### Step 3: Test Protocol Versioning

```javascript
// Add to your test suite
test('Protocol version is reported', () => {
  const iframeIO = new IOF({ type: 'WINDOW' })
  const stats = iframeIO.getStats()
  
  expect(stats.protocolVersion).toBe(1)
})
```

### Step 4: Test Session Keys (Optional)

Only if you're enabling session keys:

```javascript
test('Session keys are established', async () => {
  const parentIO = new IOF({
    type: 'WINDOW',
    cryptoAuth: {
      secret: 'test-secret',
      enableSessionKeys: true
    }
  })
  
  const childIO = new IOF({
    type: 'IFRAME',
    cryptoAuth: {
      secret: 'test-secret',
      enableSessionKeys: true
    }
  })
  
  // Connect and wait
  parentIO.initiate(iframe.contentWindow, 'https://test.com')
  childIO.listen('https://parent.com')
  
  await parentIO.connectAsync(5000)
  
  // Check session key is active
  const stats = parentIO.getStats()
  expect(stats.sessionKeyActive).toBe(true)
  expect(stats.sessionKeyId).toBeDefined()
})
```

## Rollback Plan

If you encounter any issues, you can easily roll back:

```bash
npm install iframe.io@1.2.0
# or
yarn add iframe.io@1.2.0
```

All your existing code will continue to work.

## Common Migration Scenarios

### Scenario 1: Standard Application (No Changes)

```javascript
// Your existing code
const iframeIO = new IOF({
  type: 'WINDOW',
  debug: true
})

iframeIO.initiate(iframe.contentWindow, 'https://widget.com')

// This continues to work exactly as before
// Protocol versioning is added automatically
```

### Scenario 2: Existing Crypto Auth (No Changes)

```javascript
// Your existing code with crypto auth
const iframeIO = new IOF({
  type: 'WINDOW',
  cryptoAuth: {
    secret: process.env.SECRET,
    requireSigned: true
  }
})

// This continues to work exactly as before
// Session keys are NOT enabled unless you opt in
```

### Scenario 3: Banking App (Add Session Keys)

```javascript
// Before
const bankingIO = new IOF({
  type: 'WINDOW',
  cryptoAuth: {
    secret: process.env.BANKING_SECRET,
    requireSigned: true
  }
})

// After - Add session key rotation
const bankingIO = new IOF({
  type: 'WINDOW',
  cryptoAuth: {
    secret: process.env.BANKING_SECRET,
    requireSigned: true,
    enableSessionKeys: true,              // NEW
    sessionKeyRotationInterval: 1800000   // NEW: 30 minutes
  }
})

// Optional: Add monitoring
bankingIO.on('session_key_established', (data) => {
  auditLog('SESSION_KEY_ESTABLISHED', data)
})
```

### Scenario 4: Healthcare App (Add Session Keys + Monitoring)

```javascript
// Before
const healthIO = new IOF({
  type: 'IFRAME',
  cryptoAuth: {
    secret: process.env.PHI_SECRET,
    requireSigned: true
  }
})

// After - Add session keys and HIPAA audit logging
const healthIO = new IOF({
  type: 'IFRAME',
  cryptoAuth: {
    secret: process.env.PHI_SECRET,
    requireSigned: true,
    enableSessionKeys: true,        // NEW
    sessionKeyRotationInterval: 3600000  // NEW: 1 hour
  }
})

// NEW: HIPAA compliance monitoring
healthIO.on('session_key_established', (data) => {
  hipaaAuditLog('SESSION_KEY_ESTABLISHED', {
    keyId: data.keyId,
    timestamp: new Date().toISOString(),
    userId: getCurrentUserId()
  })
})

healthIO.on('session_key_rotating', (data) => {
  hipaaAuditLog('SESSION_KEY_ROTATION', {
    keyId: data.keyId,
    timestamp: new Date().toISOString()
  })
})
```

## FAQ

### Q: Do I need to update my code?

**A:** No! All existing code continues to work without changes. New features are opt-in.

### Q: What happens if parent and child use different versions?

**A:** They can still communicate! The library handles version differences gracefully:
- v1.3.0 can communicate with v1.2.x
- v1.3.0 can communicate with v1.0.x
- Version field is added automatically when sending
- Version field is optional when receiving

### Q: Should I enable session keys?

**A:** Only if you have high-security requirements:
- ✅ Banking, healthcare, sensitive data
- ✅ Compliance requirements (PCI-DSS, HIPAA)
- ✅ Long-lived connections
- ❌ Standard applications can skip it

### Q: What's the performance impact?

**A:** Minimal:
- Protocol versioning: ~5 bytes per message, zero processing
- Session keys (when enabled): ~5-10ms initial setup, ~1-3KB memory

### Q: Can I use session keys without requiring signed messages?

**A:** No. Session keys require `requireSigned: true` because they're part of the authentication system.

### Q: How do I know if session keys are working?

**A:** Check the stats:
```javascript
const stats = iframeIO.getStats()
console.log(stats.sessionKeyActive)  // true if working
console.log(stats.sessionKeyId)      // current key ID
```

### Q: What if I want to disable session keys later?

**A:** Just remove the option:
```javascript
// Before
cryptoAuth: {
  secret: 'my-secret',
  requireSigned: true,
  enableSessionKeys: true  // Remove this line
}

// After
cryptoAuth: {
  secret: 'my-secret',
  requireSigned: true
}
```

### Q: Do both parent and child need to enable session keys?

**A:** Yes, both peers must have `enableSessionKeys: true` and the same `secret` for session key rotation to work.

## Support

If you encounter any issues during migration:

1. Check the [EXAMPLES.md](./EXAMPLES.md) for detailed usage examples
2. Review the [README.md](./README.md) for complete documentation
3. Create an issue on GitHub with:
   - Your current version
   - Steps to reproduce
   - Expected vs actual behavior

## Changelog

### v1.3.0 (Current)
- ✨ Added protocol versioning for future-proof evolution
- ✨ Added optional session key rotation for high-security applications
- 📊 Enhanced getStats() with version and session key information
- 🐛 Fixed edge cases in message handling
- 📚 Comprehensive documentation and examples

### v1.2.0 (Previous)
- Enhanced security features
- Auto-reconnection
- Heartbeat monitoring
- Message queuing
- Modern async/await APIs

### v1.0.0 (Initial)
- Basic iframe communication
- Event-based API