import { HttpApiBuilder } from "@effect/platform";
import { Effect, Layer } from "effect";

import {
  DomainLive,
  explainPrompt,
  primeExplainCache,
  RateLimitExceeded,
  RateLimitService,
  submitSuggestion,
} from "@100pua/domain";
import { clientIp } from "@100pua/domain";

import { Api } from "./api";

export const RoutesLive = HttpApiBuilder.group(Api, "routes", (handlers) =>
  handlers
    .handle("health", () => primeExplainCache.pipe(Effect.as({ ok: true as const })))
    .handle("explainPrompt", ({ payload, request }) =>
      Effect.gen(function* () {
        const ip = clientIp(request.headers["x-forwarded-for"] ?? null);
        const result = yield* explainPrompt(payload, ip);
        return {
          answer: result.answer,
          cached: result.cached,
        };
      }),
    )
    .handle("suggestions", ({ payload, request }) =>
      Effect.gen(function* () {
        const ip = clientIp(request.headers["x-forwarded-for"] ?? null);
        const rateLimit = yield* RateLimitService;
        const allowed = yield* rateLimit.allowSuggest(ip);
        if (!allowed) {
          return yield* Effect.fail(new RateLimitExceeded({ error: "rate_limit" }));
        }
        return yield* submitSuggestion(payload);
      }),
    ),
);

export const ApiLive = HttpApiBuilder.api(Api).pipe(
  Layer.provide(RoutesLive),
  Layer.provide(DomainLive),
);
