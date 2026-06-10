import {
  buildExplainVariantCacheKey,
  createExplainCache,
  explainCacheActive,
} from './explain-cache';
import {
  buildFullExplainPrompt,
  explainAgentConfigured,
  explainAgentMisconfiguredMessage,
  explainAgentTimeoutMs,
  explainContentKey,
  loadPromptIndex,
  runExplanation,
  type ExplainRunResult,
} from './explain-runner';
import { projectRoot } from './project-root';

const EXPLAIN_RATE_LIMIT = Number.isFinite(Number(process.env.EXPLAIN_RATE_LIMIT))
  ? Math.max(3, Number(process.env.EXPLAIN_RATE_LIMIT))
  : 12;
const EXPLAIN_RATE_WINDOW_MS = Number.isFinite(
  Number(process.env.EXPLAIN_RATE_WINDOW_MS),
)
  ? Math.max(60_000, Number(process.env.EXPLAIN_RATE_WINDOW_MS))
  : 15 * 60 * 1000;

const MAX_EXPLAIN_JSON_BYTES = 16_384;
const LEN = { topicSlug: 200 } as const;

const explainRateBuckets = new Map<string, number[]>();
const inFlightExplains = new Map<string, Promise<ExplainRunResult>>();

let explainCache: ReturnType<typeof createExplainCache> | null = null;
let promptIndex: ReturnType<typeof loadPromptIndex> | undefined;

function getExplainCache() {
  if (!explainCache) explainCache = createExplainCache(projectRoot());
  return explainCache;
}

function getPromptIndex() {
  if (promptIndex === undefined) promptIndex = loadPromptIndex(projectRoot());
  return promptIndex;
}

function clientIp(xForwardedFor: string | null): string {
  if (typeof xForwardedFor === 'string' && xForwardedFor.length > 0) {
    const first = xForwardedFor.split(',')[0];
    return first ? first.trim() : 'unknown';
  }
  return 'unknown';
}

function allowExplainRate(ip: string): boolean {
  const now = Date.now();
  const prev = explainRateBuckets.get(ip) ?? [];
  const next = prev.filter((t) => now - t < EXPLAIN_RATE_WINDOW_MS);
  if (next.length >= EXPLAIN_RATE_LIMIT) return false;
  next.push(now);
  explainRateBuckets.set(ip, next);
  return true;
}

export function primeExplainCache(): void {
  void getExplainCache().prime();
}

export async function handleExplainPromptRequest(
  rawBody: string,
  forwardedFor: string | null,
): Promise<Response> {
  const index = getPromptIndex();
  if (!index || Object.keys(index).length === 0) {
    return Response.json(
      {
        error: 'misconfigured_server',
        message: 'Run `npm run build` (prompt-index.json).',
      },
      { status: 503 },
    );
  }

  let payload: unknown = null;
  try {
    if (rawBody.length > MAX_EXPLAIN_JSON_BYTES) {
      return Response.json({ error: 'payload_too_large' }, { status: 413 });
    }
    payload = rawBody.trim() === '' ? null : JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const p = payload as { slug?: unknown; promptId?: unknown } | null;
  const slug = typeof p?.slug === 'string' ? p.slug.trim() : '';
  const promptId =
    typeof p?.promptId === 'string' ? p.promptId.trim() : '';

  if (!slug || slug.length > LEN.topicSlug || slug.includes('..'))
    return Response.json({ error: 'invalid_payload' }, { status: 400 });

  if (
    !promptId ||
    promptId.length > LEN.topicSlug ||
    promptId.includes('..')
  )
    return Response.json({ error: 'invalid_payload' }, { status: 400 });

  if (!/^[-\w]+$/.test(slug) || !/^[-_\w]+$/.test(promptId)) {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }

  if (!explainAgentConfigured()) {
    return Response.json(
      {
        error: 'misconfigured_server',
        message: explainAgentMisconfiguredMessage(),
      },
      { status: 503 },
    );
  }

  const variantKey = buildExplainVariantCacheKey();
  const row = index[slug]?.[promptId];
  const chatQuery = row?.chatQuery;
  if (!row || typeof chatQuery !== 'string' || !chatQuery.trim()) {
    return Response.json({ error: 'unknown_prompt' }, { status: 404 });
  }

  const contentKey = explainContentKey(chatQuery);
  const cache = getExplainCache();
  const cachedHit = await cache.get(slug, promptId, contentKey, variantKey);

  if (cachedHit) {
    return Response.json(
      { answer: cachedHit.answer, cached: true },
      {
        status: 200,
        headers: { 'X-Explain-Cache': 'hit' },
      },
    );
  }

  const ip = clientIp(forwardedFor);
  if (!allowExplainRate(ip)) {
    return Response.json({ error: 'rate_limit' }, { status: 429 });
  }

  const fullPromptText = buildFullExplainPrompt(row);
  const brokerKey = `${slug}:${promptId}:${contentKey}:${variantKey}`;
  let brokerPromise = inFlightExplains.get(brokerKey);

  if (!brokerPromise) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(
      () => abortController.abort(),
      explainAgentTimeoutMs(),
    );

    brokerPromise = (async () => {
      try {
        const out = await runExplanation(fullPromptText, abortController);
        if (out.ok) {
          await cache
            .set(slug, promptId, contentKey, variantKey, out.text)
            .catch((e) => console.error('[explain-cache]', e));
        }
        return out;
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        } as ExplainRunResult;
      } finally {
        clearTimeout(timeoutId);
        inFlightExplains.delete(brokerKey);
      }
    })();
    inFlightExplains.set(brokerKey, brokerPromise);
  }

  try {
    const out = await brokerPromise;
    if (!out.ok) {
      const clientMsg =
        out.error === 'timeout_or_aborted'
          ? 'Timed out waiting for the model — try again.'
          : typeof out.error === 'string'
            ? out.error
            : 'generation_failed';
      return Response.json(
        { error: 'explain_failed', message: clientMsg },
        { status: 502 },
      );
    }
    const xCache = explainCacheActive() ? 'miss' : 'disabled';
    return Response.json(
      { answer: out.text, cached: false },
      {
        status: 200,
        headers: { 'X-Explain-Cache': xCache },
      },
    );
  } catch (e) {
    console.error(
      '[explain-prompt]',
      e instanceof Error ? e.message : String(e),
    );
    return Response.json(
      { error: 'explain_failed', message: 'unexpected_server_error' },
      { status: 502 },
    );
  }
}
