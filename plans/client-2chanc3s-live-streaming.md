# 2chanc3s Live Streaming Implementation Guide

This guide explains how to display live streams from Loxation on the 2chanc3s website by reading directly from Firestore.

## Overview

The 2chanc3s website reads the `postMedia` collection directly from Firestore using the Firebase JS SDK. This bypasses the API server entirely, avoiding CORS issues.

```
┌──────────────┐     ┌───────────────┐     ┌──────────────────────┐
│  2chanc3s    │     │   Firestore   │     │  Cloudflare Stream   │
│  Website     │────►│  postMedia    │     │  (HLS Playback)      │
│              │     │  collection   │     │                      │
│              │     └───────────────┘     │                      │
│              │                           │                      │
│  HLS.js      │──────────────────────────►│  video.m3u8          │
│  Player      │                           │                      │
└──────────────┘                           └──────────────────────┘
```

## Prerequisites

1. **Firebase Project Config** - Get the Firebase config from the project admin
2. **HLS.js** - For playing HLS streams in browsers that don't support native HLS

## Step 1: Initialize Firebase

```html
<!-- Firebase SDK -->
<script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore-compat.js"></script>

<!-- HLS.js for video playback -->
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
```

```javascript
// Initialize Firebase with your project config
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
```

## Step 2: Read Live Stream Data

```javascript
/**
 * Get live stream playback URL from Firestore
 * @param {string} mediaId - The live stream media ID
 * @returns {Promise<{publicUrl: string, status: string, title: string} | null>}
 */
async function getLiveStreamData(mediaId) {
  try {
    const doc = await db.collection('postMedia').doc(mediaId).get();
    
    if (!doc.exists) {
      console.error('Media not found:', mediaId);
      return null;
    }
    
    const data = doc.data();
    
    // Verify this is a live stream
    if (data.type !== 'live') {
      console.error('Media is not a live stream:', data.type);
      return null;
    }
    
    return {
      mediaId: data.mediaId,
      publicUrl: data.publicUrl,  // This is the HLS manifest URL
      iframe: data.iframe,
      title: data.title,
      status: data.status,        // 'created', 'live', 'ended'
      streamStatus: data.streamStatus, // 'live-inprogress', 'ready', etc.
      currentVideoId: data.currentVideoId, // The Video Output UID
    };
  } catch (error) {
    console.error('Error fetching live stream:', error);
    return null;
  }
}
```

## Step 3: Play the Stream with HLS.js

```javascript
/**
 * Initialize HLS player for a live stream
 * @param {string} mediaId - The live stream media ID
 * @param {HTMLVideoElement} videoElement - The video element to attach to
 */
async function playLiveStream(mediaId, videoElement) {
  const streamData = await getLiveStreamData(mediaId);
  
  if (!streamData) {
    showError('Stream not found');
    return;
  }
  
  if (!streamData.publicUrl) {
    showError('Stream URL not available. The broadcast may not have started yet.');
    return;
  }
  
  console.log('Playing stream:', streamData.publicUrl);
  
  // Check if browser supports HLS natively (Safari)
  if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
    videoElement.src = streamData.publicUrl;
    videoElement.play();
  } 
  // Use HLS.js for other browsers
  else if (Hls.isSupported()) {
    const hls = new Hls({
      // Enable low-latency mode for live streams
      lowLatencyMode: true,
      liveSyncDuration: 3,
      liveMaxLatencyDuration: 10,
    });
    
    hls.loadSource(streamData.publicUrl);
    hls.attachMedia(videoElement);
    
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      videoElement.play();
    });
    
    hls.on(Hls.Events.ERROR, (event, data) => {
      console.error('HLS error:', data);
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            showError('Network error - stream may have ended');
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            showError('Fatal playback error');
            hls.destroy();
            break;
        }
      }
    });
    
    return hls; // Return for cleanup
  } else {
    showError('Your browser does not support HLS playback');
  }
}

function showError(message) {
  console.error(message);
  // Update your UI to show the error
}
```

## Step 4: Real-time Updates (Optional)

Listen for real-time changes to the stream status:

```javascript
/**
 * Subscribe to real-time updates for a live stream
 * @param {string} mediaId - The live stream media ID
 * @param {function} onUpdate - Callback when stream data changes
 * @returns {function} Unsubscribe function
 */
function subscribeToStream(mediaId, onUpdate) {
  return db.collection('postMedia').doc(mediaId)
    .onSnapshot((doc) => {
      if (doc.exists) {
        const data = doc.data();
        onUpdate({
          mediaId: data.mediaId,
          publicUrl: data.publicUrl,
          status: data.status,
          streamStatus: data.streamStatus,
          currentVideoId: data.currentVideoId,
        });
      } else {
        onUpdate(null);
      }
    }, (error) => {
      console.error('Snapshot error:', error);
    });
}

// Usage:
const unsubscribe = subscribeToStream('your-media-id', (data) => {
  if (!data) {
    console.log('Stream deleted');
    return;
  }
  
  console.log('Stream updated:', data.status);
  
  // If publicUrl changed (new broadcast started), reload player
  if (data.publicUrl !== currentUrl) {
    reloadPlayer(data.publicUrl);
  }
});

// Don't forget to unsubscribe when done
// unsubscribe();
```

## Complete Example Page

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Live Stream - 2chanc3s</title>
  <style>
    .video-container {
      max-width: 800px;
      margin: 0 auto;
    }
    video {
      width: 100%;
      background: #000;
    }
    .status {
      padding: 10px;
      text-align: center;
    }
    .status.live { background: #4CAF50; color: white; }
    .status.offline { background: #f44336; color: white; }
    .status.loading { background: #ff9800; color: white; }
    .error { color: red; padding: 20px; text-align: center; }
  </style>
</head>
<body>
  <div class="video-container">
    <div id="status" class="status loading">Loading...</div>
    <video id="video" controls playsinline></video>
    <div id="error" class="error" style="display: none;"></div>
  </div>

  <!-- Firebase SDK -->
  <script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore-compat.js"></script>
  
  <!-- HLS.js -->
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  
  <script>
    // =====================================================
    // CONFIGURATION - Update these values
    // =====================================================
    const FIREBASE_CONFIG = {
      apiKey: "YOUR_API_KEY",
      authDomain: "your-project.firebaseapp.com",
      projectId: "your-project-id",
      storageBucket: "your-project.appspot.com",
      messagingSenderId: "123456789",
      appId: "1:123456789:web:abc123"
    };
    
    // Get mediaId from URL query param: ?stream=abc123
    const urlParams = new URLSearchParams(window.location.search);
    const MEDIA_ID = urlParams.get('stream') || 'YOUR_DEFAULT_MEDIA_ID';
    
    // =====================================================
    // INITIALIZATION
    // =====================================================
    firebase.initializeApp(FIREBASE_CONFIG);
    const db = firebase.firestore();
    
    const videoElement = document.getElementById('video');
    const statusElement = document.getElementById('status');
    const errorElement = document.getElementById('error');
    
    let hls = null;
    let currentUrl = null;
    
    // =====================================================
    // MAIN LOGIC
    // =====================================================
    function updateStatus(text, type) {
      statusElement.textContent = text;
      statusElement.className = 'status ' + type;
    }
    
    function showError(message) {
      errorElement.textContent = message;
      errorElement.style.display = 'block';
      updateStatus('Error', 'offline');
    }
    
    function hideError() {
      errorElement.style.display = 'none';
    }
    
    function playStream(url) {
      if (url === currentUrl) return;
      currentUrl = url;
      hideError();
      
      // Cleanup previous player
      if (hls) {
        hls.destroy();
        hls = null;
      }
      
      console.log('Playing:', url);
      
      if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari)
        videoElement.src = url;
        videoElement.play().catch(e => console.log('Autoplay blocked:', e));
      } else if (Hls.isSupported()) {
        // HLS.js for Chrome, Firefox, etc.
        hls = new Hls({
          lowLatencyMode: true,
          liveSyncDuration: 3,
          liveMaxLatencyDuration: 10,
        });
        
        hls.loadSource(url);
        hls.attachMedia(videoElement);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoElement.play().catch(e => console.log('Autoplay blocked:', e));
        });
        
        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              showError('Playback error. Stream may have ended.');
            }
          }
        });
      } else {
        showError('Your browser does not support HLS video playback.');
      }
    }
    
    // Subscribe to real-time updates
    db.collection('postMedia').doc(MEDIA_ID).onSnapshot((doc) => {
      if (!doc.exists) {
        showError('Stream not found');
        return;
      }
      
      const data = doc.data();
      
      if (data.type !== 'live') {
        showError('This is not a live stream');
        return;
      }
      
      // Update status display
      const statusMap = {
        'created': { text: 'Waiting for broadcast...', type: 'loading' },
        'live': { text: '🔴 LIVE', type: 'live' },
        'ended': { text: 'Stream ended', type: 'offline' },
      };
      const statusInfo = statusMap[data.status] || { text: data.status, type: 'loading' };
      updateStatus(statusInfo.text, statusInfo.type);
      
      // Play if we have a URL
      if (data.publicUrl) {
        playStream(data.publicUrl);
      } else {
        updateStatus('Waiting for stream URL...', 'loading');
      }
    }, (error) => {
      console.error('Firestore error:', error);
      showError('Failed to connect to stream data');
    });
  </script>
</body>
</html>
```

## Firestore Security Rules

**Note:** The current Firestore rules deny all client-side access. To use direct Firestore reads from 2chanc3s, the project admin needs to update `firestore.rules`:

```javascript
rules_version = '2';
 
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow public read access to postMedia collection
    match /postMedia/{mediaId} {
      allow read: if true;  // Public read
      allow write: if false; // No client writes
    }
    
    // Deny all other client-side access
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**Alternative:** If you cannot update Firestore rules, the iOS app can share the `publicUrl` directly through another channel (e.g., a shared link or embed code).

## Troubleshooting

### "Stream not found"
- Verify the `mediaId` is correct
- Check Firestore rules allow read access

### "Stream URL not available"
- The iOS app hasn't called `/broadcast-started` yet
- Wait a few seconds after the broadcast starts

### Video loads but shows black screen
- The broadcast may not have started yet
- Check `status` field - should be "live" when actively streaming

### "Network error" during playback
- Stream may have ended
- Check `streamStatus` field - "ready" means stream ended and VOD is available

## Document Structure

The `postMedia` document for live streams contains:

| Field | Type | Description |
|-------|------|-------------|
| `mediaId` | string | Same as document ID (Live Input UID) |
| `type` | string | Always `"live"` for live streams |
| `publicUrl` | string | HLS manifest URL for playback |
| `iframe` | string | Embed URL for iframe |
| `title` | string | Stream title |
| `status` | string | `"created"`, `"live"`, or `"ended"` |
| `streamStatus` | string | `"live-inprogress"`, `"ready"`, etc. |
| `currentVideoId` | string | The Video Output UID (different from mediaId) |
| `deviceId` | string | ID of the broadcasting device |
| `locationId` | string | Location context |
| `createdAt` | string | ISO timestamp |
| `broadcastStartedAt` | string | ISO timestamp when broadcast was detected |
