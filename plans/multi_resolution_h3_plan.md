# Multi-Resolution H3 Plan for Efficient Metro-Scale Search

## Problem

Current approach queries one H3 resolution per post, requiring many queries for large areas:
- k=10 (40km radius): 331 cells → 34 queries
- k=15 (60km radius): 721 cells → 73 queries

## Solution: Store Multiple H3 Resolutions Per Post

| Resolution | Edge Length | Area | Use Case |
|------------|-------------|------|----------|
| h3r5 | ~22 km | ~253 km² | Regional search |
| h3r6 | ~8 km | ~36 km² | Metro/city search |
| h3r7 | ~3 km | ~5 km² | District search |
| h3r8 | ~1.2 km | ~0.74 km² | Neighborhood search |

With this approach:
- Nearby (k≤2): Query h3r8 (7 cells, 1 query)
- Local (k≤3): Query h3r7 (37 cells, 4 queries)
- Metro (k≤10): Query h3r6 (7-19 cells, 1-2 queries)
- Region (k≤15): Query h3r5 (7 cells, 1 query)

## Changes to loxation-server

### File: `/Users/jon/Documents/GitHub/loxation-server/src/routes/post.ts`

#### 1. Update the geolocator object creation (around line 181)

Current:
```typescript
geolocator: h3 ? { h3, accuracyM } : null,
```

Proposed:
```typescript
geolocator: h3 ? buildMultiResolutionGeolocator(coords.latitude, coords.longitude, accuracyM) : null,
```

#### 2. Add new helper function

```typescript
import { latLngToCell } from 'h3-js';

function buildMultiResolutionGeolocator(
  latitude: number,
  longitude: number,
  accuracyM?: number
): { h3: string; h3r5: string; h3r6: string; h3r7: string; h3r8?: string; accuracyM?: number } {
  const h3r5 = latLngToCell(latitude, longitude, 5);  // ~253 km²
  const h3r6 = latLngToCell(latitude, longitude, 6);  // ~36 km²
  const h3r7 = latLngToCell(latitude, longitude, 7);  // ~5 km²
  
  // Only include h3r8 for high-accuracy locations
  const includeR8 = accuracyM === undefined || accuracyM <= 500;
  const h3r8 = includeR8 ? latLngToCell(latitude, longitude, 8) : undefined;
  
  // Main h3 field uses the privacy-preserving resolution based on accuracy
  const h3 = includeR8 ? h3r8 : h3r7;
  
  return {
    h3,      // Primary (backward compatible)
    h3r5,
    h3r6,
    h3r7,
    h3r8,
    accuracyM
  };
}
```

### Changes to 2chanc3s-api

#### File: `api/src/routes/feed.ts`

Update to query appropriate resolution based on client-provided hint:

```typescript
// Add new query param: resolution (5|6|7|8, default 7)
const resolution = clampInt(req.query.resolution, 7, 5, 8);
const h3Field = `geolocator.h3r${resolution}`;

// Query using the selected resolution field
const snap = await db
  .collection(POSTS_COLLECTION)
  .where(h3Field, "in", h3Chunk)
  .orderBy("time", "desc")
  .limit(overfetch)
  .get();
```

#### File: `web/public/app.js`

Update to compute and send appropriate resolution:

```javascript
function computeH3Tokens(lat, lng, k) {
  // Choose resolution based on k
  const resolution = k <= 2 ? 8 : k <= 5 ? 7 : k <= 10 ? 6 : 5;
  const cell = latLngToCell(lat, lng, resolution);
  const cells = Array.from(gridDisk(cell, Math.min(k, 3))); // Limit disk size
  
  return { cells, resolution, centerCell: cell };
}

// In loadFeed()
const params = {
  h3: lastH3.cells.join(','),
  resolution: lastH3.resolution,
  limit
};
```

### Firestore Indexes Required

Add composite indexes for each resolution:

```
Collection: posts
Fields: geolocator.h3r5 (Ascending), time (Descending)

Collection: posts  
Fields: geolocator.h3r6 (Ascending), time (Descending)

Collection: posts
Fields: geolocator.h3r7 (Ascending), time (Descending)

Collection: posts
Fields: geolocator.h3r8 (Ascending), time (Descending)
```

## Migration

Since no posts exist yet in production, no migration needed. The existing test post can be manually updated or recreated.

## Benefits

| Radius | Current Queries | Multi-Res Queries | Improvement |
|--------|----------------|-------------------|-------------|
| 5km (k=1) | 1-2 | 1 | Same |
| 12km (k=3) | 4 | 1-2 | 2-4x |
| 40km (k=10) | 34 | 1-2 | 17-34x |
| 60km (k=15) | 73 | 1-2 | 36-73x |
