export type TopicPromptForChat = {
  query: string;
  resourceUrls?: readonly string[] | string[] | null;
};

function normalizeResourceUrls(raw: TopicPromptForChat['resourceUrls']): string[] {
  if (raw == null || !Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Full text sent as ChatGPT `q`. Appends reference URLs unless already present in the query body. */
export function buildChatQuery(prompt: TopicPromptForChat): string {
  const urls = normalizeResourceUrls(prompt.resourceUrls);
  const base = prompt.query.trimEnd();
  if (urls.length === 0) return base;
  const missing = urls.filter((u) => !base.includes(u));
  if (missing.length === 0) return base;
  const lines = missing.map((u) => `- ${u}`).join('\n');
  return `${base}\n\nReference URLs (use for context; do not claim you watched a video or accessed paywalled sources unless you can verify them):\n${lines}`;
}
