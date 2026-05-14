/**
 * Writes api/data/prompt-index.json from ../src/data (repo root relative to api/).
 * Run from api/: `npm run build` (Render build includes this).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.join(__dirname, '..');
const repoRoot = path.join(apiRoot, '..');
const manifestPath = path.join(repoRoot, 'src', 'data', 'topics.manifest.json');
const outDir = path.join(apiRoot, 'data');
const outPath = path.join(outDir, 'prompt-index.json');

function buildChatQuery(prompt) {
  const url = (prompt.videoUrl ?? '').trim();
  const base = (prompt.query ?? '').trimEnd();
  if (!url) return base;
  if (base.includes(url)) return base;
  return `${base}\n\nYouTube lecture (use this URL when looking up captions or transcript): ${url}`;
}

function main() {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (!Array.isArray(manifest)) throw new Error('topics.manifest.json must be an array');

  /** @type {Record<string, Record<string, { topicTitle: string; title: string; chatQuery: string }>>} */
  const index = {};

  for (const row of manifest) {
    const slug = row?.slug;
    if (typeof slug !== 'string' || !slug) continue;
    const topicPath = path.join(repoRoot, 'src', 'data', `${slug}.json`);
    if (!fs.existsSync(topicPath)) {
      console.warn('[build-prompt-index] skip missing topic file:', topicPath);
      continue;
    }
    const topic = JSON.parse(fs.readFileSync(topicPath, 'utf8'));
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
