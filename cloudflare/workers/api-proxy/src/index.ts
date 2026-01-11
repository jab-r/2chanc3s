export interface Env {
  CLOUD_RUN_ORIGIN: string;
}

/**
 * Cloudflare Worker: proxy `www.2chanc3s.com/api/*` → `https://<cloud-run-origin>/api/*`
 *
 * Keeps same path and query string.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return new Response("not found", { status: 404 });
    }

    // Handle /api/geoip - return Cloudflare's IP geolocation data (edge-only, no backend)
    if (url.pathname === "/api/geoip") {
      const lat = request.headers.get("CF-IPLatitude");
      const lng = request.headers.get("CF-IPLongitude");
      const city = request.headers.get("CF-IPCity");
      const country = request.headers.get("CF-IPCountry");

      return new Response(
        JSON.stringify({
          lat: lat ? parseFloat(lat) : null,
          lng: lng ? parseFloat(lng) : null,
          city: city ? decodeURIComponent(city) : null,
          country: country || null,
          source: "ip"
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "private, max-age=300" // 5 min, IP-based so don't cache publicly
          }
        }
      );
    }

    const upstream = new URL(request.url);
    upstream.protocol = "https:";
    upstream.hostname = env.CLOUD_RUN_ORIGIN;

    // Preserve method and body.
    const headers = new Headers(request.headers);
    // Avoid confusing the upstream with the Pages host.
    headers.set("host", env.CLOUD_RUN_ORIGIN);

    const init: RequestInit = {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual"
    };

    const resp = await fetch(upstream.toString(), init);

    // Add a small cache TTL for GETs at the edge if desired.
    const outHeaders = new Headers(resp.headers);
    if (request.method === "GET") {
      outHeaders.set("Cache-Control", outHeaders.get("Cache-Control") || "public, max-age=10");
    }

    return new Response(resp.body, {
      status: resp.status,
      headers: outHeaders
    });
  }
};

