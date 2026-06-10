import { Context, Effect, Layer } from 'effect';

import {
  DEFAULT_CURSOR_MODEL,
  DEFAULT_EXPLAIN_AGENT_TIMEOUT_MS,
} from './constants.js';

export class AppConfig extends Context.Tag('@100pua/AppConfig')<
  AppConfig,
  {
    readonly cursorApiKey: string;
    readonly cursorModel: string;
    readonly explainTimeoutMs: number;
    readonly explainRateLimit: number;
    readonly explainRateWindowMs: number;
    readonly suggestRateLimit: number;
    readonly suggestRateWindowMs: number;
    readonly githubRepo: string;
    readonly githubToken: string;
    readonly explainCacheDisabled: boolean;
    readonly explainCacheDays: number;
    readonly explainCacheDir: string;
    readonly explainCacheDebug: boolean;
  }
>() {
  static readonly Live = Layer.sync(AppConfig, () => {
    const explainRateLimit = Number.isFinite(Number(process.env.EXPLAIN_RATE_LIMIT))
      ? Math.max(3, Number(process.env.EXPLAIN_RATE_LIMIT))
      : 12;
    const explainRateWindowMs = Number.isFinite(
      Number(process.env.EXPLAIN_RATE_WINDOW_MS),
    )
      ? Math.max(60_000, Number(process.env.EXPLAIN_RATE_WINDOW_MS))
      : 15 * 60 * 1000;
    const suggestRateLimit = Number.isFinite(
      Number(process.env.SUGGEST_RATE_LIMIT),
    )
      ? Math.max(5, Number(process.env.SUGGEST_RATE_LIMIT))
      : 20;
    const suggestRateWindowMs = Number.isFinite(
      Number(process.env.SUGGEST_RATE_WINDOW_MS),
    )
      ? Math.max(60_000, Number(process.env.SUGGEST_RATE_WINDOW_MS))
      : 15 * 60 * 1000;
    const rawTimeout = (process.env.EXPLAIN_TIMEOUT_MS ?? '').trim();
    const explainTimeoutMs = Number.isFinite(Number(rawTimeout))
      ? Math.max(45_000, Number(rawTimeout))
      : DEFAULT_EXPLAIN_AGENT_TIMEOUT_MS;
    const cacheDisabledRaw = (process.env.EXPLAIN_CACHE_DISABLED ?? '')
      .trim()
      .toLowerCase();
    const explainCacheDisabled =
      cacheDisabledRaw === '1' ||
      cacheDisabledRaw === 'true' ||
      cacheDisabledRaw === 'yes';
    const rawDays = (process.env.EXPLAIN_CACHE_DAYS ?? '').trim();
    const daysNum = Number(rawDays === '' ? '7' : rawDays);
    const explainCacheDays =
      Number.isFinite(daysNum) && daysNum >= 0
        ? daysNum <= 365
          ? daysNum
          : 365
        : 7;

    return {
      cursorApiKey: (process.env.CURSOR_API_KEY ?? '').trim(),
      cursorModel: (process.env.CURSOR_MODEL ?? '').trim() || DEFAULT_CURSOR_MODEL,
      explainTimeoutMs,
      explainRateLimit,
      explainRateWindowMs,
      suggestRateLimit,
      suggestRateWindowMs,
      githubRepo: (process.env.GITHUB_REPO || 'keejkrej/100PUA').trim(),
      githubToken: (process.env.GITHUB_TOKEN || '').trim(),
      explainCacheDisabled,
      explainCacheDays,
      explainCacheDir: (process.env.EXPLAIN_CACHE_DIR ?? '').trim(),
      explainCacheDebug: (process.env.EXPLAIN_CACHE_DEBUG ?? '').trim() === '1',
    };
  });

  static readonly explainEnabled = Effect.map(
    AppConfig,
    (config) => Boolean(config.cursorApiKey),
  );

  static readonly suggestionsEnabled = Effect.map(AppConfig, (config) => {
    const parts = config.githubRepo.split('/').filter(Boolean);
    return (
      Boolean(config.githubToken) &&
      parts.length === 2 &&
      !config.githubRepo.includes('..')
    );
  });
}
