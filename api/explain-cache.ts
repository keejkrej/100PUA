/**
 * Cache for POST /explain-prompt responses.
 *
 * Optional hot tier: Render Key Value / Redis-compatible URL via EXPLAIN_KV_URL.
 * Durable fallback: JSON files on disk. Default: `./cache/explain` under the API folder (gitignored).
 * Hosted platforms often set EXPLAIN_CACHE_DIR to a Persistent Disk mount
 * (e.g. `/var/data/explain-cache`).
 */
import 'dotenv/config';

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { createClient } from 'redis';

import { DEFAULT_CURSOR_MODEL } from './explain-defaults.js';

const SCHEMA = 'v10';
const DEFAULT_KV_TTL_SECONDS = 24 * 60 * 60;

export type ExplainProvider = 'cursor';

/** Cache path segment derived from Cursor model env. */
export function buildExplainVariantCacheKey(): string {
  return `cursor:${(process.env.CURSOR_MODEL ?? '').trim() || DEFAULT_CURSOR_MODEL}`;
}

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
  return (
    !cacheDisabled() &&
    (explainCacheTtlMs() > 0 || explainKvConfiguredActive())
  );
}

function explainCacheDebug(): boolean {
  return (process.env.EXPLAIN_CACHE_DEBUG ?? '').trim() === '1';
}

function explainKvUrl(): string {
  return (
    (process.env.EXPLAIN_KV_URL ?? '').trim() ||
    (process.env.RENDER_KV_URL ?? '').trim() ||
    (process.env.REDIS_URL ?? '').trim() ||
    (process.env.KV_URL ?? '').trim()
  );
}

/** TTL in seconds. `0` disables the KV hot cache without disabling disk cache. */
function explainKvTtlSeconds(): number {
  const raw = (process.env.EXPLAIN_KV_CACHE_SECONDS ?? '').trim();
  if (raw === '') return DEFAULT_KV_TTL_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_KV_TTL_SECONDS;
  if (n <= 0) return 0;
  return Math.min(Math.floor(n), 365 * 24 * 60 * 60);
}

function explainKvConfiguredActive(): boolean {
  return explainKvUrl().length > 0 && explainKvTtlSeconds() > 0;
}

function explainKvPrefix(): string {
  const raw = (process.env.EXPLAIN_KV_PREFIX ?? '').trim();
  return raw || '100pua';
}

type RedisClient = ReturnType<typeof createClient>;

let explainKvClient: RedisClient | null = null;
let explainKvConnecting: Promise<RedisClient | null> | null = null;
let explainKvBackoffUntil = 0;

async function getExplainKvClient(): Promise<RedisClient | null> {
  if (cacheDisabled() || !explainKvConfiguredActive()) return null;
  if (explainKvClient?.isOpen) return explainKvClient;
  if (Date.now() < explainKvBackoffUntil) return null;
  if (explainKvConnecting) return explainKvConnecting;

  const url = explainKvUrl();
  const client = createClient({
    url,
    socket: {
      connectTimeout: 3_000,
      reconnectStrategy: false,
    },
  });

  client.on('error', (e) => {
    if (explainCacheDebug()) console.warn('[explain-cache] kv error', e);
  });
  client.on('end', () => {
    if (explainKvClient === client) explainKvClient = null;
  });

  explainKvConnecting = client
    .connect()
    .then(() => {
      explainKvClient = client;
      if (explainCacheDebug()) console.log('[explain-cache] kv connected');
      return client;
    })
    .catch((e) => {
      explainKvBackoffUntil = Date.now() + 60_000;
      if (explainCacheDebug()) console.warn('[explain-cache] kv connect failed', e);
      client.destroy();
      return null;
    })
    .finally(() => {
      explainKvConnecting = null;
    });

  return explainKvConnecting;
}

type CacheEntryJson = {
  answer?: unknown;
  cachedAt?: unknown;
  promptHash?: unknown;
};

export type ExplainDiskCache = {
  prime: () => Promise<void>;
  close: () => Promise<void>;
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

export function createExplainCache(apiRoot: string): ExplainDiskCache {
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
  ): {
    path: string;
  } {
    const h = entryHashFor(slug, promptId, contentKey, variantKey);
    const dir = explainCacheDirectory(apiRoot);
    return { path: path.join(dir, `${h}.json`) };
  }

  function kvKeyFor(
    slug: string,
    promptId: string,
    contentKey: string,
    variantKey: string,
  ): string {
    const h = entryHashFor(slug, promptId, contentKey, variantKey);
    return `${explainKvPrefix()}:explain:${SCHEMA}:${h}`;
  }

  async function kvGet(
    slug: string,
    promptId: string,
    contentKey: string,
    variantKey: string,
  ): Promise<{ answer: string } | null> {
    const client = await getExplainKvClient();
    if (!client) return null;
    const key = kvKeyFor(slug, promptId, contentKey, variantKey);
    try {
      const raw = await client.get(key);
      if (!raw) return null;
      const j = JSON.parse(raw) as CacheEntryJson;
      if (typeof j.promptHash === 'string' && j.promptHash !== contentKey) {
        await client.del(key).catch(() => {});
        return null;
      }
      if (typeof j.answer !== 'string' || !j.answer.trim()) return null;
      if (explainCacheDebug()) console.log('[explain-cache] KV HIT', key);
      return { answer: j.answer };
    } catch (e) {
      if (explainCacheDebug()) console.warn('[explain-cache] kv read failed', key, e);
      return null;
    }
  }

  async function kvSet(
    slug: string,
    promptId: string,
    contentKey: string,
    variantKey: string,
    answer: string,
  ): Promise<void> {
    const client = await getExplainKvClient();
    if (!client) return;
    const ttl = explainKvTtlSeconds();
    if (ttl <= 0) return;
    const key = kvKeyFor(slug, promptId, contentKey, variantKey);
    try {
      await client.set(
        key,
        JSON.stringify({
          schema: SCHEMA,
          slug,
          promptId,
          promptHash: contentKey,
          variantKey,
          cachedAt: Date.now(),
          answer,
        }),
        { EX: ttl },
      );
      if (explainCacheDebug()) console.log('[explain-cache] KV STORE', key);
    } catch (e) {
      if (explainCacheDebug()) console.warn('[explain-cache] kv write failed', key, e);
    }
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
        const dir = explainCacheDirectory(apiRoot);
        await ensureDir(dir);
        await prune(dir, ttl);
      }
      await getExplainKvClient();
      if (explainCacheDebug()) {
        console.log(
          '[explain-cache] primed',
          explainCacheDirectory(apiRoot),
          'ttl_days',
          ttl > 0 ? ttl / (24 * 60 * 60 * 1000) : 0,
          'kv',
          explainKvConfiguredActive() ? 'enabled' : 'disabled',
        );
      }
    },

    async close(): Promise<void> {
      if (!explainKvClient) return;
      const client = explainKvClient;
      explainKvClient = null;
      if (client.isOpen) await client.quit().catch(() => client.destroy());
      else client.destroy();
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

      const kvHit = await kvGet(slug, promptId, contentKey, variantKey);
      if (kvHit) return kvHit;

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
        await kvSet(slug, promptId, contentKey, variantKey, j.answer);
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
      await kvSet(slug, promptId, contentKey, variantKey, answer);

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
