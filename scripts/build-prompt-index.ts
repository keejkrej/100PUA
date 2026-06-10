/**
 * Writes data/prompt-index.json from src/data.
 * Run via `npm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const manifestPath = path.join(repoRoot, 'src', 'data', 'topics.manifest.json');
const outDir = path.join(repoRoot, 'data');
const outPath = path.join(outDir, 'prompt-index.json');

type ManifestRow = { slug?: string };
type TopicPrompt = {
  id?: string;
  title?: string;
  resourceUrls?: string[];
  query?: string;
};
type TopicFile = {
  topicTitle?: string;
  prompts?: TopicPrompt[];
};

function buildChatQuery(prompt: TopicPrompt): string {
  const raw = prompt.resourceUrls;
  const seen = new Set<string>();
  const urls: string[] = [];
  if (Array.isArray(raw)) {
    for (const u of raw) {
      if (typeof u !== 'string') continue;
      const t = u.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      urls.push(t);
    }
  }
  const base = (prompt.query ?? '').trimEnd();
  if (urls.length === 0) return base;
  const missing = urls.filter((u) => !base.includes(u));
  if (missing.length === 0) return base;
  const lines = missing.map((u) => `- ${u}`).join('\n');
  return `${base}\n\nReference URLs (use for context; do not claim you watched a video or accessed paywalled sources unless you can verify them):\n${lines}`;
}

function main(): void {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest: unknown = JSON.parse(raw);
  if (!Array.isArray(manifest))
    throw new Error('topics.manifest.json must be an array');

  const index: Record<
    string,
    Record<string, { topicTitle: string; title: string; chatQuery: string }>
  > = {};

  for (const row of manifest as ManifestRow[]) {
    const slug = row?.slug;
    if (typeof slug !== 'string' || !slug) continue;
    const topicPath = path.join(repoRoot, 'src', 'data', `${slug}.json`);
    if (!fs.existsSync(topicPath)) {
      console.warn('[build-prompt-index] skip missing topic file:', topicPath);
      continue;
    }
    const topic = JSON.parse(
      fs.readFileSync(topicPath, 'utf8'),
    ) as TopicFile;
    const prompts = topic?.prompts;
    if (!Array.isArray(prompts)) continue;
    index[slug] = {};
    for (const p of prompts) {
      const id = p?.id;
      if (typeof id !== 'string' || !id) continue;
      const title = typeof p.title === 'string' ? p.title : '';
      index[slug][id] = {
        topicTitle: typeof topic.topicTitle === 'string' ? topic.topicTitle : '',
        title,
        chatQuery: buildChatQuery(p),
      };
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(index), 'utf8');
  console.log('[build-prompt-index] wrote', outPath);
}

main();
