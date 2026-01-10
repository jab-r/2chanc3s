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
    geolocatorH3: doc.geolocator?.h3,
    accuracyM: doc.geolocator?.accuracyM
  };
}

async function queryByH3Chunk(h3Chunk: string[], overfetch: number): Promise<PublicPost[]> {
  const db = getDb();
  const snap = await db
    .collection(POSTS_COLLECTION)
    .where("geolocator.h3", "in", h3Chunk)
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
}

export function buildFeedRouter(): Router {
  const router = Router();

  /**
   * GET /api/feed
   * Query:
   * - h3r7: comma-separated H3 cells (<= 50 accepted, server will chunk to 10)
   * - h3r8: comma-separated H3 cells (<= 50 accepted, server will chunk to 10)
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

      // Increased from 50 to 200 to support metro-scale searches (k=10+)
      const h3r7 = parseH3List(req.query.h3r7, 200);
      const h3r8 = parseH3List(req.query.h3r8, 200); // Optional for large radius queries
      const all = [...h3r7, ...h3r8];

      if (all.length === 0) {
        return res.status(400).json({
          error: {
            code: "invalid_request",
            message: "h3r7 or h3r8 is required"
          }
        });
      }

      // Chunk into groups of 10 for Firestore "in".
      const chunks: string[][] = [];
      for (let i = 0; i < all.length; i += 10) {
        chunks.push(all.slice(i, i + 10));
      }

      const results = await Promise.all(chunks.map((c) => queryByH3Chunk(c, overfetch)));
      const merged: PublicPost[] = [];
      const seen = new Set<string>();
      for (const arr of results) {
        for (const p of arr) {
          const key = `${p.username}:${p.messageId}:${p.time}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(p);
        }
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

