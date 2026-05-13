/** Full text sent as ChatGPT `q`. Appends lecture URL unless already present (e.g. after CSV re-import). */
export function buildChatQuery(prompt: { query: string; videoUrl: string }): string {
  const url = (prompt.videoUrl ?? '').trim();
  const base = prompt.query.trimEnd();
  if (!url) return base;
  if (base.includes(url)) return base;
  return `${base}\n\nYouTube lecture (use this URL when looking up captions or transcript): ${url}`;
}
