/**
 * Favorites page JavaScript
 * Manages favorite users in localStorage and displays their posts
 */
import QRCode from 'qrcode';

// Constants
const API_BASE = '';
const FAVORITES_KEY = 'community_favorites';

// DOM Elements
const listEl = document.getElementById('list');
const favoritesListEl = document.getElementById('favoritesList');
const newFavoriteEl = document.getElementById('newFavorite');
const btnAddFavorite = document.getElementById('btnAddFavorite');

// ====== PLATFORM DETECTION ======
// On iOS, ONLY Safari supports Universal Links. ALL other iOS browsers need custom URL scheme.
const ua = navigator.userAgent || '';
const isIOS = /iPhone|iPad|iPod/i.test(ua);
const isAndroid = /Android/i.test(ua);

// Safari on iOS: contains "Safari" but NOT any third-party browser identifiers.
const isIOSSafari = isIOS && /Safari/i.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS|Brave|DuckDuckGo|Focus/i.test(ua);

// Any iOS browser that's NOT Safari needs custom scheme fallback
const isIOSNotSafari = isIOS && !isIOSSafari;

// Desktop: anything that's not iOS or Android
const isDesktop = !isIOS && !isAndroid;

console.log('[Platform]', { isIOS, isAndroid, isIOSSafari, isIOSNotSafari, isDesktop });

// ============================================================
// localStorage Functions
// ============================================================

/**
 * Load favorites from localStorage
 * @returns {string[]} Array of usernames
 */
function getFavorites() {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Save favorites to localStorage
 * @param {string[]} favorites - Array of usernames
 */
function saveFavorites(favorites) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
}

/**
 * Add a username to favorites
 * @param {string} username - Username to add
 * @returns {boolean} True if added, false if already exists
 */
function addFavorite(username) {
  const normalized = username.replace(/^@/, '').trim().toLowerCase();
  if (!normalized) return false;
  
  const favorites = getFavorites();
  if (favorites.includes(normalized)) return false;
  
  favorites.push(normalized);
  saveFavorites(favorites);
  return true;
}

/**
 * Remove a username from favorites
 * @param {string} username - Username to remove
 */
function removeFavorite(username) {
  const favorites = getFavorites();
  const filtered = favorites.filter(u => u !== username);
  saveFavorites(filtered);
}

// ============================================================
// Utility Functions
// ============================================================

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

// ====== REPLY URL GENERATORS ======

// Custom URL scheme for app - works on iOS non-Safari, and as fallback
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
 */
function getReplyUrl(username, messageId) {
  if (isAndroid) {
    return replyUrlAndroid(username, messageId);
  }
  return replyUrlHTTPS(username, messageId);
}

/**
 * Handle Reply button click - special handling for iOS non-Safari browsers
 */
function handleReplyClick(event, username, messageId) {
  if (!isIOSNotSafari) {
    return true; // Let default href work
  }
  
  event.preventDefault();
  const customUrl = replyUrlCustomScheme(username, messageId);
  const fallbackUrl = replyUrlHTTPS(username, messageId);
  openAppWithFallback(customUrl, fallbackUrl);
  return false;
}

/**
 * Attempt to open app via custom scheme with web fallback
 */
function openAppWithFallback(customSchemeUrl, fallbackWebUrl) {
  const startTime = Date.now();
  let userLeftPage = false;
  
  const handleVisibilityChange = () => {
    if (document.hidden) userLeftPage = true;
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  window.location.href = customSchemeUrl;
  
  setTimeout(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    const elapsed = Date.now() - startTime;
    if (!userLeftPage && !document.hidden && elapsed >= 1400) {
      console.log('[openAppWithFallback] App did not open, redirecting to fallback');
      window.location.href = fallbackWebUrl;
    }
  }, 1500);
}

// Make handleReplyClick available globally
window.handleReplyClick = handleReplyClick;

// ====== QR CODE MODAL (Desktop only) ======
const qrModal = document.getElementById('qr-modal');
const qrModalImg = document.getElementById('qr-modal-img');
const qrModalTarget = qrModal?.querySelector('.qr-modal-target');

/**
 * Generate QR code data URL
 */
async function generateQRCodeDataUrl(url) {
  try {
    return await QRCode.toDataURL(url, {
      width: 180,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#1a1a1a', light: '#fffdf7' }
    });
  } catch (err) {
    console.error('[QR] Error generating QR code:', err);
    return null;
  }
}

/**
 * Show QR modal with reply link
 */
async function showQRModal(url, targetDisplay) {
  if (!qrModal || !qrModalImg) return;
  const dataUrl = await generateQRCodeDataUrl(url);
  if (!dataUrl) return;
  qrModalImg.src = dataUrl;
  if (qrModalTarget) {
    qrModalTarget.textContent = targetDisplay || '';
  }
  qrModal.classList.remove('hidden');
}

// Close QR modal on click outside or close button
if (qrModal) {
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) {
      qrModal.classList.add('hidden');
    }
  });
  const closeBtn = qrModal.querySelector('.qr-modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => qrModal.classList.add('hidden'));
  }
}

// ============================================================
// Media Rendering
// ============================================================

/**
 * Render media element for a post
 * @param {Object} media - Media info from API
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
    
    const videoId = 'video-' + Math.random().toString(36).slice(2, 9);
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    const hasNativeHLS = isIOS || isSafari;
    
    if (hasNativeHLS) {
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
    const streamUrl = media.stream;
    const title = media.title || 'Live Stream';
    const status = media.status || 'created';
    
    // If no stream URL yet, show a placeholder
    if (!streamUrl) {
      return `
        <div class="post-media video-container live-container">
          <span class="live-badge waiting">Starting soon...</span>
          <div class="live-placeholder">
            <p>${escapeText(title)}</p>
          </div>
        </div>
      `;
    }
    
    // Generate unique ID for this video element
    const videoId = 'live-' + Math.random().toString(36).slice(2, 9);
    
    // Status badge based on live status
    let badgeClass = 'live-badge';
    let badgeText = '🔴 LIVE';
    if (status === 'ended') {
      badgeClass = 'live-badge ended';
      badgeText = '📹 Recorded';
    } else if (status === 'created') {
      badgeClass = 'live-badge waiting';
      badgeText = 'Starting...';
    }
    
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    const hasNativeHLS = isIOS || isSafari;
    
    // Render same as video but with live badge
    if (hasNativeHLS) {
      return `
        <div class="post-media video-container live-container">
          <span class="${badgeClass}">${badgeText}</span>
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
          <span class="${badgeClass}">${badgeText}</span>
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
  if (videoEl._hlsInitialized) return;
  videoEl._hlsInitialized = true;
  
  const isLive = videoEl.dataset.live === 'true';
  const streamUrl = videoEl.dataset.stream;
  
  if (!streamUrl) return;
  
  if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = streamUrl;
    videoEl.play().catch(() => {});
  } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    const hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: isLive
    });
    
    videoEl._hls = hls;
    hls.loadSource(streamUrl);
    hls.attachMedia(videoEl);
    
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      videoEl.play().catch(() => {});
    });
    
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            hls.destroy();
            break;
        }
      }
    });
  } else {
    videoEl.src = streamUrl;
    videoEl.play().catch(() => {});
  }
}

// ============================================================
// Lightbox Functions
// ============================================================

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
  
  document.body.style.overflow = '';
}

// Make openLightbox available globally
window.openLightbox = openLightbox;

// ============================================================
// API Functions
// ============================================================

/**
 * Fetch posts for a user via the search API
 * @param {string} username - Username to search for
 * @returns {Promise<Array>} Array of posts
 */
async function fetchUserPosts(username) {
  try {
    const response = await fetch(`${API_BASE}/api/search?q=@${encodeURIComponent(username)}&limit=100`);
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    const data = await response.json();
    return data.posts || [];
  } catch (err) {
    console.error('[fetchUserPosts] Error:', err);
    return [];
  }
}

// ============================================================
// Rendering Functions
// ============================================================

/**
 * Render the favorites list
 */
function renderFavorites() {
  const favorites = getFavorites();
  
  if (favorites.length === 0) {
    favoritesListEl.innerHTML = '<div class="empty-state">No favorites yet. Add a username above.</div>';
    return;
  }
  
  favoritesListEl.innerHTML = favorites.map(username => `
    <div class="favorite-item" data-username="${escapeText(username)}">
      <button class="favorite-name" data-action="select" data-username="${escapeText(username)}">
        @${escapeText(username)}
      </button>
      <button class="favorite-remove" data-action="remove" data-username="${escapeText(username)}" title="Remove">×</button>
    </div>
  `).join('');
}

/**
 * Render posts for a selected user
 * @param {Array} posts - Array of post objects
 * @param {string} username - Username being displayed
 */
function renderPosts(posts, username) {
  if (!posts || posts.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No posts found for @${escapeText(username)}</div>`;
    return;
  }

  listEl.innerHTML = '';
  
  for (const p of posts) {
    const pUsername = p.username;
    const messageId = p.messageId;
    const full = p.content || '';
    const snippet = full.length > 240 ? full.slice(0, 240) + '…' : full;
    const hasMore = full.length > snippet.length;
    const hasMedia = p.media && (p.media.type === 'image' || p.media.type === 'video' || p.media.type === 'live');

    const el = document.createElement('div');
    el.className = 'post';
    el.innerHTML = `
      <div class="meta">
        <div>@${escapeText(pUsername)}</div>
        <div>${escapeText(fmtTime(p.time))}</div>
        <div class="mono">id: ${escapeText(messageId)}</div>
      </div>
      ${renderMedia(p.media)}
      <div class="content" data-full="${escapeText(full)}" data-snippet="${escapeText(snippet)}">${escapeText(snippet)}</div>
      <div class="actions">
        ${isDesktop
          ? `<button class="btn btn-qr" data-url="${replyUrlCustomScheme(pUsername, messageId)}" data-target="@${escapeText(pUsername)}">Scan QR to reply in-app</button>`
          : `<a class="btn reply-btn" href="${getReplyUrl(pUsername, messageId)}"
               data-username="${escapeText(pUsername)}"
               data-messageid="${escapeText(messageId)}"
               onclick="return window.handleReplyClick(event, this.dataset.username, this.dataset.messageid)">Reply (in app)</a>`}
        ${hasMore && !hasMedia ? '<button class="btn toggle">Show full</button>' : ''}
      </div>
    `;

    // QR button for desktop
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
  
  // Setup unmute buttons for videos
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
  
  // Setup video autoplay
  setupVideoAutoplay();
}

/**
 * Setup IntersectionObserver for video autoplay on scroll
 */
function setupVideoAutoplay() {
  const videos = document.querySelectorAll('.post-media video');
  if (videos.length === 0) return;
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const video = entry.target;
      
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        // Check for regular video (data-stream) or live video (data-media-id)
        const needsInit = (video.dataset.stream || video.dataset.mediaId) && !video._hlsInitialized;
        if (needsInit) {
          initVideoPlayer(video);
        } else if (video.paused && video.src) {
          video.play().catch(() => {});
        }
      } else {
        if (!video.paused) {
          video.pause();
        }
      }
    });
  }, { threshold: [0, 0.5, 1] });
  
  videos.forEach(video => observer.observe(video));
}

// ============================================================
// Event Handlers
// ============================================================

/**
 * Select a favorite user and load their posts
 * @param {string} username - Username to select
 */
async function selectFavorite(username) {
  // Update UI to show selected state
  document.querySelectorAll('.favorite-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.username === username);
  });
  
  // Show loading state
  listEl.innerHTML = '<div class="status">Loading posts for @' + escapeText(username) + '...</div>';
  
  // Fetch and render posts
  const posts = await fetchUserPosts(username);
  renderPosts(posts, username);
}

/**
 * Handle adding a new favorite
 */
function handleAddFavorite() {
  const username = newFavoriteEl.value.trim();
  if (!username) {
    return;
  }
  
  if (addFavorite(username)) {
    newFavoriteEl.value = '';
    renderFavorites();
    // Auto-select the newly added favorite
    selectFavorite(username.replace(/^@/, '').toLowerCase());
  } else {
    // Already exists - just select it
    selectFavorite(username.replace(/^@/, '').toLowerCase());
  }
}

/**
 * Handle removing a favorite
 * @param {string} username - Username to remove
 */
function handleRemoveFavorite(username) {
  removeFavorite(username);
  renderFavorites();
  
  // Clear posts if the removed user was selected
  const selectedItem = document.querySelector('.favorite-item.selected');
  if (!selectedItem || selectedItem.dataset.username === username) {
    listEl.innerHTML = '<div class="empty-state">Select a favorite user to view their posts</div>';
  }
}

// ============================================================
// Initialization
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Render initial favorites list
  renderFavorites();
  
  // Add favorite button click
  btnAddFavorite.addEventListener('click', handleAddFavorite);
  
  // Enter key in input
  newFavoriteEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleAddFavorite();
    }
  });
  
  // Favorites list click delegation
  favoritesListEl.addEventListener('click', (e) => {
    const target = e.target;
    const action = target.dataset.action;
    const username = target.dataset.username;
    
    if (action === 'select' && username) {
      selectFavorite(username);
    } else if (action === 'remove' && username) {
      handleRemoveFavorite(username);
    }
  });
  
  // Lightbox close button
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
