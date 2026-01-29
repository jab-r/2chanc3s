# Plan: H3-Based and Keyword Search Ads

## Overview

Add a **hybrid advertising system**:

1. **Google AdSense** - Default fallback ads (immediate revenue)
2. **H3-Based Ads** - Self-serve location-targeted ads that override Google when available
3. **Keyword Search Ads** - Self-serve ads triggered by search terms

**Logic:** Check for self-serve ads first → if none, show Google ads

**Configuration:**

- Ad positions: After posts 3 and 8 (max 2 ads per feed)
- Sites: Both www.2chanc3s.com and community.loxation.com
- Admin: Use Firestore console to create/manage self-serve ads

## Data Model

### New Firestore Collection: `ads`

```typescript
// Add to /api/src/types.ts
export type AdDoc = {
  adId: string;
  advertiserId: string;
  title: string;
  content: string;
  contentType?: string;
  mediaId?: string | null;
  ctaText?: string;
  ctaUrl: string;
  targeting: {
    type: 'h3' | 'keyword' | 'both';
    h3Cells?: string[];      // H3 cell IDs to target
    h3Resolution?: 6 | 7;    // 6=metro, 7=district
    keywords?: string[];     // Lowercase keywords
  };
  status: 'active' | 'paused' | 'expired';
  startDate: string;
  endDate?: string;
  impressions: number;
  clicks: number;
  createdAt: string;
  updatedAt: string;
};

export type PublicAd = {
  adId: string;
  title: string;
  content: string;
  contentType?: string;
  media?: MediaInfo;
  ctaText?: string;
  ctaUrl: string;
  isAd: true;
};
```

### H3 Index Collection: `adH3Index`

For efficient H3 lookups (Firestore `array-contains` only matches one element):

```text
adH3Index/{resolution}_{h3Cell}
  - adIds: string[]  // Array of ad IDs targeting this cell
```

## Files to Modify/Create

| File                         | Action                                         |
| ---------------------------- | ---------------------------------------------- |
| `api/src/types.ts`           | Add `AdDoc` and `PublicAd` types               |
| `api/src/routes/ads.ts`      | **Create** - New router for ad endpoints       |
| `api/src/index.ts`           | Register ads router                            |
| `api/firestore.indexes.json` | Add indexes for keyword queries                |
| `web/public/app.js`          | Add `renderAd()`, modify `renderPosts()`       |
| `web/public/style.css`       | Add `.ad-unit` styling                         |
| `web/community/app.js`       | Same changes as public                         |
| `web/community/style.css`    | Same changes as public                         |

## API Endpoints

### `GET /api/ads/feed`

Fetch H3-targeted ads for feed view.

Query params:

- `h3`: comma-separated H3 cells
- `resolution`: 6 or 7 (default 7)
- `limit`: 1-3 (default 2)

### `GET /api/ads/search`

Fetch keyword-matched ads for search results.

Query params:

- `q`: search query (tokenized into keywords)
- `limit`: 1-3 (default 1)

### `POST /api/ads/impression`

Track ad impression (fire-and-forget).

### `POST /api/ads/click`

Track ad click.

### Admin Endpoints (for creating ads)

- `POST /api/ads` - Create ad
- `GET /api/ads` - List ads
- `PATCH /api/ads/:adId` - Update status

## Frontend Changes

### Ad Rendering (app.js)

Add `renderAd(ad)` function that creates an ad element with:

- "Sponsored" label
- Title
- Content/media
- CTA button linking to `ctaUrl`
- IntersectionObserver for impression tracking

### Ad Injection

Modify `renderPosts(posts, ads)` to inject ads at positions 3 and 8 in the feed:

```javascript
const adPositions = [3, 8];
// After rendering post at position 3, inject first ad
// After rendering post at position 8, inject second ad
```

### Parallel Fetching

Fetch ads alongside posts:

```javascript
const [postsData, adsData] = await Promise.all([
  apiGet('/api/feed', params),
  apiGet('/api/ads/feed', { h3, resolution, limit: 2 })
]);
renderPosts(postsData.posts, adsData.ads);
```

### CSS Styling

```css
.ad-unit {
  border: 1px solid #e0d8c8;
  background: linear-gradient(135deg, #fffef9 0%, #faf8f0 100%);
}
.ad-label {
  font-size: 10px;
  text-transform: uppercase;
  color: #888;
}
.ad-title {
  font-size: 16px;
  font-weight: 600;
}
.ad-cta {
  background: var(--accent);
  color: white;
}
```

## Google AdSense Integration

### Setup

1. Sign up for Google AdSense at https://adsense.google.com
2. Get your AdSense publisher ID (ca-pub-XXXXXXX)
3. Add the AdSense script to both sites

### HTML Changes

Add to `<head>` in index.html (both sites):

```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXX"
     crossorigin="anonymous"></script>
```

### Ad Slot Logic

```javascript
async function renderAdSlot(slotEl, h3Cells, resolution) {
  // Try self-serve first
  const selfServeAds = await fetchSelfServeAds(h3Cells, resolution);

  if (selfServeAds.length > 0) {
    // We have a local ad - render it
    renderSelfServeAd(slotEl, selfServeAds[0]);
  } else {
    // No local ad - show Google
    renderGoogleAd(slotEl);
  }
}

function renderGoogleAd(slotEl) {
  slotEl.innerHTML = `
    <ins class="adsbygoogle"
         style="display:block"
         data-ad-client="ca-pub-XXXXXXX"
         data-ad-slot="YYYYYYYY"
         data-ad-format="auto"
         data-full-width-responsive="true"></ins>
  `;
  (adsbygoogle = window.adsbygoogle || []).push({});
}
```

## Implementation Steps

### Phase 1: Google AdSense (Immediate Revenue)

1. Sign up for AdSense, get approved
2. Add AdSense script to both sites' `<head>`
3. Create ad slot divs at positions 3 and 8
4. Initialize Google ads in slots
5. Deploy and verify ads appear

### Phase 2: Backend Data Layer

1. Add types to `api/src/types.ts`
2. Create `api/src/routes/ads.ts` with endpoint stubs
3. Register router in `api/src/index.ts`
4. Add Firestore indexes
5. Deploy indexes: `firebase deploy --only firestore:indexes`

### Phase 2: H3 Ad Queries

1. Implement `GET /api/ads/feed` with H3 index lookup
2. Create sample ad documents manually in Firestore
3. Test endpoint returns correct ads for H3 cells

### Phase 3: Keyword Ad Queries

1. Implement `GET /api/ads/search` with keyword matching
2. Test with sample keyword-targeted ads

### Phase 4: Frontend Integration

1. Add `renderAd()` function to `app.js`
2. Modify `renderPosts()` to accept ads parameter
3. Add CSS styles for `.ad-unit`
4. Update `loadFeed()` to fetch ads in parallel
5. Update `runSearch()` to fetch ads in parallel

### Phase 5: Tracking

1. Implement impression/click endpoints
2. Add `trackImpression()` with IntersectionObserver
3. Add `trackClick()` on CTA button

### Phase 6: Admin (MVP)

1. Create simple admin page or use Firestore console
2. Implement `POST /api/ads` for ad creation

## Verification

1. **H3 Ads**:
   - Create an ad targeting H3 cells for a known location
   - Browse feed at that location
   - Verify ad appears after 3rd post

2. **Keyword Ads**:
   - Create an ad with keywords like "coffee", "cafe"
   - Search for "coffee shop"
   - Verify ad appears in results

3. **Tracking**:
   - Check Firestore `ads` collection
   - Verify `impressions` increments when ad scrolls into view
   - Verify `clicks` increments when CTA clicked

4. **No Ads Case**:
   - Browse location with no targeted ads
   - Verify feed loads normally without errors
