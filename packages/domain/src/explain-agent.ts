import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Context, Effect, Layer } from "effect";

import { AppConfig } from "./config";

export type ExplainRunOk = { ok: true; text: string };
export type ExplainRunErr = { ok: false; error: string };
export type ExplainRunResult = ExplainRunOk | ExplainRunErr;

export class ExplainAgentService extends Context.Tag("@100pua/ExplainAgentService")<
  ExplainAgentService,
  {
    run: (
      fullPromptText: string,
      abortController: AbortController,
    ) => Effect.Effect<ExplainRunResult>;
  }
>() {
  static readonly Live = Layer.effect(
    ExplainAgentService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      return {
        run: (fullPromptText, abortController) =>
          Effect.promise(() =>
            runExplanation(
              fullPromptText,
              abortController,
              config.cursorApiKey,
              config.cursorModel,
            ),
          ),
      };
    }),
  );
}

async function runExplanation(
  fullPromptText: string,
  abortController: AbortController,
  apiKey: string,
  modelId: string,
): Promise<ExplainRunResult> {
  if (!apiKey) return { ok: false, error: "missing_cursor_api_key" };

  const { Agent, CursorAgentError } = await import("@cursor/sdk");
  const sessionHome = await fsp.mkdtemp(path.join(os.tmpdir(), "100pua-cursor-"));

  try {
    const agent = await Agent.create({
      apiKey,
      model: { id: modelId },
      name: "100pua-explain-prompt",
      local: {
        cwd: sessionHome,
        settingSources: [],
        sandboxOptions: { enabled: false },
      },
    });
    try {
      const run = await agent.send(fullPromptText);

      const onAbort = (): void => {
        if (run.supports("cancel")) void run.cancel().catch(() => {});
      };
      abortController.signal.addEventListener("abort", onAbort, {
        once: true,
      });

      let result;
      try {
        if (abortController.signal.aborted) {
          onAbort();
          return { ok: false, error: "timeout_or_aborted" };
        }
        result = await run.wait();
      } finally {
        abortController.signal.removeEventListener("abort", onAbort);
      }

      if (abortController.signal.aborted || result.status === "cancelled") {
        return { ok: false, error: "timeout_or_aborted" };
      }
      if (result.status === "error") {
        const msg =
          typeof result.result === "string" && result.result.trim()
            ? result.result.trim()
            : "cursor_run_failed";
        return { ok: false, error: msg };
      }

      const finalText = typeof result.result === "string" ? result.result.trim() : "";
      if (finalText) return { ok: true, text: finalText };
      return { ok: false, error: "agent_finished_without_result" };
    } finally {
      await agent[Symbol.asyncDispose]().catch(() => {});
    }
  } catch (e: unknown) {
    if (e instanceof CursorAgentError) console.error("[explain-prompt]", e.message);
    else console.error("[explain-prompt]", e);

    const name = e && typeof e === "object" && "name" in e ? String((e as Error).name) : "";
    if (name === "AbortError") return { ok: false, error: "timeout_or_aborted" };

    const msg = e instanceof Error ? e.message : "cursor_sdk_error";
    return { ok: false, error: msg };
  } finally {
    await fsp.rm(sessionHome, { recursive: true, force: true }).catch(() => {});
  }
}
