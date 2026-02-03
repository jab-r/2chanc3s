import { Router } from "express";
import { getDb } from "../firestore.js";
import type { PostDoc, PublicPost, MediaInfo, SearchRequest } from "../types.js";
import { asyncHandler } from "../util/http.js";
import { clampInt, parseH3List } from "../util/h3.js";

const POSTS_COLLECTION = "posts";
const MEDIA_COLLECTION = "postMedia";

/**
 * Media document structure from loxation-server postMedia collection
 */
type MediaDoc = {
  mediaId: string;
  type: 'image' | 'video' | 'live';
  publicUrl: string;
  variants?: {
    thumbnail?: string;
    medium?: string;
    large?: string;
    public?: string;
  };
  thumbnail?: string;
  iframe?: string;
  status?: string;
  duration?: number;
  title?: string;  // Live stream title
};

/**
 * Resolve media URLs for a batch of mediaIds
 */
async function resolveMediaUrls(mediaIds: string[]): Promise<Map<string, MediaInfo>> {
  const result = new Map<string, MediaInfo>();
  if (mediaIds.length === 0) return result;

  const db = getDb();
  const uniqueIds = [...new Set(mediaIds.filter(Boolean))];
  
  if (uniqueIds.length === 0) return result;
  
  try {
    const mediaRefs = uniqueIds.map(id => db.collection(MEDIA_COLLECTION).doc(id));
    const snapshots = await db.getAll(...mediaRefs);
    
    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      if (!snap.exists) continue;
      
      const data = snap.data() as MediaDoc;
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
        result.set(docId, {
          type: 'video',
          thumbnail: data.thumbnail,
          stream: data.publicUrl,
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
      }
    }
  } catch (err) {
    console.error('[search resolveMediaUrls] Error resolving media URLs:', err);
  }
  
  return result;
}

function toPublicPost(doc: PostDoc, mediaInfo?: MediaInfo): PublicPost | null {
  const username = typeof doc.username === "string" ? doc.username.trim() : null;
  const hasIdentityLink = doc.replyLinkHandle && doc.replyLinkEntropy;

  // Must have either username OR identity link to be replyable
  if (!username && !hasIdentityLink) return null;
  if (typeof doc.messageId !== "string" || doc.messageId.trim() === "") return null;
  if (typeof doc.time !== "string" || doc.time.trim() === "") return null;
  if (typeof doc.content !== "string") return null;

  return {
    username: username || null,
    messageId: doc.messageId,
    time: doc.time,
    content: doc.content,
    contentType: doc.contentType || 'text/plain',
    media: mediaInfo,
    geolocatorH3: doc.geolocator?.h3_res7,
    accuracyM: doc.geolocator?.accuracyM,
    // Include identity link fields for anonymous posts
    replyLinkHandle: doc.replyLinkHandle || null,
    replyLinkEntropy: doc.replyLinkEntropy || null,
    displayName: doc.displayName || null
  };
}

/**
 * Get the Firestore field name for a given H3 resolution
 * Server stores only: h3_res6 (~36km²), h3_res7 (~5km²)
 * Note: The redundant "h3" field was removed from loxation-server
 */
function getH3Field(resolution: number): string {
  if (resolution === 6) return "geolocator.h3_res6";
  // Default to h3_res7 for resolution 7 or any other value
  return "geolocator.h3_res7";
}

export function buildSearchRouter(): Router {
  const router = Router();

  /**
   * GET /api/search?q=...
   * Optional:
   * - h3: comma-separated H3 cells with resolution param
   * - resolution: 6 or 7 (default 7)
   * - h3r7, h3r8: (legacy) restrict search to nearby buckets
   *
   * NOTE: Firestore does not support substring search without specialized indexing.
   * v1 strategy: bounded scan over recent posts (and optionally within nearby H3 buckets)
   * then filter in-memory.
   */
  router.get(
    "/search",
    asyncHandler(async (req, res) => {
      const qRaw = typeof req.query.q === "string" ? req.query.q : "";
      const q = qRaw.trim().toLowerCase();
      if (q.length < 2 || q.length > 80) {
        return res.status(400).json({
          error: { code: "invalid_request", message: "q must be 2..80 characters" }
        });
      }

      // Detect @username search - query starts with @ followed by at least 1 character
      const isUsernameSearch = q.startsWith('@') && q.length > 1;
      const targetUsername = isUsernameSearch ? q.slice(1) : null;

      const limit = clampInt(req.query.limit, 50, 1, 100);
      const maxScan = clampInt(req.query.maxScan, 500, 50, 2000);

      // New multi-resolution approach
      const resolution = clampInt(req.query.resolution, 7, 6, 7);
      const h3Cells = parseH3List(req.query.h3, 200);
      
      // Deprecated h3r7/h3r8 params - old clients may still use these
      const h3r7 = parseH3List(req.query.h3r7, 200);
      const h3r8 = parseH3List(req.query.h3r8, 200);
      
      // Priority: new h3 param > deprecated h3r7 > deprecated h3r8
      let all: string[];
      let h3Field: string;
      
      if (h3Cells.length > 0) {
        all = h3Cells;
        h3Field = getH3Field(resolution);
      } else if (h3r7.length > 0) {
        all = h3r7;
        h3Field = "geolocator.h3_res7";
      } else if (h3r8.length > 0) {
        // h3r8 cells won't match h3_res7, but avoid errors
        all = h3r8;
        h3Field = "geolocator.h3_res7";
      } else {
        all = [];
        h3Field = "geolocator.h3_res7";
      }

      const db = getDb();

      let candidates: { docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] };
      
      if (isUsernameSearch && targetUsername) {
        // @username search - use Firestore equality filter on username
        if (all.length > 0) {
          // With geo filter - use composite index: username + h3 + time
          // Chunk H3 cells into groups of 10 (Firestore 'in' limit)
          const chunks: string[][] = [];
          for (let i = 0; i < all.length; i += 10) chunks.push(all.slice(i, i + 10));
          
          const docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
          const concurrency = 5;
          for (let i = 0; i < chunks.length; i += concurrency) {
            const batch = chunks.slice(i, i + concurrency);
            try {
              const snaps = await Promise.all(
                batch.map((chunk) =>
                  db
                    .collection(POSTS_COLLECTION)
                    .where("username", "==", targetUsername)
                    .where(h3Field, "in", chunk)
                    .orderBy("time", "desc")
                    .limit(Math.ceil(maxScan / chunks.length))
                    .get()
                )
              );
              for (const s of snaps) docs.push(...s.docs);
            } catch (err) {
              console.error(`Firestore username+h3 search query error on ${h3Field}:`, err);
            }
          }
          candidates = { docs };
        } else {
          // Global username search - no geo filter
          const snap = await db
            .collection(POSTS_COLLECTION)
            .where("username", "==", targetUsername)
            .orderBy("time", "desc")
            .limit(maxScan)
            .get();
          candidates = { docs: snap.docs };
        }
      } else if (all.length > 0) {
        // Regular substring search with H3 geo filter
        const chunks: string[][] = [];
        for (let i = 0; i < all.length; i += 10) chunks.push(all.slice(i, i + 10));

        // Use batched queries with limited concurrency (5 at a time) to avoid overwhelming Firestore
        const docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
        const concurrency = 5;
        for (let i = 0; i < chunks.length; i += concurrency) {
          const batch = chunks.slice(i, i + concurrency);
          try {
            const snaps = await Promise.all(
              batch.map((chunk) =>
                db
                  .collection(POSTS_COLLECTION)
                  .where(h3Field, "in", chunk)
                  .orderBy("time", "desc")
                  .limit(Math.ceil(maxScan / chunks.length))
                  .get()
              )
            );
            for (const s of snaps) docs.push(...s.docs);
          } catch (err) {
            console.error(`Firestore search query error on ${h3Field}:`, err);
          }
        }
        candidates = { docs };
      } else {
        // No geo filter - scan recent posts globally
        const snap = await db.collection(POSTS_COLLECTION).orderBy("time", "desc").limit(maxScan).get();
        candidates = { docs: snap.docs };
      }

      // Sort all candidates by time descending (needed when merging multiple chunks)
      candidates.docs.sort((a, b) => {
        const timeA = a.data().time || "";
        const timeB = b.data().time || "";
        return timeB.localeCompare(timeA);
      });

      // First pass: filter and deduplicate, collecting PostDocs
      const matchedDocs: PostDoc[] = [];
      const seen = new Set<string>();
      for (const docSnap of candidates.docs) {
        const data = docSnap.data() as PostDoc;
        
        // Basic validation - must have username
        const username = typeof data.username === "string" ? data.username.trim() : "";
        if (!username) continue;
        if (typeof data.messageId !== "string" || data.messageId.trim() === "") continue;
        if (typeof data.time !== "string" || data.time.trim() === "") continue;
        if (typeof data.content !== "string") continue;

        // For regular search (not @username), apply substring filter
        if (!isUsernameSearch) {
          const hay = `${username} ${data.content}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }

        const key = `${username}:${data.messageId}:${data.time}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matchedDocs.push(data);
        if (matchedDocs.length >= limit) break;
      }

      // Collect mediaIds and batch-resolve media URLs
      const mediaIds = matchedDocs
        .filter(doc => doc.mediaId)
        .map(doc => doc.mediaId as string);
      
      const mediaMap = await resolveMediaUrls(mediaIds);

      // Convert to PublicPost with media info
      const matches: PublicPost[] = [];
      for (const doc of matchedDocs) {
        const mediaInfo = doc.mediaId ? mediaMap.get(doc.mediaId) : undefined;
        const pub = toPublicPost(doc, mediaInfo);
        if (pub) matches.push(pub);
      }

      res.setHeader("Cache-Control", "public, max-age=10");
      return res.status(200).json({ posts: matches });
    })
  );

  /**
   * POST /api/search
   *
   * Structured search with parsed query entities.
   * Body: SearchRequest { hashtags?, mentions?, text?, location?, limit?, maxScan? }
   */
  router.post(
    "/search",
    asyncHandler(async (req, res) => {
      const body = req.body as SearchRequest;

      const hashtags = Array.isArray(body.hashtags) ? body.hashtags.filter(h => typeof h === 'string' && h.length > 0) : [];
      const mentions = Array.isArray(body.mentions) ? body.mentions.filter(m => typeof m === 'string' && m.length > 0) : [];
      const text = typeof body.text === 'string' ? body.text.trim().toLowerCase() : null;
      const location = body.location?.h3Cells?.length ? body.location : null;

      const limit = clampInt(body.limit, 50, 1, 100);
      const maxScan = clampInt(body.maxScan, 500, 50, 2000);

      // Must have at least one filter
      if (hashtags.length === 0 && mentions.length === 0 && !text && !location) {
        return res.status(400).json({
          error: { code: "invalid_request", message: "At least one search filter required (hashtags, mentions, text, or location)" }
        });
      }

      const db = getDb();
      const hasHashtag = hashtags.length > 0;
      const hasMention = mentions.length > 0;
      const hasLocation = location !== null;
      const hasText = text !== null && text.length >= 2;

      let candidates: PostDoc[] = [];
      const inMemoryFilters: ((doc: PostDoc) => boolean)[] = [];

      // Determine query strategy based on available filters
      // Priority: hashtag (most selective) > mention > location > text scan

      if (hasHashtag && hasLocation) {
        // Use composite query: hashtags array-contains + h3 == (per cell)
        const h3Field = getH3Field(location.resolution);
        const h3FieldKey = location.resolution === 6 ? 'h3_res6' : 'h3_res7';
        const primaryHashtag = hashtags[0].toLowerCase();
        const perCellLimit = Math.ceil(maxScan / Math.min(location.h3Cells.length, 50));

        // Query each H3 cell separately (array-contains + == is allowed, but array-contains + in is NOT)
        const cellPromises = location.h3Cells.slice(0, 50).map(cell =>
          db.collection(POSTS_COLLECTION)
            .where('entities.hashtags', 'array-contains', primaryHashtag)
            .where(h3Field, '==', cell)
            .orderBy('time', 'desc')
            .limit(perCellLimit)
            .get()
            .catch(err => {
              console.error(`[search POST] hashtag+h3 query error:`, err);
              return { docs: [] };
            })
        );

        const snaps = await Promise.all(cellPromises);
        for (const snap of snaps) {
          for (const doc of snap.docs) {
            candidates.push(doc.data() as PostDoc);
          }
        }

        // Filter additional hashtags in memory
        if (hashtags.length > 1) {
          const extraHashtags = hashtags.slice(1).map(h => h.toLowerCase());
          inMemoryFilters.push(doc =>
            extraHashtags.every(h => doc.entities?.hashtags?.includes(h))
          );
        }

        // Filter mentions in memory
        if (hasMention) {
          inMemoryFilters.push(doc =>
            mentions.every(m => doc.entities?.mentions?.includes(m))
          );
        }

      } else if (hasHashtag) {
        // Query by first hashtag
        const primaryHashtag = hashtags[0].toLowerCase();
        const snap = await db.collection(POSTS_COLLECTION)
          .where('entities.hashtags', 'array-contains', primaryHashtag)
          .orderBy('time', 'desc')
          .limit(maxScan)
          .get();
        candidates = snap.docs.map(d => d.data() as PostDoc);

        // Filter additional hashtags in memory
        if (hashtags.length > 1) {
          const extraHashtags = hashtags.slice(1).map(h => h.toLowerCase());
          inMemoryFilters.push(doc =>
            extraHashtags.every(h => doc.entities?.hashtags?.includes(h))
          );
        }

        // Filter mentions in memory
        if (hasMention) {
          inMemoryFilters.push(doc =>
            mentions.every(m => doc.entities?.mentions?.includes(m))
          );
        }

        // Filter location in memory
        if (hasLocation) {
          const h3Set = new Set(location.h3Cells);
          const h3FieldKey = location.resolution === 6 ? 'h3_res6' : 'h3_res7';
          inMemoryFilters.push(doc => {
            const docH3 = doc.geolocator?.[h3FieldKey];
            return docH3 ? h3Set.has(docH3) : false;
          });
        }

      } else if (hasMention) {
        // Query by first mention (case-sensitive)
        const primaryMention = mentions[0];
        const snap = await db.collection(POSTS_COLLECTION)
          .where('entities.mentions', 'array-contains', primaryMention)
          .orderBy('time', 'desc')
          .limit(maxScan)
          .get();
        candidates = snap.docs.map(d => d.data() as PostDoc);

        // Filter additional mentions in memory
        if (mentions.length > 1) {
          const extraMentions = mentions.slice(1);
          inMemoryFilters.push(doc =>
            extraMentions.every(m => doc.entities?.mentions?.includes(m))
          );
        }

        // Filter location in memory
        if (hasLocation) {
          const h3Set = new Set(location.h3Cells);
          const h3FieldKey = location.resolution === 6 ? 'h3_res6' : 'h3_res7';
          inMemoryFilters.push(doc => {
            const docH3 = doc.geolocator?.[h3FieldKey];
            return docH3 ? h3Set.has(docH3) : false;
          });
        }

      } else if (hasLocation) {
        // Location-only query - use existing H3 query pattern
        const h3Field = getH3Field(location.resolution);
        const chunks: string[][] = [];
        for (let i = 0; i < location.h3Cells.length; i += 10) {
          chunks.push(location.h3Cells.slice(i, i + 10));
        }

        const docs: PostDoc[] = [];
        const concurrency = 5;
        for (let i = 0; i < chunks.slice(0, 20).length; i += concurrency) {
          const batch = chunks.slice(i, i + concurrency);
          try {
            const snaps = await Promise.all(
              batch.map(chunk =>
                db.collection(POSTS_COLLECTION)
                  .where(h3Field, 'in', chunk)
                  .orderBy('time', 'desc')
                  .limit(Math.ceil(maxScan / chunks.length))
                  .get()
              )
            );
            for (const snap of snaps) {
              for (const doc of snap.docs) {
                docs.push(doc.data() as PostDoc);
              }
            }
          } catch (err) {
            console.error(`[search POST] location query error:`, err);
          }
        }
        candidates = docs;

      } else {
        // Text-only search - scan recent posts
        const snap = await db.collection(POSTS_COLLECTION)
          .orderBy('time', 'desc')
          .limit(maxScan)
          .get();
        candidates = snap.docs.map(d => d.data() as PostDoc);
      }

      // Always apply text filter if present
      if (hasText) {
        inMemoryFilters.push(doc => {
          const hay = `${doc.username || ''} ${doc.content}`.toLowerCase();
          return hay.includes(text);
        });
      }

      // Apply in-memory filters
      let results = candidates;
      for (const filter of inMemoryFilters) {
        results = results.filter(filter);
      }

      // Sort by time descending and deduplicate
      results.sort((a, b) => (b.time || '').localeCompare(a.time || ''));

      const seen = new Set<string>();
      const matchedDocs: PostDoc[] = [];
      for (const doc of results) {
        const username = typeof doc.username === 'string' ? doc.username.trim() : '';
        const hasIdentityLink = doc.replyLinkHandle && doc.replyLinkEntropy;
        if (!username && !hasIdentityLink) continue;
        if (typeof doc.messageId !== 'string' || !doc.messageId.trim()) continue;
        if (typeof doc.time !== 'string' || !doc.time.trim()) continue;
        if (typeof doc.content !== 'string') continue;

        const key = `${username || doc.replyLinkHandle}:${doc.messageId}:${doc.time}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matchedDocs.push(doc);
        if (matchedDocs.length >= limit) break;
      }

      // Resolve media URLs
      const mediaIds = matchedDocs
        .filter(doc => doc.mediaId)
        .map(doc => doc.mediaId as string);
      const mediaMap = await resolveMediaUrls(mediaIds);

      // Convert to PublicPost
      const matches: PublicPost[] = [];
      for (const doc of matchedDocs) {
        const mediaInfo = doc.mediaId ? mediaMap.get(doc.mediaId) : undefined;
        const pub = toPublicPost(doc, mediaInfo);
        if (pub) matches.push(pub);
      }

      res.setHeader("Cache-Control", "public, max-age=10");
      return res.status(200).json({ posts: matches });
    })
  );

  return router;
}

