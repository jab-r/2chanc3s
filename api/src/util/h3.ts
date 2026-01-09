import { isValidCell } from "h3-js";

export function parseH3List(param: unknown, max: number): string[] {
  if (typeof param !== "string" || param.trim() === "") return [];
  const tokens = param
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const t of tokens) {
    if (!isValidCell(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

