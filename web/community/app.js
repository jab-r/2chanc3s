import { latLngToCell, gridDisk, cellToBoundary, cellToLatLng } from 'h3-js';
import QRCode from 'qrcode';

// Configure this to your Cloud Run URL, e.g. https://api-xxxxx-uc.a.run.app
// If your Cloudflare Pages site proxies to the API, this can remain "".
const API_BASE = '';

const statusEl = document.getElementById('status');
const locInfoEl = document.getElementById('locInfo');
const listEl = document.getElementById('list');
const btnLocate = document.getElementById('btnLocate');
const btnGeocode = document.getElementById('btnGeocode');
const btnSearch = document.getElementById('btnSearch');
const btnClear = document.getElementById('btnClear');
const searchEl = document.getElementById('search');
const addressEl = document.getElementById('address');
const kEl = document.getElementById('k');
const limitEl = document.getElementById('limit');

let lastGeo = null;
let lastH3 = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setLocInfo(lat, lng, h3Cell, source) {
  if (locInfoEl) {
    locInfoEl.textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)} | H3: ${h3Cell} | via ${source}`;
  }
}

function escapeText(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ====== PLATFORM DETECTION ======
// On iOS, ONLY Safari supports Universal Links. ALL other iOS browsers need custom URL scheme.
// Simple approach: if it's iOS and NOT Safari, use custom scheme fallback.
//
const ua = navigator.userAgent || '';
const isIOS = /iPhone|iPad|iPod/i.test(ua);
const isAndroid = /Android/i.test(ua);

// Safari on iOS: contains "Safari" but NOT any third-party browser identifiers.
// Known iOS browser UA markers:
// - CriOS = Chrome, FxiOS = Firefox, OPiOS = Opera, EdgiOS = Edge, Brave = Brave
// - DuckDuckGo, Focus (Firefox Focus), Coast, etc. also exist
// All third-party browsers on iOS also have "Safari" in UA (WebKit requirement),
// so we must exclude them explicitly.
const isIOSSafari = isIOS && /Safari/i.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS|Brave|DuckDuckGo|Focus/i.test(ua);

// Any iOS browser that's NOT Safari needs custom scheme fallback
const isIOSNotSafari = isIOS && !isIOSSafari;

// Desktop detection: not iOS, not Android
const isDesktop = !isIOS && !isAndroid;

console.log('[Platform]', { isIOS, isAndroid, isIOSSafari, isIOSNotSafari, isDesktop, ua: ua.substring(0, 120) });

// ====== REPLY URL GENERATORS ======

// Custom URL scheme for app - works on iOS Chrome, and as fallback
function replyUrlCustomScheme(username, messageId) {
  const u = encodeURIComponent(username);
  const m = encodeURIComponent(messageId);
  return `loxation://reply?username=${u}&messageId=${m}`;
}

// HTTPS URL for web fallback page (also Universal Link host)
function replyUrlHTTPS(username, messageId) {
  const u = encodeURIComponent(username);
  const m = encodeURIComponent(messageId);
  return `https://public.loxation.com/reply?username=${u}&messageId=${m}`;
}

// Android intent:// URL with Play Store fallback
function replyUrlAndroid(username, messageId) {
  const u = encodeURIComponent(username);
  const m = encodeURIComponent(messageId);
  const fallback = encodeURIComponent('https://play.google.com/store/apps/details?id=com.jabresearch.loxation');
  return `intent://reply?username=${u}&messageId=${m}#Intent;scheme=loxation;package=com.jabresearch.loxation;S.browser_fallback_url=${fallback};end`;
}

/**
 * Get the appropriate reply URL based on platform
 * - iOS Safari: HTTPS Universal Link (cross-domain triggers app)
 * - iOS Chrome: Custom scheme with fallback handling via onclick
 * - Android: Intent URL with Play Store fallback
 * - Desktop: HTTPS to web page
 */
function getReplyUrl(username, messageId) {
  if (isAndroid) {
    return replyUrlAndroid(username, messageId);
  }
  // For iOS Chrome, we return HTTPS but handle click specially
  // For iOS Safari, HTTPS Universal Link works
  // For desktop, HTTPS to web page
  return replyUrlHTTPS(username, messageId);
}

/**
 * Handle Reply button click - special handling for iOS non-Safari browsers
 * iOS Safari supports Universal Links, but all other iOS browsers (Chrome, Firefox, etc.)
 * need custom scheme with fallback to web page
 */
function handleReplyClick(event, username, messageId) {
  if (!isIOSNotSafari) {
    // Let the default href work:
    // - iOS Safari: Universal Link opens app
    // - Android: intent:// opens app with Play Store fallback
    // - Desktop: opens web page
    return true;
  }
  
  // iOS non-Safari browser: try custom scheme with fallback
  event.preventDefault();
  
  const customUrl = replyUrlCustomScheme(username, messageId);
  const fallbackUrl = replyUrlHTTPS(username, messageId);
  
  openAppWithFallback(customUrl, fallbackUrl);
  return false;
}

/**
 * Attempt to open app via custom scheme with web fallback
 * Used for iOS Chrome where Universal Links don't work
 */
function openAppWithFallback(customSchemeUrl, fallbackWebUrl) {
  // Record when we started
  const startTime = Date.now();
  
  // Flag to track if user interaction happened (page visibility changed)
  let userLeftPage = false;
  
  // Listen for visibility change (indicates app might be opening)
  const handleVisibilityChange = () => {
    if (document.hidden) {
      userLeftPage = true;
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  // Attempt to open the custom scheme
  window.location.href = customSchemeUrl;
  
  // After timeout, check if we should redirect to fallback
  setTimeout(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    
    // Only redirect if:
    // 1. User didn't leave the page (app didn't open)
    // 2. Page is still visible
    // 3. Enough time has passed (not instant failure)
    const elapsed = Date.now() - startTime;
    if (!userLeftPage && !document.hidden && elapsed >= 1400) {
      // App probably not installed - redirect to web fallback
      console.log('[openAppWithFallback] App did not open, redirecting to fallback');
      window.location.href = fallbackWebUrl;
    }
  }, 1500);
}

// Make handleReplyClick available globally for onclick handlers
window.handleReplyClick = handleReplyClick;

// ====== QR CODE GENERATION ======

/**
 * Generate QR code as data URL for desktop reply
 * @param {string} url - The URL to encode in the QR code
 * @returns {Promise<string|null>} Data URL of the QR code image, or null on error
 */
async function generateQRCodeDataUrl(url) {
  try {
    return await QRCode.toDataURL(url, {
      width: 180,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#1a1a1a', light: '#fffdf7' }
    });
  } catch (err) {
    console.error('[QRCode] Generation failed:', err);
    return null;
  }
}

/**
 * Decode base64url string to Uint8Array
 * @param {string} str - base64url encoded string
 * @returns {Uint8Array}
 */
function base64urlToBytes(str) {
  // Replace base64url chars with standard base64
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  const padded = base64 + '==='.slice(0, (4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert UUID string to 16-byte Uint8Array
 * @param {string} uuid - UUID string (with or without dashes)
 * @returns {Uint8Array}
 */
function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Encode Uint8Array to base64url string
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  // Convert to base64url: replace + with -, / with _, remove padding
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate identity link QR code URL from entropy and handle
 * Format: loxation://m/#eu/{base64url(entropy + handle)}
 * @param {string} entropy - base64url-encoded 32-byte entropy
 * @param {string} handle - UUID string (16 bytes)
 * @returns {string} The identity link URL
 */
function getIdentityLinkQRUrl(entropy, handle) {
  // Decode entropy from base64url to bytes (32 bytes)
  const entropyBytes = base64urlToBytes(entropy);
  // Convert handle UUID to bytes (16 bytes)
  const handleBytes = uuidToBytes(handle);

  // Concatenate: 32 bytes entropy + 16 bytes handle = 48 bytes
  const combined = new Uint8Array(48);
  combined.set(entropyBytes, 0);
  combined.set(handleBytes, 32);

  // Encode as base64url
  const encoded = bytesToBase64url(combined);

  return `loxation://m/#eu/${encoded}`;
}

/**
 * Render media element for a post
 * @param {Object} media - Media info from API {type, thumbnail, medium, large, public, stream, duration}
 * @returns {string} HTML string for the media element
 */
function renderMedia(media) {
  if (!media) return '';
  
  if (media.type === 'image') {
    const thumbUrl = media.medium || media.thumbnail || media.public;
    const fullUrl = media.large || media.public;
    if (!thumbUrl) return '';
    
    return `
      <div class="post-media">
        <img 
          src="${escapeText(thumbUrl)}" 
          data-full="${escapeText(fullUrl || thumbUrl)}"
          alt="Post image"
          loading="lazy"
          onclick="window.openLightbox(this)"
        />
      </div>
    `;
  }
  
  if (media.type === 'video') {
    const posterUrl = media.thumbnail || '';
    const streamUrl = media.stream;
    if (!streamUrl) return '';
    
    // Generate unique ID for this video element
    const videoId = 'video-' + Math.random().toString(36).slice(2, 9);
    
    // iOS/Safari have native HLS - use <source> with type hint
    // Other browsers use HLS.js initialized on play event
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    const hasNativeHLS = isIOS || isSafari;
    
    if (hasNativeHLS) {
      // Use <source> element with type for iOS/Safari native HLS
      // muted for autoplay; user can tap unmute button to enable sound
      return `
        <div class="post-media video-container">
          <video
            id="${videoId}"
            src="${escapeText(streamUrl)}"
            poster="${escapeText(posterUrl)}"
            controls
            playsinline
            muted
            loop
            preload="metadata"
            webkit-playsinline="true"
          >
            <source src="${escapeText(streamUrl)}" type="application/vnd.apple.mpegurl">
            Your browser does not support video playback.
          </video>
          <button class="unmute-btn" aria-label="Unmute">🔇</button>
        </div>
      `;
    } else {
      // Use data-stream for HLS.js (Chrome, Firefox, etc.)
      // muted for autoplay; user can tap unmute button to enable sound
      return `
        <div class="post-media video-container">
          <video
            id="${videoId}"
            poster="${escapeText(posterUrl)}"
            controls
            playsinline
            muted
            loop
            preload="none"
            data-stream="${escapeText(streamUrl)}"
          >
            Your browser does not support video playback.
          </video>
          <button class="unmute-btn" aria-label="Unmute">🔇</button>
        </div>
      `;
    }
  }
  
  if (media.type === 'live') {
    console.log('[renderMedia] Live type detected, media object:', JSON.stringify(media));
    const streamUrl = media.stream;
    const title = media.title || 'Live Stream';
    const status = media.status || 'created';
    
    // Generate unique ID for this video element
    const videoId = 'live-' + Math.random().toString(36).slice(2, 9);
    
    // Status badge based on stream status
    let statusBadge = '';
    if (status === 'live') {
      statusBadge = '<span class="live-badge">🔴 LIVE</span>';
    } else if (status === 'ended') {
      statusBadge = '<span class="live-badge ended">📹 Recorded</span>';
    } else if (!streamUrl) {
      // No stream URL yet - broadcast hasn't started
      statusBadge = '<span class="live-badge waiting">Starting soon...</span>';
    }
    
    // If no stream URL, show waiting message
    if (!streamUrl) {
      console.log('[renderMedia] Live stream has no stream URL yet (status:', status, ')');
      return `
        <div class="post-media video-container live-container">
          ${statusBadge}
          <div class="live-waiting">Broadcast starting soon...</div>
        </div>
      `;
    }
    
    console.log('[renderMedia] Rendering live video with streamUrl:', streamUrl.substring(0, 50) + '...');
    
    // Use same rendering logic as video type
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    const hasNativeHLS = isIOS || isSafari;
    
    if (hasNativeHLS) {
      return `
        <div class="post-media video-container live-container">
          ${statusBadge}
          <video
            id="${videoId}"
            src="${escapeText(streamUrl)}"
            controls
            playsinline
            muted
            preload="metadata"
            webkit-playsinline="true"
            data-live="true"
          >
            <source src="${escapeText(streamUrl)}" type="application/vnd.apple.mpegurl">
            Your browser does not support live playback.
          </video>
          <button class="unmute-btn" aria-label="Unmute">🔇</button>
        </div>
      `;
    } else {
      return `
        <div class="post-media video-container live-container">
          ${statusBadge}
          <video
            id="${videoId}"
            controls
            playsinline
            muted
            preload="none"
            data-stream="${escapeText(streamUrl)}"
            data-live="true"
          >
            Your browser does not support live playback.
          </video>
          <button class="unmute-btn" aria-label="Unmute">🔇</button>
        </div>
      `;
    }
  }
  
  return '';
}

/**
 * Initialize HLS for a video element
 * Uses the stream URL from the data-stream attribute (set by renderMedia)
 * @param {HTMLVideoElement} videoEl - The video element to initialize
 */
function initVideoPlayer(videoEl) {
  // Only initialize once
  if (videoEl._hlsInitialized) {
    console.log('[initVideoPlayer] Already initialized, skipping');
    return;
  }
  videoEl._hlsInitialized = true;
  
  const isLive = videoEl.dataset.live === 'true';
  const streamUrl = videoEl.dataset.stream;
  
  if (!streamUrl) {
    console.warn('[initVideoPlayer] No stream URL found');
    return;
  }
  
  console.log('[initVideoPlayer] Initializing video:', streamUrl.substring(0, 50) + '...');
  console.log('[initVideoPlayer] canPlayType HLS:', videoEl.canPlayType('application/vnd.apple.mpegurl'));
  console.log('[initVideoPlayer] Hls available:', typeof Hls !== 'undefined');
  console.log('[initVideoPlayer] Hls.isSupported:', typeof Hls !== 'undefined' && Hls.isSupported());
  
  if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS support (Safari, iOS)
    console.log('[initVideoPlayer] Using native HLS');
    videoEl.src = streamUrl;
    videoEl.play().catch((err) => console.log('[initVideoPlayer] Native play error:', err.message));
  } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    // Use HLS.js for other browsers (Chrome, Firefox, Edge)
    console.log('[initVideoPlayer] Using HLS.js, isLive:', isLive);
    const hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: isLive,           // Enable low-latency for live streams
      backBufferLength: isLive ? 30 : 90, // Less buffer for live
      liveDurationInfinity: isLive,     // Infinite duration for live
      liveBackBufferLength: isLive ? 0 : null, // No back buffer for live
    });
    
    // Store reference for cleanup
    videoEl._hls = hls;
    
    hls.loadSource(streamUrl);
    hls.attachMedia(videoEl);
    
    // Auto-play when manifest is ready
    hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      console.log('[HLS] Manifest parsed, levels:', data.levels?.length);
      videoEl.play().catch(err => console.log('[HLS] Play failed:', err.message));
    });
    
    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      console.log('[HLS] Media attached');
    });
    
    hls.on(Hls.Events.ERROR, (event, data) => {
      console.error('[HLS] Error:', data.type, data.details, data.fatal ? '(FATAL)' : '');
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log('[HLS] Trying to recover from network error...');
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('[HLS] Trying to recover from media error...');
            hls.recoverMediaError();
            break;
          default:
            console.error('[HLS] Fatal error, cannot recover');
            hls.destroy();
            break;
        }
      }
    });
  } else {
    // Fallback - try direct source (may not work for HLS streams)
    console.warn('[initVideoPlayer] No HLS support, trying direct playback');
    videoEl.src = streamUrl;
    videoEl.play().catch((err) => console.log('[initVideoPlayer] Direct play error:', err.message));
  }
}

/**
 * Lightbox functions
 */
function openLightbox(imgEl) {
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxVideo = document.getElementById('lightbox-video');
  
  if (!lightbox || !lightboxImg || !lightboxVideo) return;
  
  lightboxImg.src = imgEl.dataset.full || imgEl.src;
  lightboxImg.classList.remove('hidden');
  lightboxVideo.classList.remove('visible');
  lightboxVideo.pause();
  lightboxVideo.src = '';
  
  lightbox.classList.remove('hidden');
  
  // Prevent body scroll
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxVideo = document.getElementById('lightbox-video');
  
  if (!lightbox) return;
  
  lightbox.classList.add('hidden');
  if (lightboxImg) {
    lightboxImg.src = '';
    lightboxImg.classList.remove('hidden');
  }
  if (lightboxVideo) {
    lightboxVideo.pause();
    lightboxVideo.src = '';
    lightboxVideo.classList.remove('visible');
  }
  
  // Restore body scroll
  document.body.style.overflow = '';
}

// Make openLightbox available globally for onclick handler
window.openLightbox = openLightbox;

// Initialize lightbox event listeners
document.addEventListener('DOMContentLoaded', () => {
  const lightbox = document.getElementById('lightbox');
  if (lightbox) {
    const closeBtn = lightbox.querySelector('.lightbox-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeLightbox);
    }
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });
  }
});

// Close lightbox on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

// ====== QR CODE MODAL ======

const qrModal = document.getElementById('qr-modal');
const qrModalImg = document.getElementById('qr-modal-img');
const qrModalTarget = qrModal?.querySelector('.qr-modal-target');

/**
 * Show QR code modal for replying to a post
 * @param {string} username - The post author's username
 * @param {string} messageId - The message ID
 */
/**
 * Show QR code modal for replying to a post
 * Supports both username-based and identity link posts
 * @param {string|null} username - The post author's username (null for anonymous)
 * @param {string} messageId - The message ID
 * @param {string|null} replyLinkHandle - Identity link handle (for anonymous posts)
 * @param {string|null} replyLinkEntropy - Identity link entropy (for anonymous posts)
 * @param {string|null} displayName - Display name for anonymous posts
 */
async function showQRModal(url, targetText) {
  if (!qrModal || !qrModalImg) {
    console.error('[QRModal] Modal elements not found');
    return;
  }

  if (!url) {
    console.error('[QRModal] No URL provided');
    return;
  }

  const dataUrl = await generateQRCodeDataUrl(url);

  if (!dataUrl) {
    console.error('[QRModal] Failed to generate QR code');
    return;
  }

  if (qrModalTarget) {
    qrModalTarget.textContent = targetText;
  }
  qrModalImg.src = dataUrl;
  qrModal.classList.remove('hidden');
}

function hideQRModal() {
  if (qrModal) {
    qrModal.classList.add('hidden');
    if (qrModalImg) qrModalImg.src = '';
  }
}

// Initialize QR modal event listeners
document.addEventListener('DOMContentLoaded', () => {
  if (qrModal) {
    const closeBtn = qrModal.querySelector('.qr-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', hideQRModal);
    }
    qrModal.addEventListener('click', (e) => {
      if (e.target === qrModal) hideQRModal();
    });
  }
});

// Close QR modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideQRModal();
});

/**
 * Initialize and render a map showing H3 cell and accuracy circle
 * @param {HTMLElement} container - The map container element
 * @param {string} h3Cell - H3 cell index (resolution 7)
 * @param {number|undefined} accuracyM - Accuracy in meters
 * @returns {Object} Leaflet map instance
 */
function initPostMap(container, h3Cell, accuracyM) {
  // Get cell center for map centering
  const [lat, lng] = cellToLatLng(h3Cell);
  
  // Get hexagon boundary vertices
  // cellToBoundary returns [[lat, lng], ...] - array of vertex coordinates
  const boundary = cellToBoundary(h3Cell);
  
  // Create map centered on cell
  const map = L.map(container).setView([lat, lng], 13);
  
  // Add OpenStreetMap tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://openstreetmap.org/copyright">OSM</a>'
  }).addTo(map);
  
  // Draw H3 hexagon
  const hexagonStyle = {
    color: '#007aff',
    weight: 2,
    fillColor: '#007aff',
    fillOpacity: 0.15
  };
  const hexagon = L.polygon(boundary, hexagonStyle).addTo(map);
  
  // Draw accuracy circle if available
  if (accuracyM && accuracyM > 0) {
    const circleStyle = {
      color: '#ff6b6b',
      weight: 2,
      fillColor: '#ff6b6b',
      fillOpacity: 0.1,
      dashArray: '5, 5'
    };
    L.circle([lat, lng], {
      radius: accuracyM,
      ...circleStyle
    }).addTo(map);
  }
  
  // Fit bounds to show hexagon (and circle if present)
  const bounds = hexagon.getBounds();
  if (accuracyM && accuracyM > 0) {
    // Extend bounds to include accuracy circle
    const circleBounds = L.latLng(lat, lng).toBounds(accuracyM * 2);
    bounds.extend(circleBounds);
  }
  map.fitBounds(bounds, { padding: [20, 20] });
  
  return map;
}

function renderPosts(posts) {
  listEl.innerHTML = '';
  if (!posts || posts.length === 0) {
    listEl.innerHTML = '<div class="post">No posts found.</div>';
    return;
  }

  // Debug: log posts with media
  const postsWithMedia = posts.filter(p => p.media);
  console.log(`[renderPosts] Total posts: ${posts.length}, posts with media: ${postsWithMedia.length}`);
  if (postsWithMedia.length > 0) {
    console.log('[renderPosts] Posts with media:', postsWithMedia.map(p => ({
      username: p.username,
      messageId: p.messageId,
      contentType: p.contentType,
      mediaType: p.media?.type,
      mediaId: p.media?.mediaId,
      media: p.media
    })));
  } else {
    console.log('[renderPosts] No posts have media data');
  }

  for (const p of posts) {
    const username = p.username || null;
    const messageId = p.messageId;
    const replyLinkHandle = p.replyLinkHandle || null;
    const replyLinkEntropy = p.replyLinkEntropy || null;
    const displayName = p.displayName || null;
    const hasIdentityLink = replyLinkHandle && replyLinkEntropy;

    // Display name: username if available, otherwise displayName or "Anonymous"
    const authorDisplay = username ? `@${username}` : (displayName || 'Anonymous');

    // Compute reply deeplink URL - works for both username and identity link posts
    const replyDeeplinkUrl = username
      ? getReplyUrl(username, messageId)
      : (hasIdentityLink ? getIdentityLinkQRUrl(replyLinkEntropy, replyLinkHandle) : null);

    const full = p.content || '';
    const snippet = full.length > 240 ? full.slice(0, 240) + '…' : full;
    const hasMore = full.length > snippet.length;
    const hasMedia = p.media && (p.media.type === 'image' || p.media.type === 'video' || p.media.type === 'live');
    const hasLocation = p.geolocatorH3;

    // Build QR button data attributes - store the computed URL directly
    const canReply = !!(replyDeeplinkUrl);
    const qrDataAttrs = canReply
      ? `data-url="${escapeText(replyDeeplinkUrl)}" data-target="${escapeText(username ? `@${username}` : (displayName || 'Anonymous'))}"`
      : '';

    const el = document.createElement('div');
    el.className = 'post';
    el.innerHTML = `
      <div class="meta">
        <div>${escapeText(authorDisplay)}</div>
        <div>${escapeText(fmtTime(p.time))}</div>
        <div class="mono">id: ${escapeText(messageId)}</div>
      </div>
      ${renderMedia(p.media)}
      <div class="content" data-full="${escapeText(full)}" data-snippet="${escapeText(snippet)}">${escapeText(snippet)}</div>
      <div class="actions">
        ${replyDeeplinkUrl ? `<a class="btn reply-btn" href="${replyDeeplinkUrl}">Reply (in app)</a>` : ''}
        ${isDesktop ? `<button class="btn btn-qr" ${qrDataAttrs}>Scan QR</button>` : ''}
        ${hasMore && !hasMedia ? '<button class="btn toggle">Show full</button>' : ''}
        ${hasLocation ? `<button class="btn btn-map" data-h3="${escapeText(p.geolocatorH3)}" data-accuracy="${p.accuracyM || ''}">Show on map</button>` : ''}
      </div>
      ${hasLocation ? '<div class="post-map-container"><div class="post-map"></div></div>' : ''}
    `;
    
    // Toggle button for text content
    const toggle = el.querySelector('button.toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const contentEl = el.querySelector('.content');
        const isFull = toggle.dataset.mode === 'full';
        if (isFull) {
          contentEl.textContent = contentEl.dataset.snippet;
          toggle.textContent = 'Show full';
          toggle.dataset.mode = 'snippet';
        } else {
          contentEl.textContent = contentEl.dataset.full;
          toggle.textContent = 'Show less';
          toggle.dataset.mode = 'full';
        }
      });
    }
    
    // Map toggle button
    const mapBtn = el.querySelector('.btn-map');
    if (mapBtn) {
      mapBtn.addEventListener('click', () => {
        const container = el.querySelector('.post-map-container');
        const mapDiv = el.querySelector('.post-map');
        const isExpanded = container.classList.contains('expanded');

        if (isExpanded) {
          container.classList.remove('expanded');
          mapBtn.textContent = 'Show on map';
        } else {
          container.classList.add('expanded');
          mapBtn.textContent = 'Hide map';

          // Lazy init map on first expand
          if (!mapDiv.dataset.initialized) {
            const h3Cell = mapBtn.dataset.h3;
            const accuracy = mapBtn.dataset.accuracy ? parseFloat(mapBtn.dataset.accuracy) : undefined;

            // Small delay to let CSS transition start and container have dimensions
            setTimeout(() => {
              initPostMap(mapDiv, h3Cell, accuracy);
              mapDiv.dataset.initialized = 'true';
            }, 50);
          }
        }
      });
    }

    // QR code button for desktop reply
    const qrBtn = el.querySelector('.btn-qr');
    if (qrBtn) {
      qrBtn.addEventListener('click', async () => {
        const url = qrBtn.dataset.url;
        const target = qrBtn.dataset.target;
        if (url) {
          await showQRModal(url, target);
        }
      });
    }

    listEl.appendChild(el);
  }
  
  // Setup unmute buttons
  document.querySelectorAll('.unmute-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const video = btn.parentElement.querySelector('video');
      if (video) {
        video.muted = !video.muted;
        btn.textContent = video.muted ? '🔇' : '🔊';
        btn.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
      }
    });
  });
  
  // Setup IntersectionObserver for autoplay when videos scroll into view
  setupVideoAutoplay();
}

// Global user sound preference (persists for session)
let userWantsSound = false;

/**
 * Setup IntersectionObserver for video autoplay on scroll
 * Videos autoplay muted when 50% visible, pause when out of view
 */
function setupVideoAutoplay() {
  const videos = document.querySelectorAll('.post-media video');
  console.log('[setupVideoAutoplay] Found videos:', videos.length);
  if (videos.length === 0) return;
  
  videos.forEach((v, i) => {
    console.log(`[setupVideoAutoplay] Video ${i}: id=${v.id}, src=${v.src || 'none'}, data-stream=${v.dataset.stream?.substring(0, 50) || 'none'}`);
  });
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const video = entry.target;
      const container = video.closest('.video-container');
      const unmuteBtn = container?.querySelector('.unmute-btn');
      
      console.log(`[IntersectionObserver] Video ${video.id}: isIntersecting=${entry.isIntersecting}, ratio=${entry.intersectionRatio.toFixed(2)}`);
      
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        console.log(`[IntersectionObserver] Video ${video.id} is visible, data-stream=${!!video.dataset.stream}, data-media-id=${!!video.dataset.mediaId}, initialized=${!!video._hlsInitialized}, src=${!!video.src}`);
        
        // Video is visible - initialize HLS if needed and play
        // Check for regular video (data-stream) or live video (data-media-id)
        const needsInit = (video.dataset.stream || video.dataset.mediaId) && !video._hlsInitialized;
        if (needsInit) {
          // Chrome/Firefox: HLS.js needed - it will call play() when ready
          console.log(`[IntersectionObserver] Calling initVideoPlayer for ${video.id}`);
          initVideoPlayer(video);
        } else if (video.src) {
          // Safari/iOS: native HLS - can play directly
          console.log(`[IntersectionObserver] Playing native video ${video.id}`);
          video.play().catch((err) => console.log('[Video] Native play failed:', err.message));
        }
        
        // Apply user's sound preference
        if (userWantsSound) {
          video.muted = false;
          if (unmuteBtn) {
            unmuteBtn.textContent = '🔊';
            unmuteBtn.setAttribute('aria-label', 'Mute');
          }
        }
      } else {
        // Video is out of view - pause to save resources
        video.pause();
      }
    });
  }, {
    threshold: 0.5 // Trigger when 50% of video is visible
  });
  
  videos.forEach(video => {
    observer.observe(video);
    
    // Track when user manually unmutes
    video.addEventListener('volumechange', () => {
      if (!video.muted) {
        userWantsSound = true;
      }
    });
  });
}

async function apiGet(path, params) {
  const url = new URL(API_BASE + path, API_BASE ? undefined : window.location.origin);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url.toString(), { method: 'GET' });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status} ${text}`);
  }
  return await resp.json();
}

/**
 * Compute H3 tokens for a given location using multi-resolution approach.
 * Server stores h3_res6 (~36km²), h3_res7 (~5km²), h3_res8 (~0.74km²), h3_res9 (~0.11km²).
 *
 * Strategy (optimized for query efficiency and precision):
 * - k=0: use resolution 9 for block-level precision (~330m cell edge)
 * - k=1: use resolution 8 for neighborhood precision (~1.2km cell edge)
 * - k=2-4: use resolution 7 for district-level precision (~3.2km cell edge)
 * - k>=5: use resolution 6 for metro-level efficiency (~8.5km cell edge)
 *
 * Coverage examples:
 * - res9 k=1: ~1km diameter (7 cells) - walking distance
 * - res8 k=1: ~4km diameter (7 cells) - neighborhood
 * - res7 k=2: ~20km diameter (19 cells) - district
 * - res6 k=2: ~50km diameter (19 cells) - metro
 */
function computeH3Tokens(lat, lng, k) {
  // Choose resolution and effective k based on search radius
  // For larger areas, use coarser resolution with smaller k-ring
  let resolution, effectiveK;

  if (k >= 5) {
    // Metro scale: use res 6 (~36 km² per cell, edge ~8.5km)
    resolution = 6;
    effectiveK = Math.min(Math.ceil(k / 5), 3); // Cap at k=3 for res6
  } else if (k >= 2) {
    // District scale: use res 7 (~5 km² per cell, edge ~3.2km)
    resolution = 7;
    effectiveK = k;
  } else if (k === 1) {
    // Neighborhood scale: use res 8 (~0.74 km² per cell, edge ~1.2km)
    resolution = 8;
    effectiveK = 1;
  } else {
    // Block scale (k=0): use res 9 (~0.11 km² per cell, edge ~330m)
    // Still use k=1 to get adjacent cells for better coverage
    resolution = 9;
    effectiveK = 1;
  }

  const centerCell = latLngToCell(lat, lng, resolution);
  const cells = Array.from(gridDisk(centerCell, effectiveK));

  return {
    cells,
    resolution,
    centerCell,
    // Legacy fields for backward compatibility
    r7: resolution === 7 ? cells : [],
    r8: []
  };
}

/**
 * Geocode an address using our API proxy (which calls Nominatim server-side to avoid CORS)
 */
async function geocodeAddress(address) {
  const data = await apiGet('/api/geocode', { q: address });
  return {
    latitude: data.lat,
    longitude: data.lon,
    displayName: data.displayName
  };
}

/**
 * Get IP-based geolocation from Cloudflare (edge-only, instant response)
 * Returns: { lat, lng, city, country, source } or null if unavailable
 */
async function getIPGeolocation() {
  try {
    const resp = await fetch('/api/geoip');
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.lat == null || data.lng == null) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Initialize with IP-based location on page load.
 * Uses metro-wide radius (~60km via H3 res6 k=10) for coarse IP accuracy.
 *
 * H3 Resolution 6: edge ~3.23km, so k=10 gives ~60km diameter coverage
 * Formula: diameter ≈ 2 * k * edge_length = 2 * 10 * 3.23 ≈ 65km
 */
async function initWithIPLocation() {
  setStatus('Detecting your location...');
  
  const geo = await getIPGeolocation();
  if (!geo) {
    setStatus('Could not detect location. Enter a city/address or use GPS.');
    return;
  }
  
  // Use H3 resolution 6 with k=10 for ~60km metro coverage (appropriate for IP accuracy)
  // k=10 at res6 creates 331 cells covering ~65km diameter
  const resolution = 6;
  const k = 10;
  
  const centerCell = latLngToCell(geo.lat, geo.lng, resolution);
  const cells = Array.from(gridDisk(centerCell, k));
  
  lastH3 = {
    cells,
    resolution,
    centerCell,
    r7: [],
    r8: []
  };
  
  const cityDisplay = geo.city || 'your area';
  setLocInfo(geo.lat, geo.lng, centerCell, `IP (${cityDisplay})`);
  
  await loadFeed();
}

async function loadFeed() {
  if (!lastH3) {
    setStatus('Set a location to load nearby posts.');
    return;
  }
  setStatus('Loading…');
  const limit = Number(limitEl.value);
  
  // Use new multi-resolution API
  const params = {
    h3: lastH3.cells.join(','),
    resolution: lastH3.resolution,
    limit
  };
  
  try {
    const data = await apiGet('/api/feed', params);
    renderPosts(data.posts);
    const resLabels = { 6: 'metro', 7: 'district', 8: 'neighborhood', 9: 'block' };
    const resLabel = `${resLabels[lastH3.resolution] || 'res' + lastH3.resolution} (res${lastH3.resolution})`;
    setStatus(`Loaded ${data.posts.length} posts (${lastH3.cells.length} cells, ${resLabel})`);
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
}

async function runSearch() {
  const q = (searchEl.value || '').trim();
  if (q.length < 2) {
    setStatus('Search needs at least 2 characters.');
    return;
  }
  if (!lastH3) {
    setStatus('Set a location first (search is nearby by default).');
    return;
  }
  setStatus('Searching…');
  const limit = Number(limitEl.value);
  
  // Use new multi-resolution API
  const params = {
    q,
    h3: lastH3.cells.join(','),
    resolution: lastH3.resolution,
    limit,
    maxScan: 500
  };
  
  try {
    const data = await apiGet('/api/search', params);
    renderPosts(data.posts);
    setStatus(`Search returned ${data.posts.length} posts.`);
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
}

// Use GPS/browser geolocation
btnLocate.addEventListener('click', async () => {
  setStatus('Requesting location…');
  
  try {
    lastGeo = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        (err) => reject(err),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
      );
    });

    const { latitude, longitude, accuracy } = lastGeo.coords;
    const k = Number(kEl.value);
    lastH3 = computeH3Tokens(latitude, longitude, k);
    
    console.log(`Location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (±${accuracy}m)`);
    console.log(`Your H3 r7 center: ${lastH3.centerCell}`);
    
    setLocInfo(latitude, longitude, lastH3.centerCell, `GPS ±${Math.round(accuracy)}m`);
    await loadFeed();
  } catch (e) {
    setStatus(`Location error: ${e.message}`);
  }
});

// Use address/city geocoding
btnGeocode.addEventListener('click', async () => {
  const address = (addressEl.value || '').trim();
  if (!address) {
    setStatus('Please enter an address or city');
    return;
  }
  
  setStatus('Geocoding address…');
  try {
    const geo = await geocodeAddress(address);
    const k = Number(kEl.value);
    lastH3 = computeH3Tokens(geo.latitude, geo.longitude, k);
    
    console.log(`Geocoded: ${geo.latitude.toFixed(5)}, ${geo.longitude.toFixed(5)}`);
    console.log(`H3 r7 center: ${lastH3.centerCell}`);
    
    const shortName = geo.displayName.split(',').slice(0, 2).join(',');
    setLocInfo(geo.latitude, geo.longitude, lastH3.centerCell, shortName);
    await loadFeed();
  } catch (e) {
    setStatus(`Geocoding error: ${e.message}`);
  }
});

// Allow Enter key to trigger geocoding
addressEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    btnGeocode.click();
  }
});

btnSearch.addEventListener('click', async () => {
  try {
    await runSearch();
  } catch (e) {
    setStatus(String(e));
  }
});

btnClear.addEventListener('click', async () => {
  searchEl.value = '';
  await loadFeed();
});

kEl.addEventListener('change', async () => {
  if (!lastGeo && !lastH3) return;
  
  const k = Number(kEl.value);
  
  // If we have GPS coords, recompute from those
  if (lastGeo) {
    const { latitude, longitude } = lastGeo.coords;
    lastH3 = computeH3Tokens(latitude, longitude, k);
  } else if (lastH3 && lastH3.centerCell) {
    // Otherwise we need to get lat/lng from somewhere
    // For now, just reload since we stored the center cell
    // Note: h3-js can convert cell back to lat/lng if needed
  }
  
  await loadFeed();
});

// Auto-load posts using IP-based geolocation on page load
initWithIPLocation();
