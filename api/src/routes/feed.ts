import { Router } from "express";
import { getDb } from "../firestore.js";
import type { PostDoc, PublicPost } from "../types.js";
import { asyncHandler } from "../util/http.js";
import { clampInt, parseH3List } from "../util/h3.js";

const POSTS_COLLECTION = "posts";

function toPublicPost(doc: PostDoc): PublicPost | null {
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
    geolocatorH3: doc.geolocator?.h3_res7,  // h3 field removed, use h3_res7
    accuracyM: doc.geolocator?.accuracyM
  };
}

/**
 * Query Firestore for posts matching H3 cells at a specific resolution
 * @param h3Chunk Array of H3 cell IDs (max 10 for Firestore "in" query)
 * @param overfetch Number of posts to fetch per chunk
 * @param h3Field The Firestore field to query (e.g., "geolocator.h3_res6")
 */
async function queryByH3Chunk(h3Chunk: string[], overfetch: number, h3Field: string): Promise<PublicPost[]> {
  const db = getDb();
  try {
    const snap = await db
      .collection(POSTS_COLLECTION)
      .where(h3Field, "in", h3Chunk)
      .orderBy("time", "desc")
      .limit(overfetch)
      .get();

    const out: PublicPost[] = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as PostDoc;
      const pub = toPublicPost(data);
      if (pub) out.push(pub);
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
): Promise<PublicPost[]> {
  const results: PublicPost[] = [];
  
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
 * Server stores only: h3_res6 (~36km²), h3_res7 (~5km²)
 * Note: The redundant "h3" field was removed from loxation-server
 */
function getH3Field(resolution: number): string {
  if (resolution === 6) return "geolocator.h3_res6";
  // Default to h3_res7 for resolution 7 or any other value
  return "geolocator.h3_res7";
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
   * Returns full content; UI may choose to show a snippet.
   */
  router.get(
    "/feed",
    asyncHandler(async (req, res) => {
      const limit = clampInt(req.query.limit, 50, 1, 100);
      // Overfetch to compensate for filtering missing usernames.
      const overfetch = Math.min(200, Math.max(limit * 3, 50));

      // New multi-resolution approach: single h3 param with resolution selector
      const resolution = clampInt(req.query.resolution, 7, 6, 7);
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
      const results = await queryInBatches(chunks, overfetch, h3Field, 5);
      
      // Deduplicate results
      const merged: PublicPost[] = [];
      const seen = new Set<string>();
      for (const p of results) {
        const key = `${p.username}:${p.messageId}:${p.time}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(p);
      }

      merged.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));

      res.setHeader("Cache-Control", "public, max-age=10");
      return res.status(200).json({
        posts: merged.slice(0, limit)
      });
    })
  );

  return router;
}

