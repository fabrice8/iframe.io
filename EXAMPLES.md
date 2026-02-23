# iframe.io Usage Examples

## Example 1: Basic Usage (No Session Keys)

### Parent Window
```javascript
import IOF from 'iframe.io'

const iframe = document.getElementById('payment-iframe')
const iframeIO = new IOF({
  type: 'WINDOW',
  debug: true
})

iframeIO.initiate(iframe.contentWindow, 'https://payment.example.com')

iframeIO.on('connect', () => {
  console.log('Payment iframe connected')
  
  // Check protocol version
  const stats = iframeIO.getStats()
  console.log(`Protocol versions - Us: v${stats.protocolVersion}, Peer: v${stats.peerProtocolVersion}`)
})

// Send payment request
async function processPayment(amount) {
  try {
    const result = await iframeIO.emitAsync('payment_request', {
      amount,
      currency: 'USD'
    }, 30000)
    
    console.log('Payment result:', result)
    return result
  } catch (error) {
    console.error('Payment failed:', error.message)
    throw error
  }
}

// Handle version mismatches
iframeIO.on('error', (error) => {
  if (error.type === 'UNSUPPORTED_VERSION') {
    alert(`Please update your payment widget. Current version: v${error.received}, Required: v${error.supported}`)
  }
})
```

### Child Window (Payment Iframe)
```javascript
import IOF from 'iframe.io'

const iframeIO = new IOF({
  type: 'IFRAME',
  debug: true
})

iframeIO.listen('https://shop.example.com')

iframeIO.on('connect', () => {
  console.log('Connected to parent shop')
})

// Handle payment requests
iframeIO.on('payment_request', async (data, ack) => {
  try {
    console.log(`Processing payment: $${data.amount}`)
    
    // Process payment
    const result = await processPaymentAPI(data.amount, data.currency)
    
    // Acknowledge success
    ack(false, {
      success: true,
      transactionId: result.id
    })
  } catch (error) {
    // Acknowledge error
    ack(error.message)
  }
})
```

## Example 2: High-Security Banking App with Session Keys

### Parent Window (Banking Dashboard)
```javascript
import IOF from 'iframe.io'

const accountIframe = document.getElementById('account-widget')
const bankingIO = new IOF({
  type: 'WINDOW',
  debug: false,
  
  // Enhanced security configuration
  cryptoAuth: {
    secret: process.env.BANKING_MASTER_SECRET,
    requireSigned: true,
    
    // Enable session key rotation
    enableSessionKeys: true,
    sessionKeyRotationInterval: 1800000  // 30 minutes for banking
  },
  
  // Additional security layers
  allowedIncomingEvents: [
    'account_balance',
    'transaction_history',
    'transfer_confirmation'
  ],
  
  validateIncoming: (event, payload, origin) => {
    // Validate all incoming data structures
    if (event === 'account_balance') {
      return payload && 
             typeof payload.balance === 'number' &&
             typeof payload.currency === 'string'
    }
    if (event === 'transaction_history') {
      return Array.isArray(payload.transactions)
    }
    return true
  },
  
  maxMessageSize: 512 * 1024,  // 512KB limit
  heartbeatInterval: 60000      // 1 minute health check
})

// Initialize connection
bankingIO.initiate(accountIframe.contentWindow, 'https://secure-banking.example.com')

// Monitor security events
bankingIO.on('connect', () => {
  console.log('Secure banking connection established')
  
  const stats = bankingIO.getStats()
  console.log('Connection info:', {
    protocolVersion: stats.protocolVersion,
    peerVersion: stats.peerProtocolVersion,
    sessionKeyActive: stats.sessionKeyActive,
    sessionKeyId: stats.sessionKeyId
  })
  
  // Log to security audit trail
  auditLog('SECURE_CONNECTION_ESTABLISHED', {
    origin: stats.origin,
    sessionKeyId: stats.sessionKeyId
  })
})

bankingIO.on('session_key_established', (data) => {
  console.log(`Session key established: ${data.keyId}`)
  auditLog('SESSION_KEY_ESTABLISHED', { keyId: data.keyId })
})

bankingIO.on('session_key_rotating', (data) => {
  console.log(`Rotating session key to: ${data.keyId}`)
  auditLog('SESSION_KEY_ROTATING', { keyId: data.keyId })
})

bankingIO.on('session_key_rotated', (data) => {
  console.log(`Peer rotated to key: ${data.keyId}`)
  auditLog('SESSION_KEY_ROTATED', { keyId: data.keyId })
})

// Handle security errors
bankingIO.on('error', (error) => {
  console.error('Security error:', error)
  
  if (error.type === 'AUTH_FAILED') {
    auditLog('AUTHENTICATION_FAILED', error)
    // Terminate connection and alert security team
    bankingIO.disconnect()
    alertSecurityTeam('Authentication failed', error)
  }
  
  if (error.type === 'INVALID_ORIGIN') {
    auditLog('INVALID_ORIGIN_ATTEMPT', error)
    alertSecurityTeam('Invalid origin detected', error)
  }
})

// Secure transaction request
async function initiateTransfer(amount, recipient) {
  try {
    // Use signed async message
    const result = await bankingIO.emitAsyncSigned('transfer_request', {
      amount,
      recipient,
      timestamp: Date.now(),
      nonce: generateSecureNonce()
    }, 60000)  // 60 second timeout for banking operations
    
    console.log('Transfer result:', result)
    auditLog('TRANSFER_COMPLETED', { amount, recipient, result })
    
    return result
  } catch (error) {
    console.error('Transfer failed:', error)
    auditLog('TRANSFER_FAILED', { amount, recipient, error: error.message })
    throw error
  }
}

// Get account balance
async function getAccountBalance() {
  try {
    const balance = await bankingIO.emitAsyncSigned('balance_request', {
      accountId: getCurrentAccountId()
    }, 30000)
    
    return balance
  } catch (error) {
    console.error('Failed to fetch balance:', error)
    return null
  }
}

// Utility functions
function auditLog(event, data) {
  // Send to audit logging service
  fetch('/api/audit-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      data,
      timestamp: new Date().toISOString(),
      userId: getCurrentUserId()
    })
  })
}

function alertSecurityTeam(message, details) {
  // Alert security monitoring
  fetch('/api/security-alert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, details })
  })
}

function generateSecureNonce() {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
}

function getCurrentAccountId() {
  // Return current account ID
  return sessionStorage.getItem('currentAccountId')
}

function getCurrentUserId() {
  // Return current user ID
  return sessionStorage.getItem('userId')
}
```

### Child Window (Secure Banking Widget)
```javascript
import IOF from 'iframe.io'

const bankingIO = new IOF({
  type: 'IFRAME',
  debug: false,
  
  cryptoAuth: {
    secret: process.env.BANKING_MASTER_SECRET,
    requireSigned: true,
    enableSessionKeys: true,
    sessionKeyRotationInterval: 1800000  // Match parent: 30 minutes
  },
  
  allowedIncomingEvents: [
    'transfer_request',
    'balance_request',
    'transaction_query'
  ],
  
  validateIncoming: (event, payload, origin) => {
    // Validate incoming requests
    if (event === 'transfer_request') {
      return payload &&
             typeof payload.amount === 'number' &&
             payload.amount > 0 &&
             typeof payload.recipient === 'string' &&
             typeof payload.nonce === 'string'
    }
    return true
  }
})

// Listen only to parent domain
bankingIO.listen('https://banking-dashboard.example.com')

bankingIO.on('connect', () => {
  console.log('Connected to banking dashboard')
  
  const stats = bankingIO.getStats()
  auditLog('WIDGET_CONNECTED', {
    protocolVersion: stats.protocolVersion,
    sessionKeyActive: stats.sessionKeyActive
  })
})

// Monitor session keys
bankingIO.on('session_key_established', (data) => {
  console.log(`Widget session key: ${data.keyId}`)
  auditLog('WIDGET_SESSION_KEY', { keyId: data.keyId })
})

// Handle transfer requests
bankingIO.on('transfer_request', async (data, ack) => {
  try {
    console.log(`Processing transfer: $${data.amount} to ${data.recipient}`)
    
    // Validate request integrity
    if (!validateTransferRequest(data)) {
      throw new Error('Invalid transfer request')
    }
    
    // Process transfer through banking API
    const result = await processBankingTransfer({
      amount: data.amount,
      recipient: data.recipient,
      userId: getCurrentUserId()
    })
    
    auditLog('TRANSFER_PROCESSED', {
      amount: data.amount,
      recipient: data.recipient,
      transactionId: result.transactionId
    })
    
    // Send success response
    ack(false, {
      success: true,
      transactionId: result.transactionId,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('Transfer error:', error)
    
    auditLog('TRANSFER_ERROR', {
      error: error.message,
      amount: data.amount
    })
    
    // Send error response
    ack(error.message)
  }
})

// Handle balance requests
bankingIO.on('balance_request', async (data, ack) => {
  try {
    const balance = await getBankingBalance(data.accountId)
    
    ack(false, {
      balance: balance.amount,
      currency: balance.currency,
      lastUpdated: Date.now()
    })
  } catch (error) {
    ack(error.message)
  }
})

// Handle errors
bankingIO.on('error', (error) => {
  if (error.type === 'AUTH_FAILED') {
    console.error('Authentication failed - disconnecting')
    auditLog('WIDGET_AUTH_FAILED', error)
    bankingIO.disconnect()
  }
})

// Utility functions
function validateTransferRequest(data) {
  // Add business logic validation
  if (data.amount > 10000) {
    // Large transfer - require additional verification
    return false
  }
  return true
}

async function processBankingTransfer(transferData) {
  // Call actual banking API
  const response = await fetch('/api/banking/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(transferData)
  })
  
  if (!response.ok) {
    throw new Error('Banking API error')
  }
  
  return await response.json()
}

async function getBankingBalance(accountId) {
  const response = await fetch(`/api/banking/balance/${accountId}`)
  return await response.json()
}

function auditLog(event, data) {
  fetch('/api/audit-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      data,
      timestamp: new Date().toISOString(),
      source: 'banking-widget'
    })
  })
}

function getCurrentUserId() {
  return sessionStorage.getItem('userId')
}
```

## Example 3: Healthcare Application (HIPAA Compliance)

### Parent Window (Patient Portal)
```javascript
import IOF from 'iframe.io'

const healthRecordsIframe = document.getElementById('health-records')
const healthcareIO = new IOF({
  type: 'WINDOW',
  debug: false,
  
  cryptoAuth: {
    secret: process.env.PHI_MASTER_SECRET,
    requireSigned: true,
    enableSessionKeys: true,
    sessionKeyRotationInterval: 3600000  // 1 hour
  },
  
  allowedIncomingEvents: [
    'patient_records',
    'lab_results',
    'prescription_history'
  ],
  
  maxMessageSize: 2 * 1024 * 1024,  // 2MB for medical records
  heartbeatInterval: 60000
})

healthcareIO.initiate(healthRecordsIframe.contentWindow, 'https://health-records.hospital.com')

// HIPAA audit logging
healthcareIO.on('connect', () => {
  const stats = healthcareIO.getStats()
  
  hipaaAuditLog('PHI_ACCESS_STARTED', {
    patientId: getCurrentPatientId(),
    sessionKeyId: stats.sessionKeyId,
    timestamp: new Date().toISOString()
  })
})

healthcareIO.on('session_key_rotating', (data) => {
  hipaaAuditLog('SESSION_KEY_ROTATION', {
    oldKeyId: healthcareIO.getStats().sessionKeyId,
    newKeyId: data.keyId
  })
})

// Request patient records
async function getPatientRecords(patientId) {
  hipaaAuditLog('PHI_REQUEST', { patientId, type: 'records' })
  
  try {
    const records = await healthcareIO.emitAsyncSigned('records_request', {
      patientId,
      requestingProvider: getCurrentProviderId()
    }, 60000)
    
    hipaaAuditLog('PHI_ACCESSED', { patientId, type: 'records' })
    return records
  } catch (error) {
    hipaaAuditLog('PHI_ACCESS_FAILED', { 
      patientId, 
      error: error.message 
    })
    throw error
  }
}

function hipaaAuditLog(event, data) {
  // HIPAA-compliant audit logging
  fetch('/api/hipaa-audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      data,
      timestamp: new Date().toISOString(),
      ipAddress: getClientIP(),
      userId: getCurrentProviderId(),
      sessionId: getSessionId()
    })
  })
}

function getCurrentPatientId() {
  return sessionStorage.getItem('currentPatientId')
}

function getCurrentProviderId() {
  return sessionStorage.getItem('providerId')
}
```

## Example 4: Version Migration Strategy

```javascript
import IOF from 'iframe.io'

const iframeIO = new IOF({
  type: 'WINDOW',
  debug: true
})

iframeIO.initiate(iframe.contentWindow, 'https://widget.example.com')

iframeIO.on('connect', () => {
  const stats = iframeIO.getStats()
  
  // Check peer version and adjust behavior
  if (stats.peerProtocolVersion === 1) {
    console.log('Peer using v1 protocol - full compatibility')
    useFullFeatures()
  } else if (!stats.peerProtocolVersion) {
    console.log('Peer using legacy protocol - limited features')
    useLegacyMode()
  }
})

// Handle version errors gracefully
iframeIO.on('error', (error) => {
  if (error.type === 'UNSUPPORTED_VERSION') {
    console.log(`Peer using v${error.received}, we support v${error.supported}`)
    
    // Show upgrade notice to user
    showUpgradeNotice(`
      Your widget version (v${error.received}) is newer than supported.
      Please refresh the page or contact support.
    `)
  }
})

function useFullFeatures() {
  // Enable all features
  iframeIO.emit('enable_advanced_features', { enabled: true })
}

function useLegacyMode() {
  // Disable advanced features for compatibility
  console.log('Running in legacy mode - some features disabled')
}

function showUpgradeNotice(message) {
  // Show user-friendly upgrade notice
  alert(message)
}
```

## Example 5: Multi-Iframe Management with Session Keys

```javascript
import IOF from 'iframe.io'

class IframeManager {
  constructor() {
    this.connections = new Map()
  }
  
  addIframe(id, element, origin, options = {}) {
    const iframeIO = new IOF({
      type: 'WINDOW',
      debug: true,
      cryptoAuth: {
        secret: process.env.IFRAME_MASTER_SECRET,
        requireSigned: true,
        enableSessionKeys: true,
        sessionKeyRotationInterval: 3600000
      },
      ...options
    })
    
    iframeIO.initiate(element.contentWindow, origin)
    
    // Monitor connection
    iframeIO.on('connect', () => {
      console.log(`Iframe ${id} connected`)
      const stats = iframeIO.getStats()
      console.log(`  Session key: ${stats.sessionKeyId}`)
    })
    
    // Monitor key rotation
    iframeIO.on('session_key_rotating', (data) => {
      console.log(`Iframe ${id} rotating key to ${data.keyId}`)
    })
    
    this.connections.set(id, iframeIO)
    return iframeIO
  }
  
  async broadcast(event, payload) {
    const promises = []
    
    for (const [id, io] of this.connections) {
      promises.push(
        io.emitAsyncSigned(event, payload, 5000)
          .catch(error => {
            console.error(`Broadcast to ${id} failed:`, error)
            return null
          })
      )
    }
    
    return await Promise.all(promises)
  }
  
  getConnectionStats() {
    const stats = {}
    
    for (const [id, io] of this.connections) {
      stats[id] = io.getStats()
    }
    
    return stats
  }
  
  disconnect(id) {
    const io = this.connections.get(id)
    if (io) {
      io.disconnect()
      this.connections.delete(id)
    }
  }
  
  disconnectAll() {
    for (const io of this.connections.values()) {
      io.disconnect()
    }
    this.connections.clear()
  }
}

// Usage
const manager = new IframeManager()

// Add multiple iframes
manager.addIframe(
  'analytics',
  document.getElementById('analytics-iframe'),
  'https://analytics.example.com'
)

manager.addIframe(
  'chat',
  document.getElementById('chat-iframe'),
  'https://chat.example.com'
)

manager.addIframe(
  'payments',
  document.getElementById('payments-iframe'),
  'https://payments.example.com',
  {
    cryptoAuth: {
      secret: process.env.PAYMENTS_SECRET,
      requireSigned: true,
      enableSessionKeys: true,
      sessionKeyRotationInterval: 1800000  // More frequent for payments
    }
  }
)

// Broadcast to all iframes
await manager.broadcast('user_event', {
  type: 'page_view',
  page: '/dashboard'
})

// Get all connection stats
const allStats = manager.getConnectionStats()
console.log('All iframe stats:', allStats)

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  manager.disconnectAll()
})
```

## Security Best Practices Summary

1. **Always use HTTPS** in production
2. **Enable session keys** for sensitive applications
3. **Validate origins** strictly
4. **Use allowedIncomingEvents** to limit attack surface
5. **Implement custom validation** for all payloads
6. **Monitor all error events** for security incidents
7. **Maintain audit logs** for compliance
8. **Set appropriate rotation intervals**:
   - High security (banking): 15-30 minutes
   - Standard (healthcare): 30-60 minutes
   - Low risk: 1-2 hours
9. **Test disconnection and reconnection** thoroughly
10. **Keep master secrets secure** (use environment variables)