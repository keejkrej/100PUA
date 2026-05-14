/**
 * Disk cache for POST /explain-prompt responses (JSON per entry).
 *
 * Default: `./cache/explain` under the API folder (gitignored).
 * Hosted platforms often set EXPLAIN_CACHE_DIR to a Persistent Disk mount
 * (e.g. `/var/data/explain-cache`).
 */
import 'dotenv/config';

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const SCHEMA = 'v4';

export function explainCacheDirectory(apiRoot: string): string {
  const custom = (process.env.EXPLAIN_CACHE_DIR ?? '').trim();
  return custom.length > 0 ? custom : path.join(apiRoot, 'cache', 'explain');
}

function cacheDisabled(): boolean {
  const v = (process.env.EXPLAIN_CACHE_DISABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** TTL in ms */
export function explainCacheTtlMs(): number {
  const raw = (process.env.EXPLAIN_CACHE_DAYS ?? '').trim();
  // Render/dashboard often saves an env var as "" — Number("") is 0 and would kill caching.
  const n = Number(raw === '' ? '7' : raw);
  const days =
    Number.isFinite(n) && n >= 0 ? (n <= 365 ? n : 365) : 7;
  if (days <= 0) return 0;
  return days * 24 * 60 * 60 * 1000;
}

/** True when disk get/set are active (not disabled, TTL > 0) */
export function explainCacheActive(): boolean {
  return !cacheDisabled() && explainCacheTtlMs() > 0;
}

/** Include model key so CACHE stays correct when CLAUDE_MODEL env changes. */
function modelCacheKeyPart(): string {
  return (process.env.CLAUDE_MODEL ?? '').trim();
}

function explainCacheDebug(): boolean {
  return (process.env.EXPLAIN_CACHE_DEBUG ?? '').trim() === '1';
}

type CacheEntryJson = {
  answer?: unknown;
  cachedAt?: unknown;
  promptHash?: unknown;
};

export type ExplainDiskCache = {
  prime: () => Promise<void>;
  get: (
    slug: string,
    promptId: string,
    contentKey: string,
  ) => Promise<{ answer: string } | null>;
  set: (
    slug: string,
    promptId: string,
    contentKey: string,
    answer: string,
  ) => Promise<void>;
};

export function createExplainCache(apiRoot: string): ExplainDiskCache {
  function pathsFor(slug: string, promptId: string, contentKey: string): {
    path: string;
  } {
    const h = crypto
      .createHash('sha256')
      .update(
        `${SCHEMA}:${slug}:${promptId}:${modelCacheKeyPart()}:${contentKey}`,
        'utf8',
      )
      .digest('hex');
    const dir = explainCacheDirectory(apiRoot);
    return { path: path.join(dir, `${h}.json`) };
  }

  async function ensureDir(dir: string): Promise<void> {
    await fsp.mkdir(dir, { recursive: true }).catch(() => {});
  }

  async function prune(dir: string, ttl: number): Promise<void> {
    if (ttl <= 0) return;
    const entries =
      await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    const now = Date.now();
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      const fp = path.join(dir, e.name);
      try {
        const raw = await fsp.readFile(fp, 'utf8');
        const obj = JSON.parse(raw) as CacheEntryJson;
        const t =
          typeof obj.cachedAt === 'number'
            ? obj.cachedAt
            : typeof obj.cachedAt === 'string'
              ? Number.parseInt(String(obj.cachedAt), 10)
              : NaN;
        if (Number.isFinite(t) && now - t >= ttl)
          await fsp.unlink(fp).catch(() => {});
      } catch {
        await fsp.unlink(fp).catch(() => {});
      }
    }
  }

  return {
    async prime(): Promise<void> {
      if (cacheDisabled()) return;
      const ttl = explainCacheTtlMs();
      if (ttl <= 0) return;
      const dir = explainCacheDirectory(apiRoot);
      await ensureDir(dir);
      await prune(dir, ttl);
      if (explainCacheDebug()) {
        console.log(
          '[explain-cache] primed',
          dir,
          'ttl_days',
          ttl / (24 * 60 * 60 * 1000),
        );
      }
    },

    async get(
      slug: string,
      promptId: string,
      contentKey: string,
    ): Promise<{ answer: string } | null> {
      if (cacheDisabled()) {
        if (explainCacheDebug())
          console.log('[explain-cache] get skip (disabled)');
        return null;
      }
      const ttl = explainCacheTtlMs();
      if (ttl <= 0) {
        if (explainCacheDebug())
          console.log('[explain-cache] get skip (EXPLAIN_CACHE_DAYS is 0 or invalid)');
        return null;
      }
      const { path: fp } = pathsFor(slug, promptId, contentKey);
      try {
        const raw = await fsp.readFile(fp, 'utf8');
        const j = JSON.parse(raw) as CacheEntryJson;
        if (typeof j.promptHash === 'string' && j.promptHash !== contentKey) {
          if (explainCacheDebug())
            console.log('[explain-cache] reject stale promptHash', fp);
          await fsp.unlink(fp).catch(() => {});
          return null;
        }
        if (typeof j.answer !== 'string' || !j.answer.trim()) return null;
        const t =
          typeof j.cachedAt === 'number'
            ? j.cachedAt
            : typeof j.cachedAt === 'string'
              ? Number.parseInt(String(j.cachedAt), 10)
              : NaN;
        if (!Number.isFinite(t) || Date.now() - t >= ttl) {
          if (explainCacheDebug())
            console.log('[explain-cache] miss expired', fp);
          await fsp.unlink(fp).catch(() => {});
          return null;
        }
        if (explainCacheDebug()) console.log('[explain-cache] HIT', fp);
        return { answer: j.answer };
      } catch (e: unknown) {
        const err = e as { code?: string };
        if (err?.code !== 'ENOENT' && explainCacheDebug())
          console.log('[explain-cache] read error', fp, e);
        return null;
      }
    },

    async set(
      slug: string,
      promptId: string,
      contentKey: string,
      answer: string,
    ): Promise<void> {
      if (cacheDisabled()) return;
      const ttl = explainCacheTtlMs();
      if (ttl <= 0) return;
      const { path: fp } = pathsFor(slug, promptId, contentKey);
      const dir = path.dirname(fp);
      await ensureDir(dir);
      const body = Buffer.from(
        JSON.stringify({
          schema: SCHEMA,
          slug,
          promptId,
          promptHash: contentKey,
          modelKey: modelCacheKeyPart(),
          cachedAt: Date.now(),
          answer,
        }),
        'utf8',
      );
      const tmp = path.join(dir, `.tmp.${process.pid}.${Date.now()}.json`);
      try {
        await fsp.writeFile(tmp, body);
        await fsp.rename(tmp, fp);
        if (explainCacheDebug()) console.log('[explain-cache] STORE', fp);
      } catch (e) {
        console.error('[explain-cache] write failed', fp, e);
        await fsp.unlink(tmp).catch(() => {});
      }
    },
  };
}
