# Post Media API Guide

This guide covers the Post Media API endpoints and the `postMedia` Firestore collection structure.

## Overview

The Post Media system enables uploading images, videos, and live streams to public posts using Cloudflare services:
- **Images**: Cloudflare Images (with auto-generated variants: thumbnail, medium, large, public)
- **Videos**: Cloudflare Stream (with HLS playback via TUS resumable uploads)
- **Live Streams**: Cloudflare Stream Live (with RTMPS/WebRTC ingest and HLS playback)

---

## Upload Flow

### Step 1: Request Upload URL

**POST /v1/posts/media/upload-url** (Authentication Required)

Request body:
```json
{
  "type": "image" | "video" | "live",
  "filename": "photo.jpg",        // Optional (not used for live)
  "contentType": "image/jpeg",    // Optional (not used for live)
  "fileSize": 15728640,           // REQUIRED for video uploads (bytes)
  "title": "My livestream",       // Optional, for live streams
  "recordToVod": true,            // Optional, auto-record live to VOD
  "metadata": {}                  // Optional user-defined metadata
}
```

**Important: `fileSize` is required for video uploads.** This is because Cloudflare Stream uses the TUS protocol which requires knowing the file size upfront via the `Upload-Length` header. Images don't require `fileSize` as Cloudflare Images handles this differently.

Response (Image):
```json
{
  "uploadUrl": "https://upload.cloudflareimages.com/...",
  "uploadId": "abc123-def456",
  "expiresIn": 1800,
  "type": "image"
}
```

Response (Video):
```json
{
  "uploadUrl": "https://upload.videodelivery.net/tus/...",
  "uploadId": "video789-uid",
  "expiresIn": 21600,
  "type": "video",
  "protocol": "tus"
}
```

Response (Live Stream):
```json
{
  "uploadId": "live-input-uid",
  "type": "live",
  "ingestUrl": "rtmps://live.cloudflare.com:443/live/...",
  "webrtcUrl": "https://customer-xxx.cloudflarestream.com/.../webRTC/publish",
  "playbackUrl": "https://customer-xxx.cloudflarestream.com/.../manifest/video.m3u8",
  "iframe": "https://customer-xxx.cloudflarestream.com/.../iframe"
}
```

### Step 2: Upload to Cloudflare

**For Images:** POST multipart/form-data to the `uploadUrl`

**For Videos:** Use TUS protocol client to upload to `uploadUrl`. The TUS protocol enables resumable uploads for large files.

**For Live Streams:** No upload step - start streaming immediately using the `ingestUrl` (RTMPS) or `webrtcUrl` (WebRTC). Share the `playbackUrl` with viewers.

### Step 3: Finalize Upload (Images/Videos only)

**POST /v1/posts/media/finalize** (Authentication Required)

```json
{
  "uploadId": "abc123-def456"
}
```

Response contains the public URLs for the media (see Document Structure below).

---

## Fetching Media

The `postMedia` collection stores finalized media. Fetch a document by `mediaId`:

```typescript
const mediaDoc = await db.collection('postMedia').doc(mediaId).get();
const mediaData = mediaDoc.data();
```

Or use the public API endpoint (no authentication required):

```
GET /v1/posts/media/:mediaId
```

---

## Document Structure

Documents in the `postMedia` collection have three possible structures based on the media `type`:

### Image Document

```typescript
interface PostMediaImage {
  mediaId: string;          // Unique identifier (same as document ID)
  type: 'image';            // Media type discriminator
  publicUrl: string;        // Primary public URL (same as variants.public)
  variants: ImageVariants;  // All available image size variants
  deviceId: string;         // ID of the device that uploaded this media
  locationId: string;       // Location context where media was uploaded
  finalizedAt: string;      // ISO 8601 timestamp when upload was finalized
}

interface ImageVariants {
  public: string;           // Original/full-size image URL
  thumbnail: string;        // Small thumbnail (~150px)
  medium: string;           // Medium resolution (~600px)
  large: string;            // Large resolution (~1200px)
}
```

**Example Image Document:**

```json
{
  "mediaId": "abc123-def456",
  "type": "image",
  "publicUrl": "https://imagedelivery.net/<account_hash>/abc123-def456/public",
  "variants": {
    "public": "https://imagedelivery.net/<account_hash>/abc123-def456/public",
    "thumbnail": "https://imagedelivery.net/<account_hash>/abc123-def456/thumbnail",
    "medium": "https://imagedelivery.net/<account_hash>/abc123-def456/medium",
    "large": "https://imagedelivery.net/<account_hash>/abc123-def456/large"
  },
  "deviceId": "device_xyz",
  "locationId": "loc_123",
  "finalizedAt": "2026-01-15T10:30:00.000Z"
}
```

### Video Document

```typescript
interface PostMediaVideo {
  mediaId: string;          // Unique identifier (same as document ID)
  type: 'video';            // Media type discriminator
  publicUrl: string;        // HLS playback URL
  thumbnail: string;        // Video thumbnail image URL
  iframe: string;           // Embeddable iframe HTML
  status: VideoStatus;      // Processing status
  duration: number;         // Video duration in seconds
  deviceId: string;         // ID of the device that uploaded this media
  locationId: string;       // Location context where media was uploaded
  finalizedAt: string;      // ISO 8601 timestamp when upload was finalized
}

type VideoStatus = 'pending' | 'ready' | 'error';
```

**Example Video Document:**

```json
{
  "mediaId": "video789-uid",
  "type": "video",
  "publicUrl": "https://customer-<code>.cloudflarestream.com/video789-uid/manifest/video.m3u8",
  "thumbnail": "https://customer-<code>.cloudflarestream.com/video789-uid/thumbnails/thumbnail.jpg",
  "iframe": "<iframe src=\"https://customer-<code>.cloudflarestream.com/video789-uid/iframe\" ...></iframe>",
  "status": "ready",
  "duration": 45.5,
  "deviceId": "device_xyz",
  "locationId": "loc_123",
  "finalizedAt": "2026-01-15T10:30:00.000Z"
}
```

### Live Stream Document

```typescript
interface PostMediaLive {
  mediaId: string;          // Unique identifier (same as document ID, liveInputId)
  type: 'live';             // Media type discriminator
  publicUrl: string;        // HLS playback URL
  iframe: string;           // Embeddable iframe URL
  title: string;            // Stream title
  status: LiveStatus;       // Stream status
  recordToVod: boolean;     // Whether auto-recording to VOD is enabled
  deviceId: string;         // ID of the device that created this stream
  locationId: string;       // Location context where stream was created
  createdAt: string;        // ISO 8601 timestamp when stream was created
}

type LiveStatus = 'created' | 'live' | 'ended';
```

**Example Live Stream Document:**

```json
{
  "mediaId": "live-input-uid",
  "type": "live",
  "publicUrl": "https://customer-<code>.cloudflarestream.com/live-input-uid/manifest/video.m3u8",
  "iframe": "https://customer-<code>.cloudflarestream.com/live-input-uid/iframe",
  "title": "My Livestream",
  "status": "live",
  "recordToVod": true,
  "deviceId": "device_xyz",
  "locationId": "loc_123",
  "createdAt": "2026-01-15T10:30:00.000Z"
}
```

> **Note:** Ingest URLs (RTMPS/WebRTC) are NOT stored in the database for security reasons. They are only returned in the initial API response when creating the live stream.

---

## Live Streaming

### Important: Live Input UID vs Video Output UID

When working with Cloudflare Stream Live, it's critical to understand the difference between two UIDs:

| UID Type | Description | Used For |
|----------|-------------|----------|
| **Live Input UID** | Static ID created when you set up the stream | Ingest (RTMPS/WebRTC), stored as `mediaId` |
| **Video Output UID** | Dynamic ID created each time a broadcast starts | **Playback (HLS)** |

When `recording.mode: 'automatic'` is enabled (our default), Cloudflare creates a **new Video Output UID** each time a broadcast starts. The `publicUrl` initially stored uses the Live Input UID, but browsers need the Video Output UID for playback.

**Solution:** Use the `/streaming-url` endpoint (see below) to get the correct playback URL.

### GET /v1/posts/media/:mediaId/streaming-url

**Get the current playback URL for a live stream.** This endpoint fetches the actual Video Output UID from Cloudflare and returns the correct HLS URL that browsers can play.

**No authentication required** - this is a public endpoint for viewers.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `refresh` | boolean | Optional. Set to `true` to force a fresh fetch from Cloudflare (bypasses 30-second cache) |

**Response (Active/Recent Broadcast):**
```json
{
  "mediaId": "live-input-uid",
  "streamingUrl": "https://customer-xxx.cloudflarestream.com/<video-output-uid>/manifest/video.m3u8",
  "iframeUrl": "https://customer-xxx.cloudflarestream.com/<video-output-uid>/iframe",
  "videoId": "<video-output-uid>",
  "status": "live-inprogress",
  "type": "live",
  "cached": false
}
```

**Response (Cached - within 30 seconds of last fetch):**
```json
{
  "mediaId": "live-input-uid",
  "streamingUrl": "https://customer-xxx.cloudflarestream.com/<video-output-uid>/manifest/video.m3u8",
  "videoId": "<video-output-uid>",
  "status": "live-inprogress",
  "type": "live",
  "cached": true,
  "cacheAge": 15
}
```

**Response (No Broadcast):**
```json
{
  "mediaId": "live-input-uid",
  "streamingUrl": null,
  "status": "no_broadcast",
  "message": "No active or recent broadcast found for this live input. Start broadcasting first."
}
```

**Status Values:**
- `live-inprogress` - Broadcast is currently live
- `ready` - Broadcast ended, recording is available as VOD
- `pendingupload` - Recording is processing
- `no_broadcast` - No broadcast has started yet

### Ingest Protocols

Live streams support two ingest protocols:

| Protocol | URL Format | Use Case |
|----------|------------|----------|
| **RTMPS** | `rtmps://live.cloudflare.com:443/live/{streamKey}` | OBS, streaming software, hardware encoders |
| **WebRTC** | `https://customer-xxx.cloudflarestream.com/.../webRTC/publish` | Browser-based streaming, mobile apps |

### Playback

**⚠️ Important:** Do NOT use the `publicUrl` stored in the document for live playback. Instead, call the `/streaming-url` endpoint to get the correct playback URL.

```typescript
// Correct way to get live stream playback URL
const response = await fetch(`/v1/posts/media/${mediaId}/streaming-url`);
const data = await response.json();
const hlsUrl = data.streamingUrl;  // Use this for playback
```

The playback URL format uses the **Video Output UID** (not the Live Input UID):
- `https://customer-xxx.cloudflarestream.com/{videoOutputUid}/manifest/video.m3u8`

Content-Types for playback:
- **HLS Manifest:** `application/vnd.apple.mpegurl`
- **HLS Segments:** `video/mp2t` (MPEG-TS) or `video/mp4` (fMP4)

### Example: Starting a Live Stream (iOS/Swift)

```swift
// 1. Request live stream credentials
let response = try await api.post("/v1/posts/media/upload-url", body: [
    "type": "live",
    "title": "My Stream",
    "recordToVod": true
])

// 2. Configure RTMP streaming
let rtmpUrl = response.ingestUrl  // rtmps://live.cloudflare.com:443/live/...
// Use a library like HaishinKit to stream to this URL

// 3. Share playback URL with viewers
let playbackUrl = response.playbackUrl
```

### Example: Watching a Live Stream

```typescript
// Step 1: Get the correct streaming URL (NOT publicUrl from postMedia document!)
const response = await fetch(`/v1/posts/media/${mediaId}/streaming-url`);
const data = await response.json();

if (!data.streamingUrl) {
  // No active broadcast
  showWaitingMessage(data.message);
  return;
}

// Step 2: Play with HLS.js (web)
import Hls from 'hls.js';

const video = document.getElementById('video') as HTMLVideoElement;
if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(data.streamingUrl);  // Correct Video Output UID URL
  hls.attachMedia(video);
}

// Native iOS/macOS - use AVPlayer with data.streamingUrl
// Native Android - use ExoPlayer with data.streamingUrl
```

---

## Usage Patterns

### Determining Media Type

Always check the `type` field first to handle the document appropriately:

```typescript
const mediaData = mediaDoc.data();

if (mediaData.type === 'image') {
  // Handle image - use variants for different sizes
  displayImage(mediaData.variants.medium);
} else if (mediaData.type === 'video') {
  // Handle video - use publicUrl for HLS playback
  initVideoPlayer(mediaData.publicUrl);
}
```

### Using Image Variants

For images, choose the appropriate variant based on your use case:

| Variant     | Use Case                           | Approximate Size |
|-------------|-------------------------------------|------------------|
| `thumbnail` | List views, previews, avatars       | ~150px           |
| `medium`    | Feed items, cards, detail views     | ~600px           |
| `large`     | Full-screen viewing, galleries      | ~1200px          |
| `public`    | Original quality, downloads         | Original size    |

```typescript
// In a list/feed view
const listImageUrl = mediaData.variants.thumbnail;

// In a detail view
const detailImageUrl = mediaData.variants.medium;

// For full-screen gallery
const fullImageUrl = mediaData.variants.large;
```

### Handling Video Status

Videos require processing before they're ready for playback. Always check the `status` field:

```typescript
const videoData = mediaDoc.data();

switch (videoData.status) {
  case 'ready':
    // Video is ready for playback
    initVideoPlayer(videoData.publicUrl);
    break;
  case 'pending':
    // Video is still processing
    showProcessingIndicator();
    // Consider polling or listening for updates
    break;
  case 'error':
    // Processing failed
    showErrorState();
    break;
}
```

### Video Playback

The `publicUrl` for videos is an HLS manifest (`.m3u8`). Use an HLS-compatible player:

```typescript
// Using HLS.js (web)
import Hls from 'hls.js';

const video = document.getElementById('video');
if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(videoData.publicUrl);
  hls.attachMedia(video);
}

// Native iOS/macOS - use AVPlayer directly with the HLS URL
// Native Android - use ExoPlayer with the HLS URL
```

### Using the iframe (Videos)

For simple embedding without a custom player, use the provided iframe HTML:

```html
<!-- The iframe field contains ready-to-use HTML -->
<div class="video-container">
  ${videoData.iframe}
</div>
```

---

## API Response Examples

### GET /v1/posts/media/:mediaId (Image)

```json
{
  "mediaId": "abc123-def456",
  "type": "image",
  "publicUrl": "https://imagedelivery.net/<hash>/abc123-def456/public",
  "variants": {
    "public": "https://imagedelivery.net/<hash>/abc123-def456/public",
    "thumbnail": "https://imagedelivery.net/<hash>/abc123-def456/thumbnail",
    "medium": "https://imagedelivery.net/<hash>/abc123-def456/medium",
    "large": "https://imagedelivery.net/<hash>/abc123-def456/large"
  }
}
```

### GET /v1/posts/media/:mediaId (Video)

```json
{
  "mediaId": "video789-uid",
  "type": "video",
  "publicUrl": "https://customer-<code>.cloudflarestream.com/video789-uid/manifest/video.m3u8",
  "thumbnail": "https://customer-<code>.cloudflarestream.com/video789-uid/thumbnails/thumbnail.jpg",
  "iframe": "<iframe src=\"...\" ...></iframe>",
  "status": "ready",
  "duration": 45.5
}
```

### GET /v1/posts/media/:mediaId (Live Stream)

```json
{
  "mediaId": "live-input-uid",
  "type": "live",
  "publicUrl": "https://customer-<code>.cloudflarestream.com/live-input-uid/manifest/video.m3u8",
  "iframe": "https://customer-<code>.cloudflarestream.com/live-input-uid/iframe",
  "title": "My Livestream",
  "status": "live",
  "recordToVod": true
}
```

---

## Caching

- API responses include `Cache-Control: public, max-age=86400` (24 hours)
- Cloudflare CDN caches the actual media files at edge locations
- Image variant URLs are stable and can be cached client-side indefinitely
- Video URLs may change if re-encoded; rely on the `publicUrl` from the document

---

## Field Reference

| Field         | Type     | Present In       | Description |
|---------------|----------|------------------|-------------|
| `mediaId`     | string   | All types        | Unique identifier, matches document ID |
| `type`        | string   | All types        | `'image'`, `'video'`, or `'live'` |
| `publicUrl`   | string   | All types        | Primary URL for the media (HLS playback URL for video/live) |
| `variants`    | object   | Image only       | Object with `public`, `thumbnail`, `medium`, `large` URLs |
| `thumbnail`   | string   | Video only       | Video thumbnail image URL |
| `iframe`      | string   | Video, Live      | Embeddable iframe URL/HTML |
| `status`      | string   | Video, Live      | Video: `pending`, `ready`, or `error`. Live: `created`, `live`, or `ended` |
| `duration`    | number   | Video only       | Duration in seconds |
| `title`       | string   | Live only        | Stream title |
| `recordToVod` | boolean  | Live only        | Whether auto-recording to VOD is enabled |
| `deviceId`    | string   | All types        | Uploader's device ID (for authorization) |
| `locationId`  | string   | All types        | Location context of upload |
| `finalizedAt` | string   | Image, Video     | ISO 8601 timestamp of finalization |
| `createdAt`   | string   | Live only        | ISO 8601 timestamp when stream was created |

---

## Error Handling

When fetching media, handle these scenarios:

```typescript
async function getMedia(mediaId: string) {
  try {
    const response = await fetch(`/v1/posts/media/${mediaId}`);
    
    if (response.status === 404) {
      // Media not found or was deleted
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch media:', error);
    throw error;
  }
}
```

---

## Related Collections

| Collection          | Purpose |
|--------------------|---------|
| `postMedia`        | Finalized, publicly accessible media |
| `pendingPostMedia` | Media uploads in progress (not yet finalized) |
| `posts`            | Post documents that may reference media via `mediaId` |
