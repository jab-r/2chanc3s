# Post API

## Overview

Adds simple, device-owned posts.

- Create: `POST /v1/post/create`
- Delete: `POST /v1/post/delete`

Ownership rule: **only the authenticated `deviceId` owner can delete a message** because delete targets the document keyed by `${deviceId}:${messageId}`. A caller cannot delete another device’s post without that device’s token.

Location rule: the client is responsible for converting text/address → coordinates. The server stores a **privacy-first derived geolocator** (no raw lat/long persisted on the post).

Additional simplification:
- If `location` is omitted or `null`, the server derives the geolocator from the device’s last known location.
- If `location` is provided, the server derives the geolocator from the provided coordinates.
- The post stores **H3 only** (no S2 in v1).

---

## Data model

### Collection: `posts`

**Document id**: `${deviceId}:${messageId}`

**Fields**

```ts
{
  deviceId: string,
  username?: string | null,
  messageId: string,
  time: string,                 // ISO timestamp (or serverTimestamp)
  content: string,
  contentType: string,          // defaults to 'text/plain', or MIME type for media

  // Privacy-first derived location. Raw coordinates are NOT stored in the post.
  geolocator?: {
    h3?: string,                // derived token at chosen resolution
    accuracyM?: number
  } | null,

  locationSource?: 'device' | 'userProvided',
  geolocatorStatus?: 'resolved' | 'missing_device_location',

  // Optional media attachment reference
  mediaId?: string | null       // Reference to finalized media from postMedia collection
}
```

---

## POST `/v1/post/create`

### Auth
Requires `Authorization: Bearer <token>`.

`deviceId` is taken from auth token/custom claims.

### Request

```json
{
  "message": "hello world",
  "messageId": "client-generated-id",
  "username": "johndoe",
  "contentType": "text/plain",
  "location": { "latitude": 40.7128, "longitude": -74.0060, "accuracyM": 25 },
  "mediaId": "abc123-def456"
}
```

#### Fields
- `message` (required): string content.
- `messageId` (required): client-generated id for idempotency.
- `username` (required): client username to display post by and enable responding.
- `contentType` (optional): defaults to `text/plain`. Use MIME types like `image/jpeg` or `video/mp4` for media posts.
- `location` (optional, nullable):
  - If omitted or `null`, derive geolocator from device last-known location stored by the location subsystem.
  - If provided, it must be `{ latitude, longitude, accuracyM? }` and the server derives geolocator from these coordinates.
- `mediaId` (optional): reference to finalized media from `/v1/posts/media/finalize`. See [Post Media API](../loxation-server/docs/api/post-media.md).
  - If provided, media must exist and be owned by the authenticated device.
  - Media can be reused across multiple posts.

### Behavior
- Stores/upserts in `posts` using document id `${deviceId}:${messageId}`.
- Idempotency:
  - If the doc already exists, return `200` (no duplicate).
  - If newly created, return `201`.
- Location:
  - Store only derived geolocator tokens (`H3`); do not persist raw coordinates in the post.

### Response

`201 Created` (or `200 OK` if already existed)

```json
{
  "deviceId": "dev_...",
  "messageId": "client-generated-id",
  "time": "2026-01-09T15:00:00.000Z",
  "contentType": "text/plain",
  "geolocatorStatus": "resolved"
}
```

---

## POST `/v1/post/delete`

### Auth
Requires `Authorization: Bearer <token>`.

### Request

```json
{ "messageId": "client-generated-id" }
```

### Behavior
- Computes doc id `${deviceId}:${messageId}` using the authenticated device id.
- Deletes that doc if present.
- Returns success regardless of whether it existed (**idempotent hard delete**).

### Response

`200 OK`

```json
{ "success": true }
```

---

## Notes on geolocator derivation

1. Inputs are either (a) device last-known coordinates from the location subsystem, or (b) client-provided coordinates.
2. Resolution selection is intentionally **city/neighborhood scale** (privacy-first). Current implementation uses H3 resolution 8 for better accuracy readings and H3 resolution 7 otherwise.
3. The post stores only the derived token (`geolocator.h3`) plus optional `accuracyM`.
