import { latLngToCell, gridDisk } from 'h3-js';

// Configure this to your Cloud Run URL, e.g. https://api-xxxxx-uc.a.run.app
// If your Cloudflare Pages site proxies to the API, this can remain "".
const API_BASE = '';

const statusEl = document.getElementById('status');
const listEl = document.getElementById('list');
const btnLocate = document.getElementById('btnLocate');
const btnSearch = document.getElementById('btnSearch');
const btnClear = document.getElementById('btnClear');
const searchEl = document.getElementById('search');
const kEl = document.getElementById('k');
const limitEl = document.getElementById('limit');

let lastGeo = null;
let lastH3 = null;

function setStatus(msg) {
  statusEl.textContent = msg;
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

function computeH3Tokens(lat, lng, k) {
  const cell7 = latLngToCell(lat, lng, 7);
  const cell8 = latLngToCell(lat, lng, 8);
  const r7 = Array.from(gridDisk(cell7, k));
  const r8 = Array.from(gridDisk(cell8, k));
  return { r7, r8 };
}

async function loadFeed() {
  if (!lastH3) {
    setStatus('Click “Use my location” to load nearby posts.');
    return;
  }
  setStatus('Loading…');
  const limit = Number(limitEl.value);
  const data = await apiGet('/api/feed', {
    h3r7: lastH3.r7.join(','),
    h3r8: lastH3.r8.join(','),
    limit
  });
  renderPosts(data.posts);
  setStatus(`Loaded ${data.posts.length} posts.`);
}

async function runSearch() {
  const q = (searchEl.value || '').trim();
  if (q.length < 2) {
    setStatus('Search needs at least 2 characters.');
    return;
  }
  if (!lastH3) {
    setStatus('Use my location first (search is nearby by default).');
    return;
  }
  setStatus('Searching…');
  const limit = Number(limitEl.value);
  const data = await apiGet('/api/search', {
    q,
    h3r7: lastH3.r7.join(','),
    h3r8: lastH3.r8.join(','),
    limit,
    maxScan: 500
  });
  renderPosts(data.posts);
  setStatus(`Search returned ${data.posts.length} posts.`);
}

btnLocate.addEventListener('click', async () => {
  setStatus('Requesting location…');
  const k = Number(kEl.value);

  lastGeo = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  });

  const { latitude, longitude } = lastGeo.coords;
  lastH3 = computeH3Tokens(latitude, longitude, k);
  await loadFeed();
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
  if (!lastGeo) return;
  const k = Number(kEl.value);
  const { latitude, longitude } = lastGeo.coords;
  lastH3 = computeH3Tokens(latitude, longitude, k);
  await loadFeed();
});

setStatus('Click “Use my location” to load nearby posts.');

