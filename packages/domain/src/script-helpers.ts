import { Effect } from "effect";

import { AppConfig } from "./config";
import { ExplainAgentService } from "./explain-agent";
import { createExplainCacheFromEnv, explainCacheActiveFromEnv } from "./explain-cache";
import {
  buildExplainVariantCacheKey,
  buildFullExplainPrompt,
  explainContentKey,
  loadPromptIndex,
  type PromptRow,
} from "./prompt-index";
import { ProjectRootLive, resolveProjectRoot } from "./project-root";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRootFromScripts = resolveProjectRoot(path.dirname(fileURLToPath(import.meta.url)));

export {
  buildExplainVariantCacheKey,
  buildFullExplainPrompt,
  explainContentKey,
  loadPromptIndex,
  type PromptRow,
};

export function scriptProjectRoot(): string {
  return repoRootFromScripts;
}

export function explainAgentConfigured(): boolean {
  return Boolean((process.env.CURSOR_API_KEY ?? "").trim());
}

export function explainAgentMisconfiguredMessage(): string {
  return "Set CURSOR_API_KEY on the server.";
}

export function explainAgentTimeoutMs(): number {
  const raw = (process.env.EXPLAIN_TIMEOUT_MS ?? "").trim();
  return Number.isFinite(Number(raw)) ? Math.max(45_000, Number(raw)) : 240_000;
}

export function isExplainCacheActiveFromEnv(): boolean {
  return explainCacheActiveFromEnv();
}

export function createExplainCache(projectRoot: string) {
  return createExplainCacheFromEnv(projectRoot);
}

export async function runExplanation(
  fullPromptText: string,
  abortController: AbortController,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const agent = yield* ExplainAgentService;
      return yield* agent.run(fullPromptText, abortController);
    }).pipe(
      Effect.provide(ExplainAgentService.Live),
      Effect.provide(AppConfig.Live),
      Effect.provide(ProjectRootLive),
    ),
  );
}

export function buildExplainVariantCacheKeyFromEnv(): string {
  const model = (process.env.CURSOR_MODEL ?? "").trim() || "composer-2";
  return buildExplainVariantCacheKey(model);
}
