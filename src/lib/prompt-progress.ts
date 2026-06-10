const COOKIE = '100pua_prompt_clicked';

export type PromptProgressMap = Record<string, Record<string, number>>;

export function readPromptProgress(): PromptProgressMap {
  if (typeof document === 'undefined') return {};
  try {
    const m = document.cookie.match(
      new RegExp(
        '(?:^|; )' + COOKIE.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&') + '=([^;]*)',
      ),
    );
    if (!m) return {};
    return (JSON.parse(decodeURIComponent(m[1])) as PromptProgressMap) || {};
  } catch {
    return {};
  }
}

export function writePromptProgress(map: PromptProgressMap): void {
  if (typeof document === 'undefined') return;
  const encoded = encodeURIComponent(JSON.stringify(map));
  document.cookie =
    COOKIE + '=' + encoded + ';path=/;max-age=' + String(60 * 60 * 24 * 400) + ';samesite=lax';
}

export function recordPromptOpened(slug: string, promptId: string): void {
  const map = readPromptProgress();
  if (!map[slug]) map[slug] = {};
  map[slug][promptId] = Date.now();
  writePromptProgress(map);
}

export function clearPromptProgress(): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = COOKIE + '=;path=/;max-age=0;samesite=lax';
  } catch {
    //
  }
}
