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

function renderPosts(posts) {
  listEl.innerHTML = '';
  if (!posts || posts.length === 0) {
    listEl.innerHTML = '<div class="post">No posts found.</div>';
    return;
  }

  for (const p of posts) {
    const username = p.username;
    const messageId = p.messageId;
    const full = p.content || '';
    const snippet = full.length > 240 ? full.slice(0, 240) + '…' : full;
    const hasMore = full.length > snippet.length;

    const el = document.createElement('div');
    el.className = 'post';
    el.innerHTML = `
      <div class="meta">
        <div>@${escapeText(username)}</div>
        <div>${escapeText(fmtTime(p.time))}</div>
        <div class="mono">id: ${escapeText(messageId)}</div>
      </div>
      <div class="content" data-full="${escapeText(full)}" data-snippet="${escapeText(snippet)}">${escapeText(snippet)}</div>
      <div class="actions">
        <a class="btn" href="${replyUrl(username, messageId)}">Reply (in app)</a>
        ${hasMore ? '<button class="btn toggle">Show full</button>' : ''}
      </div>
    `;
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
 * Uses metro-wide radius (~60km via H3 res6 k=2) for coarse IP accuracy.
 */
async function initWithIPLocation() {
  setStatus('Detecting your location...');
  
  const geo = await getIPGeolocation();
  if (!geo) {
    setStatus('Could not detect location. Enter a city/address or use GPS.');
    return;
  }
  
  // Use H3 resolution 6 with k=2 for ~60km metro coverage (appropriate for IP accuracy)
  const resolution = 6;
  const k = 2;
  
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
