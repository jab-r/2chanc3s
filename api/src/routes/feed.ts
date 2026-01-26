import { Router } from "express";
import { getDb } from "../firestore.js";
import type { PostDoc, PublicPost, MediaInfo } from "../types.js";
import { asyncHandler } from "../util/http.js";
import { clampInt, parseH3List } from "../util/h3.js";

const POSTS_COLLECTION = "posts";
const MEDIA_COLLECTION = "postMedia";

/**
 * Media document structure from loxation-server postMedia collection
 * Matches the structure created by POST /v1/posts/media/finalize
 */
type MediaDoc = {
  mediaId: string;
  type: 'image' | 'video' | 'live';
  publicUrl: string;
  // Image fields
  variants?: {
    thumbnail?: string;
    medium?: string;
    large?: string;
    public?: string;
  };
  // Video fields
  thumbnail?: string;    // video thumbnail URL
  iframe?: string;       // embeddable player URL
  status?: string;       // video/live processing status: 'pending' | 'ready' | 'error' | 'created' | 'live' | 'ended'
  duration?: number;     // video duration in seconds
  // Live stream fields
  title?: string;        // live stream title
};

/**
 * Resolve media URLs for a batch of mediaIds
 * Returns map of mediaId -> MediaInfo
 */
async function resolveMediaUrls(mediaIds: string[]): Promise<Map<string, MediaInfo>> {
  const result = new Map<string, MediaInfo>();
  if (mediaIds.length === 0) return result;

  const db = getDb();
  const uniqueIds = [...new Set(mediaIds.filter(Boolean))];
  
  if (uniqueIds.length === 0) return result;
  
  console.log(`[resolveMediaUrls] Resolving ${uniqueIds.length} mediaIds:`, uniqueIds);
  
  try {
    // Batch get all media docs
    const mediaRefs = uniqueIds.map(id => db.collection(MEDIA_COLLECTION).doc(id));
    const snapshots = await db.getAll(...mediaRefs);
    
    console.log(`[resolveMediaUrls] Got ${snapshots.length} snapshots`);
    
    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const requestedId = uniqueIds[i];
      
      if (!snap.exists) {
        console.log(`[resolveMediaUrls] Media doc not found: ${requestedId}`);
        continue;
      }
      
      const data = snap.data() as MediaDoc;
      console.log(`[resolveMediaUrls] Found media doc:`, {
        id: snap.id,
        mediaId: data.mediaId,
        type: data.type,
        hasVariants: !!data.variants,
        publicUrl: data.publicUrl?.substring(0, 50) + '...'
      });
      
      // Use snap.id as the key since that's what we queried with
      const docId = snap.id;
      
      if (data.type === 'image') {
        result.set(docId, {
          type: 'image',
          thumbnail: data.variants?.thumbnail,
          medium: data.variants?.medium,
          large: data.variants?.large,
          public: data.publicUrl || data.variants?.public,
        });
      } else if (data.type === 'video') {
        // For videos, publicUrl contains the HLS manifest URL
        result.set(docId, {
          type: 'video',
          thumbnail: data.thumbnail,
          stream: data.publicUrl,  // HLS manifest URL
          duration: data.duration,
        });
      } else if (data.type === 'live') {
        // For live streams, use publicUrl which is updated by iOS client via /broadcast-started
        // After broadcast starts, publicUrl contains the correct Video Output UID URL
        result.set(docId, {
          type: 'live',
          stream: data.publicUrl,  // HLS manifest URL (updated when broadcast starts)
          status: data.status as 'created' | 'live' | 'ended',
          title: data.title,
        });
      } else {
        console.log(`[resolveMediaUrls] Unknown media type: ${data.type}`);
      }
    }
    
    console.log(`[resolveMediaUrls] Resolved ${result.size} media items`);
  } catch (err) {
    console.error('[resolveMediaUrls] Error resolving media URLs:', err);
  }
  
  return result;
}

function toPublicPost(doc: PostDoc, mediaInfo?: MediaInfo): PublicPost | null {
  const username = typeof doc.username === "string" ? doc.username.trim() : "";
  if (!username) return null;
  if (typeof doc.messageId !== "string" || doc.messageId.trim() === "") return null;
  if (typeof doc.time !== "string" || doc.time.trim() === "") return null;
  if (typeof doc.content !== "string") return null;

  return {
    username,
    messageId: doc.messageId,
    time: doc.time,
    content: doc.content,
    contentType: doc.contentType || 'text/plain',
    media: mediaInfo,
    geolocatorH3: doc.geolocator?.h3_res7,
    accuracyM: doc.geolocator?.accuracyM
  };
}

/**
 * Query Firestore for posts matching H3 cells at a specific resolution
 * @param h3Chunk Array of H3 cell IDs (max 10 for Firestore "in" query)
 * @param overfetch Number of posts to fetch per chunk
 * @param h3Field The Firestore field to query (e.g., "geolocator.h3_res6")
 */
async function queryByH3Chunk(h3Chunk: string[], overfetch: number, h3Field: string): Promise<PostDoc[]> {
  const db = getDb();
  try {
    const snap = await db
      .collection(POSTS_COLLECTION)
      .where(h3Field, "in", h3Chunk)
      .orderBy("time", "desc")
      .limit(overfetch)
      .get();

    const out: PostDoc[] = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as PostDoc;
      out.push(data);
    }
    return out;
  } catch (err) {
    console.error(`Firestore query error on ${h3Field}:`, err);
    return [];
  }
}

/**
 * Run queries in batches to avoid overwhelming Firestore
 */
async function queryInBatches(
  chunks: string[][],
  overfetch: number,
  h3Field: string,
  concurrency: number = 5
): Promise<PostDoc[]> {
  const results: PostDoc[] = [];
  
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((c) => queryByH3Chunk(c, overfetch, h3Field))
    );
    for (const arr of batchResults) {
      results.push(...arr);
    }
  }
  
  return results;
}

/**
 * Get the Firestore field name for a given H3 resolution
 * Server stores: h3_res6 (~36km²), h3_res7 (~5km²), h3_res8 (~0.74km²), h3_res9 (~0.11km²)
 */
function getH3Field(resolution: number): string {
  switch (resolution) {
    case 6: return "geolocator.h3_res6";
    case 8: return "geolocator.h3_res8";
    case 9: return "geolocator.h3_res9";
    default: return "geolocator.h3_res7";
  }
}

export function buildFeedRouter(): Router {
  const router = Router();

  /**
   * GET /api/feed
   * Query:
   * - h3: comma-separated H3 cells for multi-resolution queries
   * - resolution: 6 or 7 (default 7) - determines which geolocator field to query
   * - h3r7: (deprecated) comma-separated H3 resolution 7 cells
   * - h3r8: (deprecated) comma-separated H3 resolution 8 cells - mapped to h3_res7
   * - limit: 1..100
   *
   * Returns full content with media URLs; UI may choose to show a snippet.
   */
  router.get(
    "/feed",
    asyncHandler(async (req, res) => {
      const limit = clampInt(req.query.limit, 50, 1, 100);
      // Overfetch to compensate for filtering missing usernames.
      const overfetch = Math.min(200, Math.max(limit * 3, 50));

      // New multi-resolution approach: single h3 param with resolution selector
      // Supports res 6 (metro), 7 (district), 8 (neighborhood), 9 (block)
      const resolution = clampInt(req.query.resolution, 7, 6, 9);
      const h3Cells = parseH3List(req.query.h3, 200);
      
      // Deprecated h3r7/h3r8 params - old cached web app versions may still use these.
      // When both are sent, it results in 12KB+ URLs and 60+ Firestore queries.
      // We ignore h3r8 when h3r7 is present to cut queries in half.
      const h3r7 = parseH3List(req.query.h3r7, 200);
      const h3r8 = parseH3List(req.query.h3r8, 200);
      
      // Priority: new h3 param > deprecated h3r7 > deprecated h3r8
      let all: string[];
      let h3Field: string;
      
      if (h3Cells.length > 0) {
        // New multi-resolution approach with explicit resolution selector
        all = h3Cells;
        h3Field = getH3Field(resolution);
      } else if (h3r7.length > 0) {
        // Deprecated: use h3r7 (~5km² cells) with new indexed field
        all = h3r7;
        h3Field = "geolocator.h3_res7";
        if (h3r8.length > 0) {
          console.warn(`Cached client sent both h3r7 (${h3r7.length}) and h3r8 (${h3r8.length}) - ignoring h3r8`);
        }
      } else if (h3r8.length > 0) {
        // Deprecated: fallback to h3r8 if no r7 provided
        // Note: h3 field was removed, use h3_res7 (res8 cells won't match but at least won't error)
        all = h3r8;
        h3Field = "geolocator.h3_res7";
        console.warn(`Deprecated h3r8 param used with ${h3r8.length} cells - mapped to h3_res7 (may not match)`);
      } else {
        all = [];
        h3Field = "geolocator.h3_res7";
      }

      if (all.length === 0) {
        return res.status(400).json({
          error: {
            code: "invalid_request",
            message: "h3 or h3r7/h3r8 is required"
          }
        });
      }

      // Chunk into groups of 10 for Firestore "in" (max 10 values per query)
      const chunks: string[][] = [];
      for (let i = 0; i < all.length; i += 10) {
        chunks.push(all.slice(i, i + 10));
      }

      // Use batched queries with limited concurrency to avoid overwhelming Firestore
      const postDocs = await queryInBatches(chunks, overfetch, h3Field, 5);
      
      // Deduplicate results by messageId
      const deduped: PostDoc[] = [];
      const seen = new Set<string>();
      for (const doc of postDocs) {
        const key = `${doc.username}:${doc.messageId}:${doc.time}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(doc);
      }

      // Sort by time descending
      deduped.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
      
      // Take only what we need
      const limitedDocs = deduped.slice(0, limit);
      
      // Log posts with media for debugging
      const postsWithMedia = limitedDocs.filter(doc => doc.mediaId);
      console.log(`[feed] Found ${limitedDocs.length} posts, ${postsWithMedia.length} with mediaId`);
      if (postsWithMedia.length > 0) {
        console.log(`[feed] Posts with media:`, postsWithMedia.map(d => ({
          username: d.username,
          messageId: d.messageId,
          mediaId: d.mediaId,
          contentType: d.contentType
        })));
      }
      
      // Collect mediaIds and batch-resolve media URLs
      const mediaIds = postsWithMedia.map(doc => doc.mediaId as string);
      
      const mediaMap = await resolveMediaUrls(mediaIds);
      
      // Convert to PublicPost with media info
      const posts: PublicPost[] = [];
      for (const doc of limitedDocs) {
        const mediaInfo = doc.mediaId ? mediaMap.get(doc.mediaId) : undefined;
        if (doc.mediaId && !mediaInfo) {
          console.log(`[feed] WARNING: mediaId ${doc.mediaId} not found in mediaMap`);
        }
        const pub = toPublicPost(doc, mediaInfo);
        if (pub) posts.push(pub);
      }

      res.setHeader("Cache-Control", "public, max-age=10");
      return res.status(200).json({
        posts
      });
    })
  );

  return router;
}
