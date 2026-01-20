import { latLngToCell, gridDisk, cellToBoundary, cellToLatLng } from 'h3-js';

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

// Reply URL for Android and desktop (same-domain, Android App Links work fine)
function replyUrl(username, messageId) {
  const u = encodeURIComponent(username);
  const m = encodeURIComponent(messageId);
  return `https://www.2chanc3s.com/reply?username=${u}&messageId=${m}`;
}

// iOS reply URL - uses different domain to trigger Universal Links
// (iOS blocks Universal Links for same-domain navigation)
function replyUrlIOS(username, messageId) {
  const u = encodeURIComponent(username);
  const m = encodeURIComponent(messageId);
  return `https://public.loxation.com/reply?username=${u}&messageId=${m}`;
}

// Platform detection
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

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
    const mediaId = media.mediaId;
    const title = media.title || 'Live Stream';
    
    if (!mediaId) return '';
    
    // Generate unique ID for this video element
    const videoId = 'live-' + Math.random().toString(36).slice(2, 9);
    
    // Status badge - will be updated after fetching streaming URL
    const statusBadge = '<span class="live-badge loading">Loading...</span>';
    
    // For live streams, we must call /v1/posts/media/:mediaId/streaming-url to get the correct URL
    // Store mediaId as data attribute for initVideoPlayer to use
    return `
      <div class="post-media video-container live-container">
        ${statusBadge}
        <video
          id="${videoId}"
          controls
          playsinline
          muted
          preload="none"
          data-media-id="${escapeText(mediaId)}"
          data-live="true"
        >
          Your browser does not support live playback.
        </video>
        <button class="unmute-btn" aria-label="Unmute">🔇</button>
      </div>
    `;
  }
  
  return '';
}

/**
 * Initialize HLS for a video element
 * For live streams, fetches the streaming URL from /v1/posts/media/:mediaId/streaming-url first
 * @param {HTMLVideoElement} videoEl - The video element to initialize
 */
async function initVideoPlayer(videoEl) {
  // Only initialize once
  if (videoEl._hlsInitialized) {
    console.log('[initVideoPlayer] Already initialized, skipping');
    return;
  }
  videoEl._hlsInitialized = true;
  
  const isLive = videoEl.dataset.live === 'true';
  const mediaId = videoEl.dataset.mediaId;
  let streamUrl = videoEl.dataset.stream;
  
  // For live streams, we need to fetch the actual streaming URL
  if (isLive && mediaId) {
    console.log('[initVideoPlayer] Live stream detected, fetching streaming URL for mediaId:', mediaId);
    const container = videoEl.closest('.live-container');
    const badge = container?.querySelector('.live-badge');
    
    try {
      const response = await fetch(`/v1/posts/media/${mediaId}/streaming-url`);
      const data = await response.json();
      
      console.log('[initVideoPlayer] Streaming URL response:', data);
      
      if (data.streamingUrl) {
        streamUrl = data.streamingUrl;
        
        // Update badge based on status
        if (badge) {
          if (data.status === 'live-inprogress') {
            badge.className = 'live-badge';
            badge.textContent = '🔴 LIVE';
          } else if (data.status === 'ready') {
            badge.className = 'live-badge ended';
            badge.textContent = '📹 Recorded';
          } else if (data.status === 'pendingupload') {
            badge.className = 'live-badge waiting';
            badge.textContent = 'Processing...';
          } else {
            badge.className = 'live-badge ended';
            badge.textContent = data.status || 'Video';
          }
        }
      } else {
        // No streaming URL available
        console.warn('[initVideoPlayer] No streaming URL available:', data.message);
        if (badge) {
          badge.className = 'live-badge waiting';
          badge.textContent = data.message || 'Not available';
        }
        return;
      }
    } catch (err) {
      console.error('[initVideoPlayer] Failed to fetch streaming URL:', err);
      if (badge) {
        badge.className = 'live-badge waiting';
        badge.textContent = 'Error loading';
      }
      return;
    }
  }
  
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
  if (postsWithMedia.length > 0) {
    console.log('[renderPosts] Posts with media:', postsWithMedia.map(p => ({
      username: p.username,
      messageId: p.messageId,
      contentType: p.contentType,
      media: p.media
    })));
  } else {
    console.log('[renderPosts] No posts have media data');
  }

  for (const p of posts) {
    const username = p.username;
    const messageId = p.messageId;
    const full = p.content || '';
    const snippet = full.length > 240 ? full.slice(0, 240) + '…' : full;
    const hasMore = full.length > snippet.length;
    const hasMedia = p.media && (p.media.type === 'image' || p.media.type === 'video' || p.media.type === 'live');
    const hasLocation = p.geolocatorH3;

    const el = document.createElement('div');
    el.className = 'post';
    el.innerHTML = `
      <div class="meta">
        <div>@${escapeText(username)}</div>
        <div>${escapeText(fmtTime(p.time))}</div>
        <div class="mono">id: ${escapeText(messageId)}</div>
      </div>
      ${renderMedia(p.media)}
      <div class="content" data-full="${escapeText(full)}" data-snippet="${escapeText(snippet)}">${escapeText(snippet)}</div>
      <div class="actions">
        <a class="btn" href="${isIOS ? replyUrlIOS(username, messageId) : replyUrl(username, messageId)}">Reply (in app)</a>
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
 * Server now stores h3_res6 (~36 km², metro) and h3_res7 (~5 km², district).
 *
 * Strategy:
 * - k <= 3: use resolution 7 for district-level precision
 * - k >= 5: use resolution 6 for metro-level efficiency (fewer cells)
 *
 * With multi-resolution, we only need small k-rings (0-2) at the appropriate resolution.
 */
function computeH3Tokens(lat, lng, k) {
  // Choose resolution and effective k based on search radius
  // For larger areas, use coarser resolution with smaller k-ring
  let resolution, effectiveK;
  
  if (k >= 5) {
    // Metro scale: use res 6 (~36 km² per cell)
    // k=5 at res7 ≈ k=1 at res6, k=10 at res7 ≈ k=2 at res6
    resolution = 6;
    effectiveK = Math.min(Math.ceil(k / 5), 3); // Cap at k=3 for res6
  } else {
    // District scale: use res 7 (~5 km² per cell)
    resolution = 7;
    effectiveK = k;
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
    const resLabel = lastH3.resolution === 6 ? 'metro (res6)' : 'district (res7)';
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
