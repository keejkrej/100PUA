import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { Context, Effect, Layer } from "effect";

import { AppConfig } from "./config";
import { ProjectRoot } from "./project-root";

const SCHEMA = "v10";

export type ExplainDiskCache = {
  prime: () => Effect.Effect<void>;
  get: (
    slug: string,
    promptId: string,
    contentKey: string,
    variantKey: string,
  ) => Effect.Effect<{ answer: string } | null>;
  set: (
    slug: string,
    promptId: string,
    contentKey: string,
    variantKey: string,
    answer: string,
  ) => Effect.Effect<void>;
};

export class ExplainCacheService extends Context.Tag("@100pua/ExplainCacheService")<
  ExplainCacheService,
  ExplainDiskCache
>() {
  static readonly Live = Layer.effect(
    ExplainCacheService,
    Effect.gen(function* () {
      const root = yield* ProjectRoot;
      const config = yield* AppConfig;
      return createExplainCache(root, config);
    }),
  );
}

function explainCacheDirectory(projectRoot: string, customDir: string): string {
  return customDir.length > 0 ? customDir : path.join(projectRoot, "cache", "explain");
}

function explainCacheTtlMs(days: number, disabled: boolean): number {
  if (disabled || days <= 0) return 0;
  return days * 24 * 60 * 60 * 1000;
}

export function explainCacheActive(config: Context.Tag.Service<typeof AppConfig>): boolean {
  return (
    !config.explainCacheDisabled &&
    explainCacheTtlMs(config.explainCacheDays, config.explainCacheDisabled) > 0
  );
}

export function explainCacheActiveFromEnv(): boolean {
  const cacheDisabledRaw = (process.env.EXPLAIN_CACHE_DISABLED ?? "").trim().toLowerCase();
  const disabled =
    cacheDisabledRaw === "1" || cacheDisabledRaw === "true" || cacheDisabledRaw === "yes";
  const rawDays = (process.env.EXPLAIN_CACHE_DAYS ?? "").trim();
  const daysNum = Number(rawDays === "" ? "7" : rawDays);
  const days = Number.isFinite(daysNum) && daysNum >= 0 ? (daysNum <= 365 ? daysNum : 365) : 7;
  return !disabled && explainCacheTtlMs(days, disabled) > 0;
}

export function createExplainCacheFromEnv(projectRoot: string): ExplainDiskCache {
  const cacheDisabledRaw = (process.env.EXPLAIN_CACHE_DISABLED ?? "").trim().toLowerCase();
  const explainCacheDisabled =
    cacheDisabledRaw === "1" || cacheDisabledRaw === "true" || cacheDisabledRaw === "yes";
  const rawDays = (process.env.EXPLAIN_CACHE_DAYS ?? "").trim();
  const daysNum = Number(rawDays === "" ? "7" : rawDays);
  const explainCacheDays =
    Number.isFinite(daysNum) && daysNum >= 0 ? (daysNum <= 365 ? daysNum : 365) : 7;
  const explainCacheDir = (process.env.EXPLAIN_CACHE_DIR ?? "").trim();
  const explainCacheDebug = (process.env.EXPLAIN_CACHE_DEBUG ?? "").trim() === "1";

  return createExplainCache(projectRoot, {
    explainCacheDisabled,
    explainCacheDays,
    explainCacheDir,
    explainCacheDebug,
  } as Context.Tag.Service<typeof AppConfig>);
}

function createExplainCache(
  projectRoot: string,
  config: Context.Tag.Service<typeof AppConfig>,
): ExplainDiskCache {
  const ttl = explainCacheTtlMs(config.explainCacheDays, config.explainCacheDisabled);
  const disabled = config.explainCacheDisabled;
  const debug = config.explainCacheDebug;
  const dir = explainCacheDirectory(projectRoot, config.explainCacheDir);

  function entryHashFor(
    slug: string,
    promptId: string,
    contentKey: string,
    variantKey: string,
  ): string {
    return crypto
      .createHash("sha256")
      .update(`${SCHEMA}:${slug}:${promptId}:${variantKey}:${contentKey}`, "utf8")
      .digest("hex");
  }

  function pathsFor(
    slug: string,
    promptId: string,
    contentKey: string,
    variantKey: string,
  ): { path: string } {
    const h = entryHashFor(slug, promptId, contentKey, variantKey);
    return { path: path.join(dir, `${h}.json`) };
  }

  async function ensureDir(d: string): Promise<void> {
    await fsp.mkdir(d, { recursive: true }).catch(() => {});
  }

  async function prune(d: string, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) return;
    const entries = await fsp.readdir(d, { withFileTypes: true }).catch(() => []);
    const now = Date.now();
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".json")) continue;
      const fp = path.join(d, e.name);
      try {
        const raw = await fsp.readFile(fp, "utf8");
        const obj = JSON.parse(raw) as {
          cachedAt?: unknown;
        };
        const t =
          typeof obj.cachedAt === "number"
            ? obj.cachedAt
            : typeof obj.cachedAt === "string"
              ? Number.parseInt(String(obj.cachedAt), 10)
              : NaN;
        if (Number.isFinite(t) && now - t >= ttlMs) await fsp.unlink(fp).catch(() => {});
      } catch {
        await fsp.unlink(fp).catch(() => {});
      }
    }
  }

  return {
    prime: () =>
      Effect.promise(async () => {
        if (disabled) return;
        if (ttl > 0) {
          await ensureDir(dir);
          await prune(dir, ttl);
        }
        if (debug) {
          console.log(
            "[explain-cache] primed",
            dir,
            "ttl_days",
            ttl > 0 ? ttl / (24 * 60 * 60 * 1000) : 0,
          );
        }
      }),

    get: (slug, promptId, contentKey, variantKey) =>
      Effect.promise(async () => {
        if (disabled) {
          if (debug) console.log("[explain-cache] get skip (disabled)");
          return null;
        }
        if (ttl <= 0) {
          if (debug)
            console.log("[explain-cache] disk get skip (EXPLAIN_CACHE_DAYS is 0 or invalid)");
          return null;
        }
        const { path: fp } = pathsFor(slug, promptId, contentKey, variantKey);
        try {
          const raw = await fsp.readFile(fp, "utf8");
          const j = JSON.parse(raw) as {
            promptHash?: unknown;
            answer?: unknown;
            cachedAt?: unknown;
          };
          if (typeof j.promptHash === "string" && j.promptHash !== contentKey) {
            if (debug) console.log("[explain-cache] reject stale promptHash", fp);
            await fsp.unlink(fp).catch(() => {});
            return null;
          }
          if (typeof j.answer !== "string" || !j.answer.trim()) return null;
          const t =
            typeof j.cachedAt === "number"
              ? j.cachedAt
              : typeof j.cachedAt === "string"
                ? Number.parseInt(String(j.cachedAt), 10)
                : NaN;
          if (!Number.isFinite(t) || Date.now() - t >= ttl) {
            if (debug) console.log("[explain-cache] miss expired", fp);
            await fsp.unlink(fp).catch(() => {});
            return null;
          }
          if (debug) console.log("[explain-cache] HIT", fp);
          return { answer: j.answer };
        } catch (e: unknown) {
          const err = e as { code?: string };
          if (err?.code !== "ENOENT" && debug) console.log("[explain-cache] read error", fp, e);
          return null;
        }
      }),

    set: (slug, promptId, contentKey, variantKey, answer) =>
      Effect.promise(async () => {
        if (disabled || ttl <= 0) return;
        const { path: fp } = pathsFor(slug, promptId, contentKey, variantKey);
        const cacheDir = path.dirname(fp);
        await ensureDir(cacheDir);
        const body = Buffer.from(
          JSON.stringify({
            schema: SCHEMA,
            slug,
            promptId,
            promptHash: contentKey,
            variantKey,
            cachedAt: Date.now(),
            answer,
          }),
          "utf8",
        );
        const tmp = path.join(cacheDir, `.tmp.${process.pid}.${Date.now()}.json`);
        try {
          await fsp.writeFile(tmp, body);
          await fsp.rename(tmp, fp);
          if (debug) console.log("[explain-cache] STORE", fp);
        } catch (e) {
          console.error("[explain-cache] write failed", fp, e);
          await fsp.unlink(tmp).catch(() => {});
        }
      }),
  };
}
