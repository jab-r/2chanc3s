import { latLngToCell, gridDisk } from 'h3-js';

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

function replyUrl(username, messageId) {
  const u = encodeURIComponent(username);
  const m = encodeURIComponent(messageId);
  return `https://www.2chanc3s.com/reply?username=${u}&messageId=${m}`;
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
    
    return `
      <div class="post-media">
        <video 
          id="${videoId}"
          poster="${escapeText(posterUrl)}"
          controls
          playsinline
          preload="none"
          data-stream="${escapeText(streamUrl)}"
        >
          Your browser does not support video playback.
        </video>
      </div>
    `;
  }
  
  return '';
}

/**
 * Initialize HLS for a video element
 * @param {HTMLVideoElement} videoEl - The video element to initialize
 */
function initVideoPlayer(videoEl) {
  const streamUrl = videoEl.dataset.stream;
  if (!streamUrl) return;
  
  // Only initialize when video starts playing
  if (videoEl._hlsInitialized) return;
  
  if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS support (Safari, iOS)
    videoEl.src = streamUrl;
  } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    // Use HLS.js for other browsers
    const hls = new Hls();
    hls.loadSource(streamUrl);
    hls.attachMedia(videoEl);
  } else {
    // Fallback - try direct source (may not work for HLS)
    videoEl.src = streamUrl;
  }
  
  videoEl._hlsInitialized = true;
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
    const hasMedia = p.media && (p.media.type === 'image' || p.media.type === 'video');

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
        <a class="btn" href="${replyUrl(username, messageId)}">Reply (in app)</a>
        ${hasMore && !hasMedia ? '<button class="btn toggle">Show full</button>' : ''}
      </div>
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
    
    listEl.appendChild(el);
  }
  
  // Initialize video players after DOM is updated
  // Use play event to lazy-load HLS streams
  document.querySelectorAll('.post-media video[data-stream]').forEach(videoEl => {
    videoEl.addEventListener('play', () => initVideoPlayer(videoEl), { once: true });
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
