# 2chanc3s Cloud Run API (Express + TypeScript)

Implements read-only APIs for the public Cloudflare Pages site:

- `GET /api/feed`
- `GET /api/search`

It reads from Firestore `posts` as documented in [`../post.md`](../post.md:1) and skips posts missing `username`.

## Local dev

From repo root:

```bash
cd api
npm i
npm run dev
```

Auth:

- Prefer `gcloud auth application-default login`.
- Or set `GOOGLE_APPLICATION_CREDENTIALS`.

## Deploy (Cloud Run)

Build container however you prefer (Dockerfile not included yet). The process entry is `npm run start`.

