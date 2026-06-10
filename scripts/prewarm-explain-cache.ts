/**
 * Pre-generates cached /api/explain-prompt answers for prompt rows.
 */
import 'dotenv/config';

import { Effect } from 'effect';

import {
  buildExplainVariantCacheKeyFromEnv,
  buildFullExplainPrompt,
  createExplainCache,
  explainAgentConfigured,
  explainAgentMisconfiguredMessage,
  explainAgentTimeoutMs,
  explainContentKey,
  isExplainCacheActiveFromEnv,
  loadPromptIndex,
  runExplanation,
  scriptProjectRoot,
  type PromptRow,
} from '../packages/domain/src/script-helpers.js';

const repoRoot = scriptProjectRoot();

type CliOptions = {
  model: string | null;
  concurrency: number;
  force: boolean;
  dryRun: boolean;
  slug: string | null;
  promptId: string | null;
};

type PromptJob = {
  slug: string;
  promptId: string;
  row: PromptRow;
};

type JobStatus = 'cached' | 'dry-run' | 'failed' | 'generated' | 'skipped';

function usage(): string {
  return [
    'Usage: bun run prewarm:explain -- [options]',
    '',
    'Options:',
    '  --model <id>                   Cursor model id (default from CURSOR_MODEL env)',
    '  --concurrency <n>              Parallel generations (default: 1)',
    '  --slug <slug>                  Limit to one topic slug',
    '  --prompt <id>                  Limit to one prompt id (requires --slug)',
    '  --force                        Regenerate even when a cache entry exists',
    '  --dry-run                      List work without calling a model or writing cache',
    '  --help                         Show this help',
  ].join('\n');
}

function readValue(args: string[], index: number, flag: string): string {
  const val = args[index + 1];
  if (!val || val.startsWith('--')) throw new Error(`${flag} needs a value`);
  return val;
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    model: null,
    concurrency: 1,
    force: false,
    dryRun: false,
    slug: null,
    promptId: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--force') {
      out.force = true;
      continue;
    }
    if (arg === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (arg === '--model') {
      out.model = readValue(argv, i, arg).trim();
      i += 1;
      continue;
    }
    if (arg === '--concurrency') {
      const n = Number(readValue(argv, i, arg));
      if (!Number.isFinite(n) || n < 1)
        throw new Error('--concurrency must be a positive number');
      out.concurrency = Math.min(Math.floor(n), 8);
      i += 1;
      continue;
    }
    if (arg === '--slug') {
      out.slug = readValue(argv, i, arg).trim();
      i += 1;
      continue;
    }
    if (arg === '--prompt') {
      out.promptId = readValue(argv, i, arg).trim();
      i += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (out.promptId && !out.slug)
    throw new Error('--prompt requires --slug so prompt ids stay unambiguous');
  return out;
}

function applyModelEnv(model: string | null): void {
  if (model) process.env.CURSOR_MODEL = model;
}

function selectedModel(): string {
  return (process.env.CURSOR_MODEL ?? '').trim() || '(default)';
}

function collectJobs(
  index: NonNullable<ReturnType<typeof loadPromptIndex>>,
  opts: CliOptions,
): PromptJob[] {
  const jobs: PromptJob[] = [];
  for (const [slug, prompts] of Object.entries(index)) {
    if (opts.slug && slug !== opts.slug) continue;
    for (const [promptId, row] of Object.entries(prompts)) {
      if (opts.promptId && promptId !== opts.promptId) continue;
      if (typeof row.chatQuery !== 'string' || !row.chatQuery.trim()) continue;
      jobs.push({ slug, promptId, row });
    }
  }
  return jobs;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  applyModelEnv(opts.model);

  await import('./build-prompt-index.js');

  const promptIndex = loadPromptIndex(repoRoot);
  if (!promptIndex || Object.keys(promptIndex).length === 0) {
    throw new Error('No prompt index found. Run `bun run build`.');
  }

  if (!opts.dryRun && !explainAgentConfigured()) {
    throw new Error(explainAgentMisconfiguredMessage());
  }

  if (!opts.dryRun && !isExplainCacheActiveFromEnv()) {
    throw new Error(
      'Explain cache is disabled. Set EXPLAIN_CACHE_DAYS > 0 or unset EXPLAIN_CACHE_DISABLED.',
    );
  }

  const cache = createExplainCache(repoRoot);
  if (!opts.dryRun) await cache.prime().pipe(Effect.runPromise);

  const variantKey = buildExplainVariantCacheKeyFromEnv();
  const jobs = collectJobs(promptIndex, opts);
  if (jobs.length === 0) {
    throw new Error('No matching prompts found.');
  }

  console.log(
    `[prewarm-explain-cache] model=${selectedModel()} prompts=${jobs.length} concurrency=${opts.concurrency} force=${opts.force ? 'yes' : 'no'} variant=${variantKey}`,
  );

  let next = 0;
  let completed = 0;
  const counts: Record<JobStatus, number> = {
    cached: 0,
    'dry-run': 0,
    failed: 0,
    generated: 0,
    skipped: 0,
  };

  async function runJob(job: PromptJob): Promise<JobStatus> {
    const chatQuery = job.row.chatQuery;
    if (typeof chatQuery !== 'string' || !chatQuery.trim()) return 'skipped';

    const contentKey = explainContentKey(chatQuery);
    if (!opts.force && !opts.dryRun) {
      const hit = await Effect.runPromise(
        cache.get(job.slug, job.promptId, contentKey, variantKey),
      );
      if (hit) return 'cached';
    }

    if (opts.dryRun) return 'dry-run';

    const abortController = new AbortController();
    const timeoutId = setTimeout(
      () => abortController.abort(),
      explainAgentTimeoutMs(),
    );
    try {
      const out = await runExplanation(
        buildFullExplainPrompt(job.row),
        abortController,
      );
      if (!out.ok) {
        console.error(
          `[prewarm-explain-cache] failed ${job.slug}/${job.promptId}: ${out.error}`,
        );
        return 'failed';
      }
      await Effect.runPromise(
        cache.set(job.slug, job.promptId, contentKey, variantKey, out.text),
      );
      return 'generated';
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function worker(): Promise<void> {
    for (;;) {
      const idx = next;
      next += 1;
      const job = jobs[idx];
      if (!job) return;

      const status = await runJob(job);
      counts[status] += 1;
      completed += 1;
      console.log(
        `[prewarm-explain-cache] ${completed}/${jobs.length} ${status} ${job.slug}/${job.promptId}`,
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency, jobs.length) }, () =>
      worker(),
    ),
  );

  console.log(
    `[prewarm-explain-cache] done generated=${counts.generated} cached=${counts.cached} dry-run=${counts['dry-run']} skipped=${counts.skipped} failed=${counts.failed}`,
  );

  if (counts.failed > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(
    `[prewarm-explain-cache] ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exitCode = 1;
});
