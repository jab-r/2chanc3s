# Deploy: `www.2chanc3s.com` (Cloudflare Pages) + `/api/*` (GCP Cloud Run)

This repo is structured as:

- Static site (Cloudflare Pages): [`web/public/index.html`](../web/public/index.html:1)
- API (Cloud Run): [`api/src/index.ts`](../api/src/index.ts:1)

Goal:

- `https://www.2chanc3s.com/` → Cloudflare Pages static site
- `https://www.2chanc3s.com/api/*` → proxied to Cloud Run service

## 1) Deploy API to Cloud Run (GCP)

### Prereqs

- You can deploy from source using Google buildpacks (no Dockerfile required).
- Ensure the Cloud Run service account has Firestore access.

### Deploy command

Run from repo root:

```bash
gcloud run deploy chanc3s-api --source ./api --region us-central1 --allow-unauthenticated --set-env-vars "FIREBASE_PROJECT_ID=loxation-f8e1c,CORS_ALLOWED_ORIGINS=https://www.2chanc3s.com\,https://community.loxation.com,CORS_ALLOW_LOCALHOST=false"
```

Note: The comma in `CORS_ALLOWED_ORIGINS` is escaped (`\,`) to prevent gcloud from interpreting it as a separator between env vars.

Notes:

- The server listens on `PORT` automatically as in [`api/src/config.ts`](../api/src/config.ts:1).
- After deploy, copy the Cloud Run URL, e.g. `https://2chanc3s-api-xxxxx-uc.a.run.app`.

### Health check

Cloud Run should return:

- `GET /healthz` → `ok` via [`api/src/index.ts`](../api/src/index.ts:1)

## 2) Cloudflare Worker to proxy `/api/*` to Cloud Run

Cloudflare Pages serves `www.2chanc3s.com` at the root path. To also serve `/api/*` from Cloud Run under the same domain, the simplest approach is a Cloudflare Worker route.

Files to use:

- Worker source: [`cloudflare/workers/api-proxy/src/index.ts`](../cloudflare/workers/api-proxy/src/index.ts:1)
- Wrangler config: [`cloudflare/workers/api-proxy/wrangler.toml`](../cloudflare/workers/api-proxy/wrangler.toml:1)

Steps:

1) Set the Cloud Run origin:
   - edit `CLOUD_RUN_ORIGIN` in [`cloudflare/workers/api-proxy/wrangler.toml`](../cloudflare/workers/api-proxy/wrangler.toml:1)
2) Deploy the worker:

```bash
cd cloudflare/workers/api-proxy
npx wrangler deploy
```

3) In Cloudflare Dashboard → Workers & Pages → your worker → Routes, add:

- `www.2chanc3s.com/api/*`

Result:

- Requests to `https://www.2chanc3s.com/api/feed` will be forwarded to `https://<cloud-run-origin>/api/feed`.

## 3) Create Cloudflare Pages project for the static site

### Recommended layout

Deploy directory:

- `web/public`

This is a fully static site (no build step required).

### Pages project setup

In Cloudflare Dashboard → Workers & Pages → Pages:

1) Create a new Pages project from this GitHub repo.
2) Build settings:
   - Framework preset: `None`
   - Build command: *(empty)*
   - Output directory: `web/public`

### Attach custom domain `www.2chanc3s.com`

In the Pages project settings:

1) Add Custom Domain: `www.2chanc3s.com`.
2) Cloudflare will prompt DNS changes (usually CNAME).

Because your domain is already on Cloudflare:

- Cloudflare will create/manage the needed DNS record for you.
- Ensure it’s **proxied** (orange cloud) unless Cloudflare instructs DNS-only.

## 4) Verify the deep link verification files

Pages hosts:

- `/.well-known/apple-app-site-association` via [`web/public/.well-known/apple-app-site-association`](../web/public/.well-known/apple-app-site-association:1)
- `/.well-known/assetlinks.json` via [`web/public/.well-known/assetlinks.json`](../web/public/.well-known/assetlinks.json:1)

You must replace placeholders:

- `TEAM_ID.BUNDLE_ID`
- `RELEASE_SHA256_FINGERPRINT_HERE`

Optional but recommended headers are set in [`web/public/_headers`](../web/public/_headers:1).

## 5) Final runtime behavior

- Static UI fetches `/api/*` same-origin, so `API_BASE` can remain empty in [`web/public/app.js`](../web/public/app.js:1).
- Reply links go to:
  - `https://www.2chanc3s.com/reply?username=<u>&messageId=<id>`
  - landing page is [`web/public/reply/index.html`](../web/public/reply/index.html:1)

