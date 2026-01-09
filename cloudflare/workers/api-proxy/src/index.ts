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

    const upstream = new URL(request.url);
    upstream.protocol = "https:";
    upstream.hostname = env.CLOUD_RUN_ORIGIN;

    // Preserve method and body.
    const init: RequestInit = {
      method: request.method,
      headers: new Headers(request.headers),
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual"
    };

    // Avoid confusing the upstream with the Pages host.
    init.headers.set("host", env.CLOUD_RUN_ORIGIN);

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

