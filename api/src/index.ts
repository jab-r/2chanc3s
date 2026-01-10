import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { getConfig } from "./config.js";
import { buildFeedRouter } from "./routes/feed.js";
import { buildSearchRouter } from "./routes/search.js";

const config = getConfig();

const app = express();

// Trust the first proxy (Cloud Run load balancer) for X-Forwarded-For headers
app.set("trust proxy", 1);

app.disable("x-powered-by");

app.use(
  helmet({
    // Cloud Run behind proxy/CDN is common; adjust if needed.
    contentSecurityPolicy: false
  })
);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);

      if (config.corsAllowAnyLocalhost) {
        if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
          return cb(null, true);
        }
      }

      if (config.corsAllowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("CORS blocked"));
    },
    methods: ["GET", "OPTIONS"],
    maxAge: 600
  })
);

app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/", (_req, res) => res.status(200).send("2chanc3s api"));

app.use("/api", buildFeedRouter());
app.use("/api", buildSearchRouter());

// Error handler
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "unknown error";
  return res.status(500).json({ error: { code: "internal_error", message } });
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`listening on :${config.port}`);
});

