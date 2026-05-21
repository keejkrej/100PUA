import 'dotenv/config';

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_CURSOR_MODEL } from './explain-defaults.js';

export type PromptRow = {
  topicTitle?: string;
  title?: string;
  chatQuery?: string;
};

export type PromptIndex = Record<string, Record<string, PromptRow>>;

export type ExplainRunOk = { ok: true; text: string };
export type ExplainRunErr = { ok: false; error: string };
export type ExplainRunResult = ExplainRunOk | ExplainRunErr;

export const DEFAULT_EXPLAIN_AGENT_TIMEOUT_MS = 240_000;

export function explainAgentTimeoutMs(): number {
  const raw = (process.env.EXPLAIN_TIMEOUT_MS ?? '').trim();
  return Number.isFinite(Number(raw))
    ? Math.max(45_000, Number(raw))
    : DEFAULT_EXPLAIN_AGENT_TIMEOUT_MS;
}

export function loadPromptIndex(apiRoot: string): PromptIndex | null {
  try {
    const fp = path.join(apiRoot, 'data', 'prompt-index.json');
    const raw = fs.readFileSync(fp, 'utf8');
    const j: unknown = JSON.parse(raw);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    return j as PromptIndex;
  } catch {
    console.warn(
      '[explain-prompt] missing data/prompt-index.json - run `npm run build` in ./api',
    );
    return null;
  }
}

export function explainContentKey(chatQuery: string): string {
  return crypto
    .createHash('sha256')
    .update(chatQuery.trim(), 'utf8')
    .digest('hex');
}

export function explainAgentConfigured(): boolean {
  return Boolean((process.env.CURSOR_API_KEY ?? '').trim());
}

export function explainAgentMisconfiguredMessage(): string {
  return 'Set CURSOR_API_KEY on the API service.';
}

export function buildFullExplainPrompt(row: PromptRow): string {
  const chatQuery = typeof row.chatQuery === 'string' ? row.chatQuery.trim() : '';
  const topicLine = typeof row.topicTitle === 'string' ? row.topicTitle : '';
  const rowTitle = typeof row.title === 'string' ? row.title : '';
  const preamble = [
    `You help students digest topic-aligned study prompts (the same text they might paste into ChatGPT).`,
    ``,
    `- Reply in Markdown. Prefer clarity over length (about 500-900 words unless the question is narrow).`,
    `- Use short sections, bullets, and concrete examples when helpful.`,
    `- Do not claim you watched a video or opened a specific URL; infer from the pasted prompt and any links in it only.`,
    `- Use everything the Cursor agent can do (browse, fetch, run commands, MCP, etc.) when it strengthens the answer; don't default to the pasted text only.`,
    `- When facts need grounding, use available tools proactively; cite concise sources where helpful.`,
  ].join('\n');

  return (
    `${preamble}\n\n---\nTopic: ${topicLine}\nPrompt title: ${rowTitle}\n\n` +
    `--- Student-facing study prompt ---\n\n${chatQuery}`
  );
}

export async function runExplanation(
  fullPromptText: string,
  abortController: AbortController,
): Promise<ExplainRunResult> {
  const { Agent, CursorAgentError } = await import('@cursor/sdk');
  const apiKey = (process.env.CURSOR_API_KEY ?? '').trim();
  if (!apiKey) return { ok: false, error: 'missing_cursor_api_key' };

  const modelId =
    (process.env.CURSOR_MODEL ?? '').trim() || DEFAULT_CURSOR_MODEL;

  const sessionHome = await fsp.mkdtemp(path.join(os.tmpdir(), '100pua-cursor-'));

  try {
    const agent = await Agent.create({
      apiKey,
      model: { id: modelId },
      name: '100pua-explain-prompt',
      local: {
        cwd: sessionHome,
        settingSources: [],
        sandboxOptions: { enabled: false },
      },
    });
    try {
      const run = await agent.send(fullPromptText);

      const onAbort = (): void => {
        if (run.supports('cancel')) void run.cancel().catch(() => {});
      };
      abortController.signal.addEventListener('abort', onAbort, {
        once: true,
      });

      let result;
      try {
        if (abortController.signal.aborted) {
          onAbort();
          return { ok: false, error: 'timeout_or_aborted' };
        }
        result = await run.wait();
      } finally {
        abortController.signal.removeEventListener('abort', onAbort);
      }

      if (abortController.signal.aborted || result.status === 'cancelled') {
        return { ok: false, error: 'timeout_or_aborted' };
      }
      if (result.status === 'error') {
        const msg =
          typeof result.result === 'string' && result.result.trim()
            ? result.result.trim()
            : 'cursor_run_failed';
        return { ok: false, error: msg };
      }

      const finalText =
        typeof result.result === 'string' ? result.result.trim() : '';
      if (finalText) return { ok: true, text: finalText };
      return { ok: false, error: 'agent_finished_without_result' };
    } finally {
      await agent[Symbol.asyncDispose]().catch(() => {});
    }
  } catch (e: unknown) {
    if (e instanceof CursorAgentError)
      console.error('[explain-prompt]', e.message);
    else console.error('[explain-prompt]', e);

    const name =
      e && typeof e === 'object' && 'name' in e
        ? String((e as Error).name)
        : '';
    if (name === 'AbortError')
      return { ok: false, error: 'timeout_or_aborted' };

    const msg = e instanceof Error ? e.message : 'cursor_sdk_error';
    return { ok: false, error: msg };
  } finally {
    await fsp.rm(sessionHome, { recursive: true, force: true }).catch(() => {});
  }
}
