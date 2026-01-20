# Messaging API

## Overview

The Messaging API provides end-to-end encrypted messaging capabilities using AES-GCM encryption, supporting secure communication between users and groups. This API now only handles key exchange operations, while actual message delivery is handled by the WebSocket server in the loxation-messaging service.

> **IMPORTANT ARCHITECTURAL CHANGE**: This API now only handles key exchange. All message sending, retrieval, and deletion is handled by the WebSocket server. This change improves security by ensuring that encrypted messages are not stored on the server and are only delivered in real-time when participants are online.

> **NEW FEATURE**: The API now supports group messaging with multiple recipients. A single key exchange operation can establish secure channels with multiple participants simultaneously.

## Base URL

```
/v1/messaging
```

## Authentication

All endpoints require authentication using JWT tokens and a valid device ID. Include the token in the Authorization header:

```http
Authorization: Bearer <your-jwt-token>
```

**Note:** The authenticated user must have a valid device ID. Operations will fail with an `unauthorized` error if the device ID is not set.

## Data Structures

### Message

```typescript
{
  id: string;
  sessionId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  encryptedContent: string;
  nonce: string;        // Used for message uniqueness
  iv: string;           // Initialization Vector for AES-GCM encryption
  type: string;
  timestamp: Date;
  delivered: boolean;
  expiresAt?: Date;     // Optional expiration timestamp
  isDeleted?: boolean;
  locationId?: string;  // The location context for this message
}
```

### Session

```typescript
{
  id: string;
  participantDeviceIds: string[];
  publicKeys: Record<string, string>;  // ECDH public keys for key exchange (deviceId -> publicKey)
  locationId: string;                  // The location context for this session
  createdAt: Date;
  lastMessageAt?: Date;
  lastMessage?: {
    content: string;
    senderDeviceId: string;
    timestamp: Date;
  };
  isDeleted?: boolean;
}
```

## Endpoints

> **IMPORTANT**: Only the key exchange endpoint is available through the REST API. All message sending, retrieval, and deletion operations must be performed through the WebSocket API. See [WebSocket API](../websocket/overview.md) for details.

### Exchange Encryption Keys

Initiates a secure messaging session by exchanging public keys.

```http
POST /v1/messaging/keys/exchange
```
---

### Encrypted Attachment Upload Endpoints

These endpoints allow clients to upload large, encrypted binary message attachments (such as photos or files) using a presigned URL workflow. This is decoupled from user profiles and supports arbitrary metadata.

> **Note:** These endpoints are for encrypted message attachments only. All message sending, retrieval, and deletion is still handled by the WebSocket API.

#### Access Model for Attachments

| Operation | Authentication | Description |
|-----------|---------------|-------------|
| Request Upload URL | Required | Get presigned upload URL from API |
| Binary Upload | **None** | Direct PUT to Cloudflare R2 - no Firebase auth needed |
| Finalize Upload | Required | Complete upload via API |
| Get Download URL | Required | Get presigned download URL from API |
| Binary Download | **None** | Direct download from Cloudflare R2 - no Firebase auth needed |
| Delete | Required | Delete blob via API |

> **Important:** While API endpoints require Bearer token authentication, the actual binary upload and download operations use Cloudflare R2 presigned URLs which do **not** require Firebase authentication tokens. The Cloudflare URLs are pre-authorized and self-contained.

#### Request Presigned Upload URL

Initiate an upload by requesting a presigned URL. This endpoint also supports creating protected live streams.

```http
POST /v1/messaging/presigned-upload
Content-Type: application/json
Authorization: Bearer <your-jwt-token>
```

**Request Body (File Attachment):**
```json
{
  "filename": "encrypted-photo.bin",
  "contentType": "application/octet-stream",
  "metadata": {
    "originalName": "photo.jpg",
    "encryption": "AES-GCM",
    "iv": "base64-iv-string"
  }
}
```

**Response (File Attachment):**
```json
{
  "uploadUrl": "https://storage.example.com/...",
  "uploadId": "abc123",
  "expiresIn": 3600
}
```

- Upload the encrypted binary data directly to `uploadUrl` using HTTP PUT.
- **No Firebase authentication is required** for this PUT request - the presigned URL contains all necessary authorization.

---

#### Protected Live Streams

For MLS-protected live streaming, use `contentType: 'video/x-live'`. This creates a live input with a signed playback URL that can be encrypted and distributed via MLS/Nostr.

**Request Body (Protected Live Stream):**
```json
{
  "contentType": "video/x-live",
  "title": "Private stream for group",
  "recordToVod": false
}
```

**Response (Protected Live Stream):**
```json
{
  "type": "live",
  "liveInputId": "live-input-uid",
  "ingestUrl": "rtmps://live.cloudflare.com:443/live/...",
  "webrtcUrl": "https://customer-xxx.cloudflarestream.com/.../webRTC/publish",
  "signedPlaybackUrl": "https://videodelivery.net/.../manifest/video.m3u8?token=...",
  "expiresAt": 1705795200,
  "expiresIn": 86400
}
```

**Usage:**
1. The broadcaster uses `ingestUrl` (RTMPS) or `webrtcUrl` (WebRTC) to stream
2. Encrypt the `signedPlaybackUrl` using MLS group key
3. Send via Nostr kind 445 message to authorized viewers
4. Viewers decrypt and use the signed URL to watch

**Important:**
- No server-side storage of stream metadata - the URL is meant for distribution via Nostr/MLS
- The signed playback URL expires after `expiresIn` seconds (default: 24 hours)
- Ingest URLs contain the stream key - never share them publicly

**Content-Types for playback:**
- **HLS Manifest:** `application/vnd.apple.mpegurl`
- **HLS Segments:** `video/mp2t` or `video/mp4`

#### Finalize Upload

Notify the server that the upload is complete.

```http
POST /v1/messaging/finalize-upload
Content-Type: application/json
Authorization: Bearer <your-jwt-token>
```

**Request Body:**
```json
{
  "uploadId": "abc123"
}
```

**Response:**
```json
{
  "blobId": "abc123",
  "metadata": {
    // metadata and storage info
  },
  "downloadUrl": "https://storage.example.com/...",
  "expiresIn": 3600
}
```

- The `downloadUrl` is a pre-signed URL that is valid for the specified `expiresIn` seconds (default: 1 hour).
- The URL includes a `content-disposition: attachment` header to force download rather than inline display.

#### Delete Uploaded Blob

Delete the uploaded binary blob and its metadata (e.g., after message receipt).

```http
DELETE /v1/messaging/delete-upload/:blobId
Authorization: Bearer <your-jwt-token>
```

**Response:**
```json
{
  "success": true
}
```

#### Download Attachment

Get a download URL for an encrypted message attachment.

```http
GET /v1/messaging/download/:blobId
Authorization: Bearer <your-jwt-token>
```

**Response:**
```json
{
  "downloadUrl": "https://storage.example.com/...",
  "expiresIn": 3600
}
```

- The `downloadUrl` is a pre-signed Cloudflare R2 URL that is valid for the specified `expiresIn` seconds (default: 1 hour).
- **No Firebase authentication is required** for downloading - the presigned URL contains all necessary authorization.
- The URL includes a `content-disposition: attachment` header to force download rather than inline display.

**Notes:**
- All uploads must be encrypted client-side. The server never sees plaintext.
- Metadata can include any fields needed for decryption or context.
- These endpoints are not tied to user profiles or reference counting.
- Deletion is explicit and should be triggered after the message is received and processed.

---

**Request Body:**
```json
{
  "recipientIds": ["device-id-1", "device-id-2"],
  "publicKey": "base64-encoded-public-key"
}
```

**Response:** (201 Created)
```json
{
  "sessionId": "session123",
  "recipientPublicKeys": {
    "device-id-1": "base64-encoded-recipient-public-key-1",
    "device-id-2": "base64-encoded-recipient-public-key-2"
  }
}
```

### WebSocket-Based Messaging

For sending and receiving messages, use the WebSocket API instead of REST endpoints. The WebSocket server provides real-time message delivery without server-side storage of encrypted content.

Key features of the WebSocket messaging:
- Pure real-time message relay
- No message persistence on the server
- Messages are only delivered if recipients are online
- Support for group messaging with multiple recipients
- Clients must implement local storage and retry logic

See [WebSocket API Documentation](../websocket/overview.md) for complete details on connecting and sending messages.

## Message Types

### Text Messages
```json
{
  "id": "message-unique-id",
  "sessionId": "session123",
  "senderDeviceId": "device-id-1",
  "recipientDeviceId": "device-id-2",
  "type": "text",
  "encryptedContent": "encrypted-text-content",
  "nonce": "message-uniqueness-id",
  "iv": "aes-gcm-initialization-vector",
  "timestamp": "2025-04-17T14:55:00.000Z",
  "delivered": false,
  "locationId": "location-123"
}
```

### Photo Messages
```json
{
  "id": "message-unique-id",
  "sessionId": "session123",
  "senderDeviceId": "device-id-1",
  "recipientDeviceId": "device-id-2",
  "type": "photo",
  "encryptedContent": "encrypted-photo-data",
  "nonce": "message-uniqueness-id",
  "iv": "aes-gcm-initialization-vector",
  "timestamp": "2025-04-17T14:55:00.000Z",
  "delivered": false,
  "locationId": "location-123"
}
```

## Encryption Process

### Key Exchange (ECDH)
1. Client A generates ECDH key pair
2. Client A sends ECDH public key to server along with list of recipient device IDs
3. Server stores public key and creates a session with all participants
4. Each recipient client retrieves A's ECDH public key
5. Each recipient client generates their own ECDH key pair
6. Each recipient client sends their ECDH public key to server
7. Client A and each recipient derive the same shared secret using ECDH
8. All clients derive AES keys from their respective shared secrets
9. Secure session established with shared symmetric keys between all participants

### Message Encryption (AES-GCM)
1. Sender generates random IV (Initialization Vector)
2. Sender encrypts message with AES-GCM using shared key and IV
3. Sender generates unique nonce for message identification
4. Sender sends encrypted message, IV, and nonce
5. Recipient decrypts with shared key and IV

## Error Responses

### Invalid Request (400)
Possible validation error messages:

1. Missing Parameters:
```json
{
  "error": {
    "code": "invalid_request",
    "message": "Missing required parameters"
  }
}
```

2. Missing Session ID:
```json
{
  "error": {
    "code": "invalid_request",
    "message": "Missing sessionId parameter"
  }
}
```

3. Invalid Message Type:
```json
{
  "error": {
    "code": "invalid_request",
    "message": "Invalid message type",
    "details": {
      "allowedTypes": ["text", "photo"]
    }
  }
}
```

### Unauthorized (401)
```json
{
  "error": {
    "code": "unauthorized",
    "message": "User not authenticated"
  }
}
```

### Internal Error (500)
All 500 errors include detailed cause information when available:

1. Key Exchange Error:
```json
{
  "error": {
    "code": "internal_error",
    "message": "Failed to exchange keys",
    "details": {
      "cause": "Error message from underlying system"
    }
  }
}
```

2. Message Send Error:
```json
{
  "error": {
    "code": "internal_error",
    "message": "Failed to send message",
    "details": {
      "cause": "Error message from underlying system"
    }
  }
}
```

3. Message Retrieval Error:
```json
{
  "error": {
    "code": "internal_error",
    "message": "Failed to get messages",
    "details": {
      "cause": "Error message from underlying system"
    }
  }
}
```

4. Delete Operation Error:
```json
{
  "error": {
    "code": "internal_error",
    "message": "Failed to delete message/session",
    "details": {
      "cause": "Error message from underlying system"
    }
  }
}
```

## Common Error Codes
- `invalid_request`: Missing or invalid parameters (includes validation failures)
- `unauthorized`: Authentication required or missing username
- `internal_error`: Server processing error (includes detailed cause when available)

## Best Practices

1. **Security**
   - Use strong encryption
   - Rotate keys regularly
   - Validate all inputs
   - Handle key storage securely on the client
   - Implement proper key management for group messaging

2. **Client-Side Message Handling**
   - Implement local message storage
   - Implement retry logic for offline recipients
   - Store undelivered messages locally
   - Implement UI for message delivery status
   - Handle group message delivery status tracking

3. **WebSocket Connection Management**
   - Implement reconnection with exponential backoff
   - Handle connection state changes
   - Monitor connection health with ping/pong
   - Implement proper error handling
   - Optimize for multiple concurrent sessions

4. **Privacy**
   - Store messages only on client devices
   - Implement client-side message expiry
   - Provide options to clear message history
   - Implement end-to-end encryption properly
   - Consider privacy implications of group messaging

5. **Group Messaging**
   - Implement efficient key management for multiple recipients
   - Handle member join/leave operations securely
   - Consider implementing forward secrecy for group chats
   - Implement proper UI for group conversations
   - Handle offline members appropriately

## Implementation Examples

### Key Exchange with ECDH
```javascript
// Generate an ECDH key pair
async function generateEcdhKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveKey', 'deriveBits']
  );
  
  // Export the public key for sharing
  const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeyBase64 = bytesToBase64(new Uint8Array(publicKeyBuffer));
  
  return {
    keyPair,
    publicKeyBase64
  };
}

// Exchange keys with the server
async function exchangeKeys(recipientIds, publicKeyBase64) {
  const response = await fetch('/v1/messaging/keys/exchange', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      recipientIds,
      publicKey: publicKeyBase64
    })
  });
  return response.json();
}

// Derive a shared key from the ECDH key exchange
async function deriveSharedKey(privateKey, recipientPublicKeyBase64) {
  // Import the recipient's public key
  const publicKeyBuffer = base64ToBytes(recipientPublicKeyBase64);
  const publicKey = await crypto.subtle.importKey(
    'spki',
    publicKeyBuffer,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false,
    []
  );
  
  // Derive the shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: publicKey
    },
    privateKey,
    256
  );
  
  // Derive an AES key from the shared secret
  const aesKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );
  
  return aesKey;
}

// Example usage
async function setupSecureChannel(recipientIds) {
  // Generate our key pair
  const { keyPair, publicKeyBase64 } = await generateEcdhKeyPair();
  
  // Exchange keys with the server
  const session = await exchangeKeys(recipientIds, publicKeyBase64);
  
  // Derive shared keys with each recipient
  const sharedKeys = {};
  for (const [deviceId, publicKey] of Object.entries(session.recipientPublicKeys)) {
    sharedKeys[deviceId] = await deriveSharedKey(keyPair.privateKey, publicKey);
  }
  
  return {
    sessionId: session.sessionId,
    sharedKeys
  };
}
```

### Sending Messages with WebSocket
```javascript
// Connect to WebSocket server
const socket = new WebSocket('wss://api.loxation.com/v1/ws');

// Set up connection
socket.addEventListener('open', () => {
  console.log('WebSocket connection established');
});

// Handle incoming messages
socket.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'message') {
    // Handle incoming message
    console.log('New message received:', data.message);
    
    // Decrypt the message
    const decryptedContent = await decryptWithAesGcm(
      data.message.encryptedContent,
      data.message.iv,
      getSharedKeyForSession(data.message.sessionId)
    );
    
    // Update UI with decrypted message
    displayMessage(decryptedContent);
  } else if (data.type === 'error' && data.error.code === 'recipient_offline') {
    // Handle offline recipient error
    console.log('Recipient is offline, message not delivered');
    
    // Store message locally for retry
    storeUndeliveredMessage(data.error.details.messageId);
    
    // Update UI to show message is pending
    updateMessageStatus(data.error.details.messageId, 'pending');
  }
});

// Send encrypted message via WebSocket
async function sendMessage(recipientDeviceId, sessionId, content) {
  // Get the shared key for this recipient
  const sharedKey = await getSharedKeyForRecipient(sessionId, recipientDeviceId);
  
  // Encrypt content using AES-GCM
  const { encryptedContent, iv } = await encryptWithAesGcm(content, sharedKey);
  
  // Generate a unique nonce for message identification
  const nonce = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  
  // Create message object
  const message = {
    type: 'message',
    message: {
      id: messageId,
      sessionId,
      senderUsername: currentUsername,
      recipientUsername,
      encryptedContent,
      iv,
      nonce,
      type: 'text',
      timestamp: new Date().toISOString()
    }
  };
  
  // Send via WebSocket
  socket.send(JSON.stringify(message));
  
  // Store message locally until delivery confirmation
  storeLocalMessage(message);
  
  return messageId;
}

// Example usage
const messageId = await sendMessage('johndoe', 'session123', 'Hello!');
```

### Encryption Helper Functions
```javascript
// Encrypt a message using AES-GCM
async function encryptWithAesGcm(plaintext, sharedKey) {
  // Generate a random 12-byte IV
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // Convert key from base64 to bytes
  const keyBytes = base64ToBytes(sharedKey);
  
  // Encrypt the message
  const encryptedBytes = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      tagLength: 128
    },
    keyBytes,
    new TextEncoder().encode(plaintext)
  );
  
  return {
    encryptedContent: bytesToBase64(new Uint8Array(encryptedBytes)),
    iv: bytesToBase64(iv)
  };
}

// Decrypt a message using AES-GCM
async function decryptWithAesGcm(encryptedContent, iv, sharedKey) {
  // Convert from base64 to bytes
  const encryptedBytes = base64ToBytes(encryptedContent);
  const ivBytes = base64ToBytes(iv);
  const keyBytes = base64ToBytes(sharedKey);
  
  // Decrypt the message
  const decryptedBytes = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes,
      tagLength: 128
    },
    keyBytes,
    encryptedBytes
  );
  
  return new TextDecoder().decode(decryptedBytes);
}
```

## Rate Limiting
Standard API rate limits apply. See [Rate Limiting](../guides/rate-limiting.md) for details.