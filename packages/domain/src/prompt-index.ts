import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Context, Effect, Layer } from "effect";

import { ProjectRoot } from "./project-root";

export type PromptRow = {
  topicTitle?: string;
  title?: string;
  chatQuery?: string;
};

export type PromptIndex = Record<string, Record<string, PromptRow>>;

export class PromptIndexService extends Context.Tag("@100pua/PromptIndexService")<
  PromptIndexService,
  PromptIndex | null
>() {
  static readonly Live = Layer.effect(
    PromptIndexService,
    Effect.gen(function* () {
      const root = yield* ProjectRoot;
      return loadPromptIndex(root);
    }),
  );
}

export function loadPromptIndex(projectRoot: string): PromptIndex | null {
  try {
    const fp = path.join(projectRoot, "data", "prompt-index.json");
    const raw = fs.readFileSync(fp, "utf8");
    const j: unknown = JSON.parse(raw);
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    return j as PromptIndex;
  } catch {
    console.warn("[explain-prompt] missing data/prompt-index.json - run `bun run build`");
    return null;
  }
}

export function explainContentKey(chatQuery: string): string {
  return crypto.createHash("sha256").update(chatQuery.trim(), "utf8").digest("hex");
}

export function buildFullExplainPrompt(row: PromptRow): string {
  const chatQuery = typeof row.chatQuery === "string" ? row.chatQuery.trim() : "";
  const topicLine = typeof row.topicTitle === "string" ? row.topicTitle : "";
  const rowTitle = typeof row.title === "string" ? row.title : "";
  const preamble = [
    `You help students digest topic-aligned study prompts (the same text they might paste into ChatGPT).`,
    ``,
    `- Reply in Markdown. Prefer clarity over length (about 500-900 words unless the question is narrow).`,
    `- Use short sections, bullets, and concrete examples when helpful.`,
    `- Do not claim you watched a video or opened a specific URL; infer from the pasted prompt and any links in it only.`,
    `- Use everything the Cursor agent can do (browse, fetch, run commands, MCP, etc.) when it strengthens the answer; don't default to the pasted text only.`,
    `- When facts need grounding, use available tools proactively; cite concise sources where helpful.`,
  ].join("\n");

  return (
    `${preamble}\n\n---\nTopic: ${topicLine}\nPrompt title: ${rowTitle}\n\n` +
    `--- Student-facing study prompt ---\n\n${chatQuery}`
  );
}

export function buildExplainVariantCacheKey(model: string): string {
  return `cursor:${model}`;
}
