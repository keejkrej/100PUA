import { Context, Effect, Layer } from "effect";

import { AppConfig } from "./config";

export class RateLimitService extends Context.Tag("@100pua/RateLimitService")<
  RateLimitService,
  {
    allowExplain: (ip: string) => Effect.Effect<boolean>;
    allowSuggest: (ip: string) => Effect.Effect<boolean>;
  }
>() {
  static readonly Live = Layer.effect(
    RateLimitService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const explainBuckets = new Map<string, number[]>();
      const suggestBuckets = new Map<string, number[]>();

      return {
        allowExplain: (ip) =>
          Effect.sync(() =>
            allowRate(ip, explainBuckets, config.explainRateLimit, config.explainRateWindowMs),
          ),
        allowSuggest: (ip) =>
          Effect.sync(() =>
            allowRate(ip, suggestBuckets, config.suggestRateLimit, config.suggestRateWindowMs),
          ),
      };
    }),
  );
}

function allowRate(
  ip: string,
  buckets: Map<string, number[]>,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const prev = buckets.get(ip) ?? [];
  const next = prev.filter((t) => now - t < windowMs);
  if (next.length >= limit) return false;
  next.push(now);
  buckets.set(ip, next);
  return true;
}

export function clientIp(xForwardedFor: string | null): string {
  if (typeof xForwardedFor === "string" && xForwardedFor.length > 0) {
    const first = xForwardedFor.split(",")[0];
    return first ? first.trim() : "unknown";
  }
  return "unknown";
}
