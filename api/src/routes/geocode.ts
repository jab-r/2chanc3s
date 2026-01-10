import { Router } from "express";
import { asyncHandler } from "../util/http.js";

export function buildGeocodeRouter(): Router {
  const router = Router();

  /**
   * GET /api/geocode?q=Cincinnati+OH
   * Proxy to OpenStreetMap Nominatim to avoid CORS issues.
   * Returns: { lat, lon, displayName } or 404 if not found.
   */
  router.get(
    "/geocode",
    asyncHandler(async (req, res) => {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (q.length < 2 || q.length > 200) {
        return res.status(400).json({
          error: { code: "invalid_request", message: "q must be 2..200 characters" }
        });
      }

      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;
      
      const response = await fetch(url, {
        headers: {
          "User-Agent": "2chanc3s-api/1.0 (https://www.2chanc3s.com)"
        }
      });

      if (!response.ok) {
        return res.status(502).json({
          error: { code: "geocode_failed", message: "Nominatim request failed" }
        });
      }

      const data = await response.json();
      
      if (!Array.isArray(data) || data.length === 0) {
        return res.status(404).json({
          error: { code: "not_found", message: "Address not found" }
        });
      }

      const result = data[0];
      res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24h
      return res.status(200).json({
        lat: parseFloat(result.lat),
        lon: parseFloat(result.lon),
        displayName: result.display_name
      });
    })
  );

  return router;
}
