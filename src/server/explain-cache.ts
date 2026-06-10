/**
 * Disk cache for POST /api/explain-prompt responses.
 * Default: ./cache/explain under the project root (gitignored).
 */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_CURSOR_MODEL } from './explain-defaults';

const SCHEMA = 'v10';

/** Cache path segment derived from Cursor model env. */
export function buildExplainVariantCacheKey(): string {
  return `cursor:${(process.env.CURSOR_MODEL ?? '').trim() || DEFAULT_CURSOR_MODEL}`;
}

export function explainCacheDirectory(projectRoot: string): string {
  const custom = (process.env.EXPLAIN_CACHE_DIR ?? '').trim();
  return custom.length > 0 ? custom : path.join(projectRoot, 'cache', 'explain');
}

function cacheDisabled(): boolean {
  const v = (process.env.EXPLAIN_CACHE_DISABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** TTL in ms */
export function explainCacheTtlMs(): number {
  const raw = (process.env.EXPLAIN_CACHE_DAYS ?? '').trim();
  const n = Number(raw === '' ? '7' : raw);
  const days = Number.isFinite(n) && n >= 0 ? (n <= 365 ? n : 365) : 7;
  if (days <= 0) return 0;
  return days * 24 * 60 * 60 * 1000;
}

/** True when disk get/set are active (not disabled, TTL > 0) */
export function explainCacheActive(): boolean {
  return !cacheDisabled() && explainCacheTtlMs() > 0;
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
    variantKey: string,
  ) => Promise<{ answer: string } | null>;
  set: (
    slug: string,
    promptId: string,
    contentKey: string,
    variantKey: string,
    answer: string,
  ) => Promise<void>;
};

export function createExplainCache(projectRoot: string): ExplainDiskCache {
  function entryHashFor(
    slug: string,
    promptId: string,
    contentKey: string,
    variantKey: string,
  ): string {
    return crypto
      .createHash('sha256')
      .update(
        `${SCHEMA}:${slug}:${promptId}:${variantKey}:${contentKey}`,
        'utf8',
      )
      .digest('hex');
  }

  function pathsFor(
    slug: string,
    promptId: string,
    contentKey: string,
    variantKey: string,
  ): { path: string } {
    const h = entryHashFor(slug, promptId, contentKey, variantKey);
    const dir = explainCacheDirectory(projectRoot);
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
      if (ttl > 0) {
        const dir = explainCacheDirectory(projectRoot);
        await ensureDir(dir);
        await prune(dir, ttl);
      }
      if (explainCacheDebug()) {
        console.log(
          '[explain-cache] primed',
          explainCacheDirectory(projectRoot),
          'ttl_days',
          ttl > 0 ? ttl / (24 * 60 * 60 * 1000) : 0,
        );
      }
    },

    async get(
      slug: string,
      promptId: string,
      contentKey: string,
      variantKey: string,
    ): Promise<{ answer: string } | null> {
      if (cacheDisabled()) {
        if (explainCacheDebug())
          console.log('[explain-cache] get skip (disabled)');
        return null;
      }

      const ttl = explainCacheTtlMs();
      if (ttl <= 0) {
        if (explainCacheDebug())
          console.log(
            '[explain-cache] disk get skip (EXPLAIN_CACHE_DAYS is 0 or invalid)',
          );
        return null;
      }
      const { path: fp } = pathsFor(slug, promptId, contentKey, variantKey);
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
      variantKey: string,
      answer: string,
    ): Promise<void> {
      if (cacheDisabled()) return;

      const ttl = explainCacheTtlMs();
      if (ttl <= 0) return;
      const { path: fp } = pathsFor(slug, promptId, contentKey, variantKey);
      const dir = path.dirname(fp);
      await ensureDir(dir);
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
