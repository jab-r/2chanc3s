# Live Video Playback Fix Plan

## Problem
Live stream posts (`type: 'live'`) are not displaying as videos on 2chanc3s.com - only the text caption is shown.

## Root Cause Analysis

Cloudflare Stream Live uses two different UIDs:
- **Live Input UID** - Static ID used for ingest (RTMPS/WebRTC)
- **Video Output UID** - Dynamic ID created when broadcast starts, needed for HLS playback

The `publicUrl` stored in postMedia initially uses the Live Input UID, which doesn't work for playback.

## Solution: Server-Side URL Update (New Flow)

The loxation-server now provides a `POST /v1/posts/media/:mediaId/broadcast-started` endpoint that:
1. iOS client calls this endpoint after starting the RTMP/WebRTC stream
2. Server fetches the Video Output UID from Cloudflare
3. Server updates `publicUrl` in postMedia with the correct playback URL

This means the `publicUrl` in Firestore will always have the correct playback URL once the broadcast starts.


## Implementation Changes

### 1. API Changes (feed.ts, search.ts)

**Current behavior for live posts:**
```typescript
result.set(docId, {
  type: 'live',
  mediaId: docId,  // For frontend to call /streaming-url
  status: data.status,
  title: data.title,
});
```

**New behavior - return publicUrl as stream:**
```typescript
result.set(docId, {
  type: 'live',
  stream: data.publicUrl,    // The updated publicUrl with Video Output UID
  status: data.status,
  title: data.title,
});
```

### 2. Frontend Changes (app.js, favorites.js)

**Current approach:** Frontend fetches `/streaming-url` to get the playback URL.

**New approach:** Treat live posts like videos - use the `stream` URL directly.

Update `renderMedia()` to render live posts similar to videos:
```javascript
if (media.type === 'live') {
  const streamUrl = media.stream;
  if (!streamUrl) {
    // Show "Starting soon" message
    return `<div class="live-badge waiting">Starting soon...</div>`;
  }
  // Use same video rendering as type: 'video'
  // ... video element with data-stream="${streamUrl}" ...
}
```

Remove the `/streaming-url` fetch logic from `initVideoPlayer()`.

### 3. Types Update (types.ts)

Ensure MediaInfo supports `stream` for live type:
```typescript
export type MediaInfo = {
  type: 'image' | 'video' | 'live';
  // ... existing fields ...
  stream?: string;  // HLS URL for video and live
  // Remove mediaId - no longer needed
};
```

## Status Badge Logic

For live posts, show status badge based on:
- `status === 'created'` and no `stream` → "Starting soon..."
- `status === 'live'` with `stream` → "🔴 LIVE"
- `status === 'ended'` with `stream` → "📹 Recorded"

## Migration Notes

- The iOS client is being updated to call `/broadcast-started` after connecting
- Existing live posts created before this change may still have the old publicUrl
- For these cases, the frontend should show "Starting soon" until the broadcaster restarts

## File Changes Summary

| File | Change |
|------|--------|
| `api/src/routes/feed.ts` | Return `stream: publicUrl` instead of `mediaId` for live |
| `api/src/routes/search.ts` | Same change |
| `api/src/types.ts` | Remove `mediaId` from MediaInfo (optional cleanup) |
| `web/public/app.js` | Simplify live rendering to use stream URL like video |
| `web/public/favorites.js` | Same change |
