import { Effect } from 'effect';

import { AppConfig } from './config';
import {
  ExplainFailed,
  MisconfiguredServer,
  RateLimitExceeded,
  UnknownPrompt,
} from './errors';
import { ExplainAgentService } from './explain-agent';
import { explainCacheActive, ExplainCacheService } from './explain-cache';
import {
  buildExplainVariantCacheKey,
  buildFullExplainPrompt,
  explainContentKey,
  PromptIndexService,
} from './prompt-index';
import { RateLimitService } from './rate-limit';
import type { ExplainPromptRequest, ExplainPromptSuccess } from './schemas';

const inFlightExplains = new Map<
  string,
  Promise<{ ok: true; text: string } | { ok: false; error: string }>
>();

export type ExplainResult = ExplainPromptSuccess & {
  cacheHeader: 'hit' | 'miss' | 'disabled';
};

export const explainPrompt = (
  payload: ExplainPromptRequest,
  ip: string,
): Effect.Effect<
  ExplainResult,
  | MisconfiguredServer
  | UnknownPrompt
  | RateLimitExceeded
  | ExplainFailed
  | MisconfiguredServer,
  | AppConfig
  | PromptIndexService
  | ExplainCacheService
  | ExplainAgentService
  | RateLimitService
> =>
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const index = yield* PromptIndexService;
    const cache = yield* ExplainCacheService;
    const agent = yield* ExplainAgentService;
    const rateLimit = yield* RateLimitService;

    if (!index || Object.keys(index).length === 0) {
      return yield* Effect.fail(
        new MisconfiguredServer({
          error: 'misconfigured_server',
          message: 'Run `bun run build` (prompt-index.json).',
        }),
      );
    }

    if (!config.cursorApiKey) {
      return yield* Effect.fail(
        new MisconfiguredServer({
          error: 'misconfigured_server',
          message: 'Set CURSOR_API_KEY on the server.',
        }),
      );
    }

    const variantKey = buildExplainVariantCacheKey(config.cursorModel);
    const row = index[payload.slug]?.[payload.promptId];
    const chatQuery = row?.chatQuery;
    if (!row || typeof chatQuery !== 'string' || !chatQuery.trim()) {
      return yield* Effect.fail(new UnknownPrompt({ error: 'unknown_prompt' }));
    }

    const contentKey = explainContentKey(chatQuery);
    const cachedHit = yield* cache.get(
      payload.slug,
      payload.promptId,
      contentKey,
      variantKey,
    );

    if (cachedHit) {
      return {
        answer: cachedHit.answer,
        cached: true,
        cacheHeader: 'hit' as const,
      };
    }

    const allowed = yield* rateLimit.allowExplain(ip);
    if (!allowed) {
      return yield* Effect.fail(new RateLimitExceeded({ error: 'rate_limit' }));
    }

    const fullPromptText = buildFullExplainPrompt(row);
    const brokerKey = `${payload.slug}:${payload.promptId}:${contentKey}:${variantKey}`;
    let brokerPromise = inFlightExplains.get(brokerKey);

    if (!brokerPromise) {
      const abortController = new AbortController();
      const timeoutId = setTimeout(
        () => abortController.abort(),
        config.explainTimeoutMs,
      );

      brokerPromise = Effect.runPromise(
        agent.run(fullPromptText, abortController).pipe(
          Effect.tap((out) =>
            out.ok
              ? cache
                  .set(
                    payload.slug,
                    payload.promptId,
                    contentKey,
                    variantKey,
                    out.text,
                  )
                  .pipe(
                    Effect.catchAll((e) =>
                      Effect.sync(() => console.error('[explain-cache]', e)),
                    ),
                  )
              : Effect.void,
          ),
          Effect.ensuring(
            Effect.sync(() => {
              clearTimeout(timeoutId);
              inFlightExplains.delete(brokerKey);
            }),
          ),
        ),
      );
      inFlightExplains.set(brokerKey, brokerPromise);
    }

    const out = yield* Effect.tryPromise({
      try: () => brokerPromise!,
      catch: (e) =>
        new ExplainFailed({
          error: 'explain_failed',
          message: e instanceof Error ? e.message : 'unexpected_server_error',
        }),
    });

    if (!out.ok) {
      const clientMsg =
        out.error === 'timeout_or_aborted'
          ? 'Timed out waiting for the model — try again.'
          : typeof out.error === 'string'
            ? out.error
            : 'generation_failed';
      return yield* Effect.fail(
        new ExplainFailed({ error: 'explain_failed', message: clientMsg }),
      );
    }

    return {
      answer: out.text,
      cached: false,
      cacheHeader: explainCacheActive(config) ? ('miss' as const) : ('disabled' as const),
    };
  });

export const primeExplainCache = Effect.gen(function* () {
  const cache = yield* ExplainCacheService;
  yield* cache.prime();
});
