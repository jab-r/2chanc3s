# Review: Multi-Resolution H3 Plan (2chanc3s Team)

**Reviewer:** Architect Mode  
**Date:** 2026-01-10  
**Plan File:** [`plans/multi_resolution_h3_plan.md`](plans/multi_resolution_h3_plan.md)

## Executive Summary

The 2chanc3s team's proposal for multi-resolution H3 indexing is **technically sound** and would significantly improve query efficiency for large-area searches. However, I've identified several issues, inconsistencies, and opportunities for improvement that should be addressed before implementation.

**Overall Assessment:** ✅ Approve with modifications

---

## Detailed Analysis

### 1. Backward Compatibility ✅ Good

The plan correctly preserves the existing `h3` field for backward compatibility:

```typescript
// From plan: Primary field preserved
h3,      // Primary (backward compatible)
```

Current implementation at [`src/routes/post.ts:181`](src/routes/post.ts:181):
```typescript
geolocator: h3 ? { h3, accuracyM } : null,
```

**Verdict:** The backward-compatible approach is correct.

---

### 2. Naming Convention Inconsistency ⚠️ Issue

**Problem:** The plan uses `h3r5`, `h3r6`, `h3r7`, `h3r8` naming, but the existing codebase uses `h3_res7`, `h3_res9`, etc.

Existing pattern in [`firestore.indexes.json:49`](firestore.indexes.json:49):
```json
{ "fieldPath": "location.h3_res7", "order": "ASCENDING" }
```

**Recommendation:** Align naming convention. Choose one of:
- Option A: `h3_res5`, `h3_res6`, `h3_res7`, `h3_res8` (consistent with existing)
- Option B: `h3r5`, `h3r6`, `h3r7`, `h3r8` (plan's proposal)

I recommend **Option A** for consistency.

---

### 3. Accuracy Threshold Discrepancy ⚠️ Issue

**Problem:** The plan uses `accuracyM <= 500` to decide whether to include h3r8, but the existing [`chooseH3Resolution()`](src/routes/post.ts:24) uses `accuracyM <= 50`.

| Implementation | Threshold | Result |
|----------------|-----------|--------|
| **Current** ([`post.ts:31`](src/routes/post.ts:31)) | ≤50m | Use res 8 |
| **Proposed plan** | ≤500m | Include h3r8 |

This is a **10x difference** and could affect which posts get indexed at resolution 8.

**Recommendation:** Clarify the rationale. The 500m threshold seems more practical for real-world GPS accuracy, but this change should be intentional.

---

### 4. Storage Cost Implications ⚠️ Moderate Concern

**Current:** 1 string field (`h3`) per post  
**Proposed:** 5 string fields (`h3`, `h3r5`, `h3r6`, `h3r7`, `h3r8`) per post

| Field | Characters | Bytes |
|-------|------------|-------|
| h3 (any res) | ~15 | ~15 |
| **Total current** | ~15 | ~15 |
| **Total proposed** | ~75 | ~75 |

**Firestore Impact:**
- Document size: +60 bytes per post (minimal)
- Index storage: 4 new composite indexes × document count
- Index writes: 4 additional index entries per write

**Recommendation:** Storage increase is acceptable, but note that **Firestore charges for index storage**. The indexes proposed in the plan:

```
geolocator.h3r5 + time (DESC)
geolocator.h3r6 + time (DESC)
geolocator.h3r7 + time (DESC)
geolocator.h3r8 + time (DESC)
```

Consider whether all 4 are needed at launch or if 2-3 would suffice initially.

---

### 5. Privacy Considerations ⚠️ Review Required

| Resolution | Area Coverage | Privacy Concern |
|------------|---------------|-----------------|
| h3r8 | ~0.74 km² | Low - Neighborhood |
| h3r7 | ~5 km² | Low - District |
| h3r6 | ~36 km² | Low - Metro area |
| h3r5 | ~253 km² | **Low - Regional** |

The plan stores h3r5 which identifies the user within a ~253 km² region. This is coarse enough for privacy but may be **too coarse for meaningful searches**.

**Questions to consider:**
- Do users actually search at 60km radius (k=15)?
- Would h3r6 (36 km²) suffice as the coarsest resolution?

---

### 6. Missing Firestore Indexes in loxation-server ❌ Gap

The current [`firestore.indexes.json`](firestore.indexes.json) has **no indexes for the `posts` collection**. The plan references indexes that need to be added:

```json
{
  "collectionGroup": "posts",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "geolocator.h3r5", "order": "ASCENDING" },
    { "fieldPath": "time", "order": "DESCENDING" }
  ]
}
```

**Recommendation:** The plan should include the complete index definitions in JSON format for easy integration.

---

### 7. TypeScript Type Safety Improvement 💡 Enhancement

The plan's helper function returns a loosely-typed object. Consider adding a proper interface:

```typescript
interface MultiResolutionGeolocator {
  h3: string;           // Primary field (backward compat)
  h3_res5: string;      // ~253 km²
  h3_res6: string;      // ~36 km²
  h3_res7: string;      // ~5 km²
  h3_res8?: string;     // ~0.74 km² (optional for low accuracy)
  accuracyM?: number;
}
```

---

### 8. Query Performance Claims Verification ✅ Accurate

The plan's performance claims are mathematically correct:

| Radius | k-ring cells | Current queries (30 per `IN`) | Multi-res queries |
|--------|--------------|------------------------------|-------------------|
| 40km (k=10) | 331 at res8 | 12 queries | 1-2 at res6 |
| 60km (k=15) | 721 at res8 | 25 queries | 1-2 at res5 |

However, the plan's claim of "34 queries" and "73 queries" assumes a different batch size. Firestore's `IN` operator supports **up to 30 values** (was 10 before Nov 2023), so the actual improvement depends on batch size.

**Recommendation:** Verify the batch size assumption in 2chanc3s-api.

---

### 9. Edge Cases Not Addressed ⚠️ Gap

The plan doesn't address:

1. **Posts at cell boundaries:** A post at the exact boundary of two h3r5 cells won't appear in searches for the adjacent cell.

2. **Null location handling:** What happens when `h3` is null but resolution fields exist?

3. **Coordinate (0,0) edge case:** H3 may have issues near null island.

---

## Recommended Changes to Plan

### Change 1: Align Naming Convention

```diff
- h3r5, h3r6, h3r7, h3r8
+ h3_res5, h3_res6, h3_res7, h3_res8
```

### Change 2: Update Accuracy Threshold (or document rationale)

```diff
- const includeR8 = accuracyM === undefined || accuracyM <= 500;
+ const includeR8 = accuracyM === undefined || accuracyM <= 100; // 100m is typical GPS accuracy
```

### Change 3: Add Complete Index Definitions

Include copy-paste ready JSON for [`firestore.indexes.json`](firestore.indexes.json).

### Change 4: Consider Starting with 3 Resolutions

Start with `h3_res6`, `h3_res7`, `h3_res8` and add `h3_res5` only if regional search is needed:

```typescript
geolocator: h3 ? {
  h3,                    // backward compat
  h3_res6: latLngToCell(lat, lng, 6),
  h3_res7: latLngToCell(lat, lng, 7),
  h3_res8: includeR8 ? latLngToCell(lat, lng, 8) : undefined,
  accuracyM
} : null,
```

---

## Summary

| Aspect | Status | Notes |
|--------|--------|-------|
| Core approach | ✅ Sound | Multi-res indexing is correct solution |
| Backward compat | ✅ Good | Primary `h3` field preserved |
| Naming | ⚠️ Fix | Inconsistent with existing convention |
| Accuracy threshold | ⚠️ Review | 500m vs 50m discrepancy |
| Storage cost | ✅ Acceptable | ~60 bytes + indexes |
| Privacy | ✅ OK | All resolutions are coarse |
| Missing indexes | ❌ Gap | No posts indexes exist |
| Performance claims | ✅ Accurate | Math checks out |
| Edge cases | ⚠️ Gap | Boundary/null cases not addressed |

**Recommendation:** Approve the plan after addressing the naming convention and documenting the accuracy threshold decision. The core optimization is valuable and the implementation approach is correct.

---

## Cost-Optimized Implementation Recommendation

Based on the goal of **cost efficiency** and **targeting metropolitan regions at launch**, here is the streamlined approach:

### Launch Configuration: 2 Resolutions Only

At launch, start with just **h3_res6** (metro) and **h3_res7** (district):

| Resolution | Area | Use Case | Included? |
|------------|------|----------|-----------|
| h3_res5 | ~253 km² | Regional | ❌ Phase 2 |
| h3_res6 | ~36 km² | **Metro/city** | ✅ Launch |
| h3_res7 | ~5 km² | **District** | ✅ Launch |
| h3_res8 | ~0.74 km² | Neighborhood | ❌ Phase 2 |

**Rationale:**
- h3_res6 covers entire metro areas efficiently
- h3_res7 provides reasonable granularity for nearby searches
- Saves 50% on index storage and write costs
- Can add h3_res5 and h3_res8 later without migration

### Cost Savings Analysis

| Metric | Original Plan | Cost-Optimized |
|--------|---------------|----------------|
| Fields per post | 5 | 3 |
| Composite indexes | 4 | 2 |
| Index writes per post | 4 | 2 |
| **Index storage cost** | 100% | **50%** |

### Recommended Implementation

```typescript
function buildMultiResolutionGeolocator(
  latitude: number,
  longitude: number,
  accuracyM?: number
): { h3: string; h3_res6: string; h3_res7: string; accuracyM?: number } {
  const h3_res6 = latLngToCell(latitude, longitude, 6);  // ~36 km² metro
  const h3_res7 = latLngToCell(latitude, longitude, 7);  // ~5 km² district
  
  // Primary h3 field uses res7 for backward compatibility
  const h3 = h3_res7;
  
  return {
    h3,        // Primary - backward compatible - district level
    h3_res6,   // Metro-scale queries
    h3_res7,   // District-scale queries - same as h3
    accuracyM
  };
}
```

### Firestore Indexes - Launch Configuration

Add to [`firestore.indexes.json`](firestore.indexes.json):

```json
{
  "collectionGroup": "posts",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "geolocator.h3_res6", "order": "ASCENDING" },
    { "fieldPath": "time", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "posts",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "geolocator.h3_res7", "order": "ASCENDING" },
    { "fieldPath": "time", "order": "DESCENDING" }
  ]
}
```

### Phase 2 Expansion - When Needed

Add h3_res5 (regional) and h3_res8 (neighborhood) when:
- User demand for regional search at greater than 40km radius is validated
- User demand for high-precision local search at less than 2km is validated
- Cost budget allows additional indexes

---

## Implementation Todo List

- [ ] Update [`src/routes/post.ts`](src/routes/post.ts) with `buildMultiResolutionGeolocator` function
- [ ] Add 2 new composite indexes to [`firestore.indexes.json`](firestore.indexes.json)
- [ ] Update 2chanc3s-api feed.ts to query with resolution parameter
- [ ] Update 2chanc3s web app to compute appropriate resolution
- [ ] Deploy Firestore indexes - requires approximately 10 min build time
- [ ] Test with sample posts at various locations
