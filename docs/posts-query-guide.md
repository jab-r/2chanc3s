# Posts Collection Query Guide

This guide describes the Firestore `posts` collection schema and how to query posts by hashtags, mentions, location, and other fields.

---

## Post Document Schema

```typescript
interface PostDocument {
  // Identity
  deviceId: string;              // Device that created the post
  messageId: string;             // Unique per device
  username: string | null;       // Public username (if provided)

  // Content
  content: string;               // Post text
  contentType: string;           // MIME type (default: 'text/plain')
  time: string;                  // ISO timestamp

  // Location (device location when posted)
  geolocator: {
    h3_res6: string;             // ~36 km² (metro/city)
    h3_res7: string;             // ~5 km² (district)
    h3_res8: string;             // ~0.74 km² (neighborhood)
    h3_res9: string;             // ~0.11 km² (block)
    accuracyM?: number;
  } | null;
  locationSource: 'device' | 'userProvided';
  geolocatorStatus: 'resolved' | 'missing_device_location';

  // Parsed entities (for querying)
  entities: {
    mentions: string[];          // ["jon", "alice"] - lowercase
    hashtags: string[];          // ["food", "outdoors"] - lowercase
    urls: string[];              // URLs found in content
  };

  // Media (optional)
  mediaId: string | null;        // Reference to postMedia collection

  // Category (optional)
  category: string | null;

  // Anonymous identity (alternative to username)
  replyLinkHandle: string | null;
  replyLinkEntropy: string | null;
  displayName: string | null;
}
```

---

## Available Indexes

### Location-based queries
```
geolocator.h3_res6 + time DESC
geolocator.h3_res7 + time DESC
geolocator.h3_res8 + time DESC
geolocator.h3_res9 + time DESC
```

### Hashtag queries
```
entities.hashtags CONTAINS + time DESC
entities.hashtags CONTAINS + geolocator.h3_res7 + time DESC
```

### Mention queries
```
entities.mentions CONTAINS + time DESC
```

### Username queries
```
username + time DESC
username + geolocator.h3_res6 + time DESC
username + geolocator.h3_res7 + time DESC
```

### Category queries
```
category + time DESC
category + geolocator.h3_res6 + time DESC
category + geolocator.h3_res7 + time DESC
```

---

## Query Examples

### 1. Feed by Location (existing)

Get posts near a location using H3 cells:

```typescript
// Client computes H3 cells from lat/lon
const h3Cells = gridDisk(latLngToCell(lat, lon, 7), k);

// Query (chunk into groups of 10 for Firestore 'in' limit)
const posts = await db.collection('posts')
  .where('geolocator.h3_res7', 'in', h3Cells.slice(0, 10))
  .orderBy('time', 'desc')
  .limit(50)
  .get();
```

### 2. Posts with Hashtag

Get all posts with a specific hashtag:

```typescript
const posts = await db.collection('posts')
  .where('entities.hashtags', 'array-contains', 'food')
  .orderBy('time', 'desc')
  .limit(50)
  .get();
```

### 3. Posts with Hashtag in Area

Get posts with a hashtag within a specific location:

```typescript
const centerH3 = latLngToCell(lat, lon, 7);

const posts = await db.collection('posts')
  .where('entities.hashtags', 'array-contains', 'food')
  .where('geolocator.h3_res7', '==', centerH3)
  .orderBy('time', 'desc')
  .limit(50)
  .get();
```

### 4. Posts Mentioning User

Get posts that mention a specific user:

```typescript
const posts = await db.collection('posts')
  .where('entities.mentions', 'array-contains', 'jon')
  .orderBy('time', 'desc')
  .limit(50)
  .get();
```

### 5. Posts by Username (existing)

```typescript
const posts = await db.collection('posts')
  .where('username', '==', 'jon')
  .orderBy('time', 'desc')
  .limit(50)
  .get();
```

---

## Firestore Limitations

### One `array-contains` per query

Firestore only allows **one** `array-contains` clause per query. You cannot do:

```typescript
// THIS WILL NOT WORK
db.where('entities.hashtags', 'array-contains', 'food')
  .where('entities.mentions', 'array-contains', 'jon')
```

**Workaround**: Query by one entity, filter others in memory:

```typescript
// Query by hashtag
const results = await db.collection('posts')
  .where('entities.hashtags', 'array-contains', 'food')
  .orderBy('time', 'desc')
  .limit(100)
  .get();

// Filter by mention in memory
const filtered = results.docs.filter(doc =>
  doc.data().entities.mentions.includes('jon')
);
```

### Max 10 values in `in` clause

When querying by multiple H3 cells, chunk into groups of 10:

```typescript
const chunks = [];
for (let i = 0; i < h3Cells.length; i += 10) {
  chunks.push(h3Cells.slice(i, i + 10));
}

// Run parallel queries
const results = await Promise.all(
  chunks.map(chunk =>
    db.collection('posts')
      .where('geolocator.h3_res7', 'in', chunk)
      .orderBy('time', 'desc')
      .limit(50)
      .get()
  )
);
```

---

## Entity Extraction Rules

The server extracts entities from post content as follows:

| Entity | Pattern | Storage |
|--------|---------|---------|
| Mentions | `@username` (1-30 alphanumeric/underscore chars) | **Case-sensitive**, deduplicated |
| Hashtags | `#tag` (1-50 alphanumeric/underscore chars) | Lowercase, deduplicated |
| URLs | `http://` or `https://` until whitespace | Trailing punctuation stripped |

### Examples

Content: `Hey @Jon check #Food #FOOD at https://menu.com.`

Stored entities:
```json
{
  "mentions": ["Jon"],
  "hashtags": ["food"],
  "urls": ["https://menu.com"]
}
```

---

## Query Strategy by Use Case

| Use Case | Primary Query | Secondary Filter |
|----------|--------------|------------------|
| Feed by location | `geolocator.h3_resX in [cells]` | - |
| Hashtag feed | `entities.hashtags array-contains` | - |
| Hashtag in area | `entities.hashtags` + `geolocator.h3_res7` | - |
| Mentions feed | `entities.mentions array-contains` | - |
| User's posts | `username ==` | - |
| Hashtag + mention | `entities.hashtags array-contains` | Filter mentions in memory |
| Multi-hashtag | `entities.hashtags array-contains` (one) | Filter others in memory |

---

## Notes

- **Location in content** (e.g., `📍Findlay Market`) is NOT indexed. The browser should geocode location queries and use `geolocator.h3_resX` to find posts near that location.

- **Entities are always present** on new posts, even if empty arrays.

- **Mentions are case-sensitive** - `@Jon` and `@jon` are stored as different values. Query with exact case.

- **Hashtags are case-insensitive** - stored lowercase. Query with lowercase values.
