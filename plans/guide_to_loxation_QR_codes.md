# Guide to Loxation QR Codes

This document explains how to create QR codes that deep link into the Loxation app for initiating DM conversations.

## Overview

Loxation supports two types of QR code deep links:

| Type | URL Format | Privacy | Use Case |
|------|------------|---------|----------|
| **Username** | `loxation://reply?username=...` | Low - username visible | Public profiles, business cards |
| **Identity Link (#eu)** | `loxation://m/#eu/{base64}` | High - encrypted, revocable | Anonymous contact sharing |

---

## 1. Username-Based QR Codes

### URL Format
```
loxation://reply?username={username}&messageId={optional}
```

### Parameters
| Parameter | Required | Description |
|-----------|----------|-------------|
| `username` | Yes | The user's Loxation username |
| `messageId` | No | Optional message ID for reply context |

### Example URLs
```
loxation://reply?username=alice
loxation://reply?username=bob&messageId=abc123
```

### How It Works
1. iOS Camera scans QR code → shows "Open in Loxation"
2. App receives URL via `handleURL()` → routes to `handleReplyDeepLink()`
3. App resolves username:
   - First checks local profile cache (case-insensitive)
   - If not found, queries Discovery API: `POST /v1/discovery/users/discover` with `usernames: [username]`
4. Persists discovered profile
5. Navigates to DM with resolved user

### Generating the QR Code (Browser/Web)

```javascript
function generateUsernameQR(username) {
  const url = `loxation://reply?username=${encodeURIComponent(username)}`;
  // Use any QR library (qrcode.js, etc.)
  return QRCode.toDataURL(url);
}
```

### Pros/Cons
- **Pro**: Simple, human-readable
- **Pro**: No server-side storage needed
- **Con**: Username is visible in QR code
- **Con**: Cannot be revoked
- **Con**: Username changes break existing QR codes

---

## 2. Identity Link QR Codes (#eu)

### URL Format
```
loxation://m/#eu/{base64url(entropy + handle)}
```

### Data Structure (48 bytes total)
| Bytes | Field | Description |
|-------|-------|-------------|
| 0-31 | `entropy` | 32-byte random secret (client-only, never sent to server) |
| 32-47 | `handle` | 16-byte UUID for server lookup |

### How It Works

#### Creation (in-app)
1. User creates identity link in app (Profile → QR Code Links → Create)
2. App generates:
   - 32 bytes random `entropy` via `SecRandomCopyBytes`
   - 16-byte UUID `handle`
3. App creates `EncryptedIdentityPayload`:
   ```json
   {
     "nostrPubkey": "hex...",
     "deviceId": "uuid-string",
     "label": "Coffee shop flyer",
     "created": "2024-01-15T...",
     "version": 1
   }
   ```
4. Derives AES-256-GCM key from entropy using HKDF-SHA256
5. Encrypts payload with derived key
6. POSTs encrypted blob to `POST /v1/identity-link` with handle
7. Stores `entropy + handle + label` locally in Keychain
8. Generates QR code URL: `loxation://m/#eu/{base64url(entropy + handle)}`

#### Scanning (deep link)
1. iOS Camera scans QR code → "Open in Loxation"
2. App receives URL via `handleIdentityLinkDeepLink()`
3. Parses URL → extracts `entropy` (32 bytes) and `handle` (16 bytes)
4. Fetches encrypted blob: `GET /v1/identity-link/{handle}`
5. Decrypts blob using entropy-derived key → gets `deviceId` and `nostrPubkey`
6. Checks local profile cache for deviceId
7. If not cached, queries Discovery API:
   - First: `DiscoveryFilters(inGroup: [deviceId])`
   - Fallback: `DiscoveryFilters(pubs: [nostrPubkey])`
8. Persists discovered profile
9. Navigates to Lobby tab → opens DM

### Server API

#### Create Identity Link
```
POST /v1/identity-link
Authorization: Bearer {token}
Content-Type: application/json

{
  "handle": "550e8400-e29b-41d4-a716-446655440000",
  "encryptedBlob": "base64..."
}
```

#### Resolve Identity Link (no auth required)
```
GET /v1/identity-link/{handle}

Response: raw encrypted blob bytes
```

#### Revoke Identity Link
```
DELETE /v1/identity-link/{handle}
Authorization: Bearer {token}
```

### Privacy Properties
- **Server never sees**: entropy, decryption key, identity payload
- **Server only stores**: `handle → encrypted_blob` mapping
- **Revocable**: DELETE removes server blob, QR becomes invalid
- **Unlinkable**: Different QR codes for same user have different handles

### Generating from Browser (NOT RECOMMENDED)

Identity links should be created **in-app only** because:
1. Entropy must never leave the client
2. Encryption requires the user's Nostr keypair
3. Server registration requires authenticated session

If you need programmatic creation, use the app's Share functionality or export the QR image.

### Pros/Cons
- **Pro**: Privacy-preserving (no visible identity in QR)
- **Pro**: Revocable (delete server blob)
- **Pro**: Trackable (label shows which QR was scanned)
- **Con**: Requires server infrastructure
- **Con**: More complex implementation

---

## QR Code Best Practices

### Error Correction Level
Use **Level H (High)** for printed materials:
```swift
// iOS
let filter = CIFilter.qrCodeGenerator()
filter.correctionLevel = "H"  // 30% error correction
```

### Minimum Size
- **Print**: Minimum 2cm x 2cm (0.8" x 0.8")
- **Screen**: Minimum 150px x 150px

### Quiet Zone
Maintain white border of at least 4 modules around QR code

### Testing
Always test scanned QR with iOS Camera before distribution

---

## Universal Links (Alternative)

For web-to-app flow, Universal Links provide a fallback webpage:

```
https://loxation.chat/reply?username={username}
```

If app installed → opens app
If app not installed → shows webpage with App Store link

Configure in `apple-app-site-association`:
```json
{
  "applinks": {
    "apps": [],
    "details": [{
      "appID": "TEAM_ID.chat.loxation",
      "paths": ["/reply/*"]
    }]
  }
}
```

---

## Quick Reference

### Username QR
```
loxation://reply?username=alice
```

### Identity Link QR
```
loxation://m/#eu/AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyBVDoQA4ptB1KcWRGZVRAA
```

### Flow Comparison

| Step | Username | Identity Link |
|------|----------|---------------|
| 1. Scan | ✓ | ✓ |
| 2. Parse URL | Extract username | Extract entropy + handle |
| 3. Resolve | Discovery API (username) | GET blob → decrypt → Discovery API (deviceId/pubkey) |
| 4. Navigate | DM | DM |
| Revocable | No | Yes |
| Privacy | Low | High |
