# Public Post Parser & Entity Indexing

## Overview

Parse post content to extract and index `#hashtags`, `@mentions`, and URLs for querying.

**Scope:**
- Extract hashtags, mentions, URLs from post content
- Store in `entities` field for Firestore `array-contains` queries
- Existing `geolocator` geocoding remains unchanged

**Out of scope:**
- 📍 location parsing (clients handle this for queries)
- locationCandidates / locationEntities

---

## 1. Parser Implementation

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/postContentParser.ts` | Parser service |
| `src/tests/postContentParser.test.ts` | Unit tests |

### Parser Behavior

**Extract:**
- `@username` → mentions array (lowercase)
- `#tag` → hashtags array (lowercase)
- `https://...` or `http://...` → urls array

**Output:**
```typescript
interface ParseResult {
  mentions: string[];   // Unique lowercase usernames
  hashtags: string[];   // Unique lowercase tags
  urls: string[];       // Unique URLs
}
```

---

## 2. Database Schema Changes

### New Fields on Post Documents

Add `entities` field:

```typescript
interface PostEntities {
  mentions: string[];   // ["jon", "alice"] - indexed
  hashtags: string[];   // ["food", "outdoors"] - indexed
  urls: string[];       // stored, not indexed
}
```

### Example Stored Document

For content: `Check out #food @jon https://example.com`

```json
{
  "deviceId": "abc123",
  "content": "Check out #food @jon https://example.com",
  "geolocator": { "h3_res6": "...", "h3_res7": "..." },

  "entities": {
    "mentions": ["jon"],
    "hashtags": ["food"],
    "urls": ["https://example.com"]
  }
}
```

### New Firestore Indexes

Add to `firestore.indexes.json`:

```json
[
  {
    "collectionGroup": "posts",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "entities.hashtags", "arrayConfig": "CONTAINS" },
      { "fieldPath": "time", "order": "DESCENDING" }
    ]
  },
  {
    "collectionGroup": "posts",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "entities.hashtags", "arrayConfig": "CONTAINS" },
      { "fieldPath": "geolocator.h3_res7", "order": "ASCENDING" },
      { "fieldPath": "time", "order": "DESCENDING" }
    ]
  },
  {
    "collectionGroup": "posts",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "entities.mentions", "arrayConfig": "CONTAINS" },
      { "fieldPath": "time", "order": "DESCENDING" }
    ]
  }
]
```

---

## 3. Integration into Post Creation

### Modify `src/routes/post.ts`

After validating `messageText`, parse and add entities:

```typescript
import { postContentParser } from '../services/postContentParser';

// Parse content for entities
const entities = postContentParser.parse(messageText);

// Add to postData (existing geolocator logic unchanged)
const postData = {
  // ... existing fields ...
  entities
};
```

---

## 4. Implementation Sequence

1. **Implement parser** - `src/services/postContentParser.ts`
2. **Write tests** - `src/tests/postContentParser.test.ts`
3. **Run tests** - `npm test`
4. **Update indexes** - Add new indexes to `firestore.indexes.json`
5. **Integrate** - Modify `src/routes/post.ts` to parse and store entities
6. **Deploy indexes** - `firebase deploy --only firestore:indexes`

---

## 5. Critical Files

| File | Action |
|------|--------|
| `src/services/postContentParser.ts` | Create (new) |
| `src/tests/postContentParser.test.ts` | Create (new) |
| `src/routes/post.ts` | Modify (add parsing) |
| `firestore.indexes.json` | Modify (add 3 new indexes) |

---

## 6. Verification

1. **Unit tests**: `npm test` - verify parser extracts:
   - `#food #FOOD` → `["food"]` (deduped, lowercase)
   - `@jon @alice` → `["jon", "alice"]`
   - `https://example.com` → `["https://example.com"]`
   - Edge cases: empty input, no entities, mixed content

2. **Integration test**: Create post via API, verify `entities` field in Firestore

3. **Query test** (in 2chanc3s):
   ```typescript
   db.collection('posts')
     .where('entities.hashtags', 'array-contains', 'food')
     .orderBy('time', 'desc')
   ```
