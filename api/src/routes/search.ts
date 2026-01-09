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

export function buildSearchRouter(): Router {
  const router = Router();

  /**
   * GET /api/search?q=...
   * Optional: h3r7, h3r8 (restrict search to nearby buckets)
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

      const limit = clampInt(req.query.limit, 50, 1, 100);
      const maxScan = clampInt(req.query.maxScan, 500, 50, 2000);

      const h3r7 = parseH3List(req.query.h3r7, 50);
      const h3r8 = parseH3List(req.query.h3r8, 50);
      const all = [...h3r7, ...h3r8];

      const db = getDb();

      let candidates: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
      if (all.length > 0) {
        // If you pass H3 buckets, do a bounded multi-query similar to /feed but smaller scan.
        const chunks: string[][] = [];
        for (let i = 0; i < all.length; i += 10) chunks.push(all.slice(i, i + 10));

        const snaps = await Promise.all(
          chunks.map((chunk) =>
            db
              .collection(POSTS_COLLECTION)
              .where("geolocator.h3", "in", chunk)
              .orderBy("time", "desc")
              .limit(Math.ceil(maxScan / chunks.length))
              .get()
          )
        );

        const docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
        for (const s of snaps) docs.push(...s.docs);
        // Fake a QuerySnapshot-like object for unified iteration.
        candidates = { docs } as any;
      } else {
        candidates = await db.collection(POSTS_COLLECTION).orderBy("time", "desc").limit(maxScan).get();
      }

      const matches: PublicPost[] = [];
      const seen = new Set<string>();
      for (const docSnap of candidates.docs) {
        const data = docSnap.data() as PostDoc;
        const pub = toPublicPost(data);
        if (!pub) continue;

        const hay = `${pub.username} ${pub.content}`.toLowerCase();
        if (!hay.includes(q)) continue;

        const key = `${pub.username}:${pub.messageId}:${pub.time}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push(pub);
        if (matches.length >= limit) break;
      }

      res.setHeader("Cache-Control", "public, max-age=10");
      return res.status(200).json({ posts: matches });
    })
  );

  return router;
}

