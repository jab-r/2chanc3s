export type ApiConfig = {
  port: number;
  corsAllowedOrigins: string[];
  corsAllowAnyLocalhost: boolean;
  feedDefaultLimit: number;
  feedMaxLimit: number;
  searchMaxScan: number;
};

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function getConfig(): ApiConfig {
  const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "https://www.2chanc3s.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    port: parseIntEnv("PORT", 8080),
    corsAllowedOrigins,
    corsAllowAnyLocalhost: (process.env.CORS_ALLOW_LOCALHOST || "true").toLowerCase() === "true",
    feedDefaultLimit: parseIntEnv("FEED_DEFAULT_LIMIT", 50),
    feedMaxLimit: parseIntEnv("FEED_MAX_LIMIT", 100),
    searchMaxScan: parseIntEnv("SEARCH_MAX_SCAN", 500)
  };
}

