# QR Code Reply for Desktop Browsers

## Summary

Add QR code display for posts when viewed on desktop browsers, allowing users to scan with their phone to reply via the Loxation app. On mobile, deeplinks work directly; on desktop, users need to scan a QR code.

## Implementation Phases

### Phase 1: Username-Based QR Codes (Core Feature)

Works with current API - no backend changes needed.

#### 1.1 Add Desktop Detection

**File:** `web/public/app.js` (after line 63)

```javascript
// Desktop detection: not iOS, not Android
const isDesktop = !isIOS && !isAndroid;
```

#### 1.2 Add QR Code Library

**File:** `web/public/index.html` (before `</body>`)

```html
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
```

#### 1.3 Add QR Generation Utility

**File:** `web/public/app.js` (after line 104)

```javascript
// Generate QR code as data URL
async function generateQRCodeDataUrl(url) {
  return await QRCode.toDataURL(url, {
    width: 180,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#1a1a1a', light: '#fffdf7' }
  });
}
```

#### 1.4 Add Modal HTML

**File:** `web/public/index.html` (after lightbox div)

```html
<div id="qr-modal" class="qr-modal hidden">
  <div class="qr-modal-content">
    <button class="qr-modal-close">&times;</button>
    <h3>Scan to Reply</h3>
    <p class="qr-modal-target"></p>
    <img id="qr-modal-img" alt="QR code" />
    <p class="qr-modal-hint">Scan with phone camera to reply in Loxation</p>
  </div>
</div>
```

#### 1.5 Add Modal CSS

**File:** `web/public/style.css` (append)

```css
/* QR Code Modal */
.qr-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.qr-modal.hidden {
  display: none;
}

.qr-modal-content {
  background: var(--paper);
  padding: 24px;
  max-width: 320px;
  text-align: center;
  position: relative;
}

.qr-modal-close {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 24px;
  background: none;
  border: none;
  cursor: pointer;
}

.qr-modal h3 {
  margin: 0 0 8px;
}

.qr-modal-target {
  font-family: monospace;
  font-size: 12px;
  margin-bottom: 16px;
}

.qr-modal-hint {
  font-size: 12px;
  opacity: 0.7;
  margin-top: 16px;
}
```

#### 1.6 Modify renderPosts

**File:** `web/public/app.js` (line ~595)

Add "Show QR" button for desktop users after the Reply button:

```javascript
${isDesktop ? `<button class="btn btn-qr" data-username="${escapeText(username)}" data-messageid="${escapeText(messageId)}">Show QR</button>` : ''}
```

Add click handler (after map button handler, ~line 648):

```javascript
const qrBtn = el.querySelector('.btn-qr');
if (qrBtn) {
  qrBtn.addEventListener('click', async () => {
    await showQRModal(qrBtn.dataset.username, qrBtn.dataset.messageid);
  });
}
```

#### 1.7 Add Modal Controller

**File:** `web/public/app.js` (append)

```javascript
// QR Modal
const qrModal = document.getElementById('qr-modal');
const qrModalImg = document.getElementById('qr-modal-img');
const qrModalTarget = qrModal?.querySelector('.qr-modal-target');

async function showQRModal(username, messageId) {
  const url = `loxation://reply?username=${encodeURIComponent(username)}&messageId=${encodeURIComponent(messageId)}`;
  const dataUrl = await generateQRCodeDataUrl(url);
  if (!dataUrl) return;
  qrModalTarget.textContent = `@${username}`;
  qrModalImg.src = dataUrl;
  qrModal.classList.remove('hidden');
}

function hideQRModal() {
  qrModal?.classList.add('hidden');
}

qrModal?.querySelector('.qr-modal-close')?.addEventListener('click', hideQRModal);
qrModal?.addEventListener('click', e => { if (e.target === qrModal) hideQRModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideQRModal(); });
```

---

### Phase 2: Identity Link QR Codes (Future - Requires API Changes)

For anonymous posts using `replyLinkHandle` + `replyLinkEntropy`.

#### 2.1 Update API Types

**File:** `api/src/types.ts`

Add to `PublicPost`:

```typescript
replyLinkHandle?: string | null;
replyLinkEntropy?: string | null;
displayName?: string | null;
```

#### 2.2 Update toPublicPost

**Files:** `api/src/routes/feed.ts`, `api/src/routes/search.ts`

Allow posts with identity link (not just username):

```typescript
const hasReplyMethod = username || (doc.replyLinkHandle && doc.replyLinkEntropy);
if (!hasReplyMethod) return null;
```

#### 2.3 Add Identity Link QR Generation

**File:** `web/public/app.js`

```javascript
function getIdentityLinkQRUrl(entropy, handle) {
  // Decode entropy + UUID handle, concatenate, base64url encode
  return `loxation://m/#eu/${base64url(entropy + handle)}`;
}
```

---

## Files to Modify

| File | Changes |
| ---- | ------- |
| `web/public/app.js` | Desktop detection, QR generation, modal controller, renderPosts QR button |
| `web/public/index.html` | QR library CDN, modal HTML |
| `web/public/style.css` | Modal styles |
| `web/community/app.js` | Same changes as public/app.js |
| `web/community/index.html` | QR library CDN, modal HTML |
| `web/community/style.css` | Modal styles (if separate from public) |

## Verification

1. **Desktop browser:** Open feed, verify "Show QR" button appears next to "Reply (in app)"
2. **Click "Show QR":** Modal opens with QR code and `@username` text
3. **Scan QR with phone:** Should open Loxation app to reply flow
4. **Modal close:** Test X button, backdrop click, Escape key
5. **Mobile browser:** Verify "Show QR" button does NOT appear

## Notes

- QR codes use `loxation://` custom scheme (works when scanned with phone camera)
- Phase 1 only handles username-based posts (current API)
- Phase 2 requires API changes for anonymous/identity-link posts
