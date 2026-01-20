/**
 * Favorites page JavaScript
 * Manages favorite users in localStorage and displays their posts
 */

// Constants
const API_BASE = '';
const FAVORITES_KEY = '2chanc3s_favorites';

// DOM Elements
const listEl = document.getElementById('list');
const favoritesListEl = document.getElementById('favoritesList');
const newFavoriteEl = document.getElementById('newFavorite');
const btnAddFavorite = document.getElementById('btnAddFavorite');

// Platform detection
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

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

// Reply URL for Android and desktop
function replyUrl(username, messageId) {
  const u = encodeURIComponent(username);
  const m = encodeURIComponent(messageId);
  return `https://www.2chanc3s.com/reply?username=${u}&messageId=${m}`;
}

// iOS reply URL - different domain to trigger Universal Links
function replyUrlIOS(username, messageId) {
  const u = encodeURIComponent(username);
  const m = encodeURIComponent(messageId);
  return `https://public.loxation.com/reply?username=${u}&messageId=${m}`;
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
  if (videoEl._hlsInitialized) return;
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
        <a class="btn" href="${isIOS ? replyUrlIOS(pUsername, messageId) : replyUrl(pUsername, messageId)}">Reply (in app)</a>
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
