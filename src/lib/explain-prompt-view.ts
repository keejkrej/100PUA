import DOMPurify from 'dompurify';
import katex from 'katex';
import renderMathInElement from 'katex/contrib/auto-render';
import { marked } from 'marked';

marked.use({ gfm: true, breaks: true });

/**
 * `marked` + `breaks: true` turns newlines inside `$$…$$` into `<br>`, so KaTeX auto-render
 * never pairs the delimiters and leaves raw `$$` visible. We render display blocks on HTML.
 */
function renderDisplayMathDollars(html: string): string {
  return html.replace(
    /<pre\b[\s\S]*?<\/pre>|\$\$([\s\S]*?)\$\$/gi,
    (fragment, latexBlock: string | undefined) => {
      if (latexBlock === undefined) return fragment;

      const latex = latexBlock
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();
      if (!latex) return fragment;

      try {
        return katex.renderToString(latex, {
          displayMode: true,
          throwOnError: false,
          strict: 'ignore',
        });
      } catch {
        return fragment;
      }
    },
  );
}

/**
 * Normalize common model LaTeX into KaTeX auto-render delimiters ($$, $).
 *
 * Square-bracket wrappers like `[S = k_B \\log \\Omega]` (must include `=`) are not TeX math;
 * `\[` `\(` are often eaten by Markdown (backslash escapes) before KaTeX runs.
 */
function normalizeMarkdownMath(markdown: string): string {
  let md = markdown;

  md = md.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => {
    const t = inner.trim();
    return t ? `\n\n$$\n${t}\n$$\n\n` : '';
  });

  md = md.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => {
    const t = inner.trim();
    return t ? `$${t}$` : '';
  });

  md = md.replace(/\[[^\]\n]+\]/g, (match, offset, whole) => {
    if (whole[offset + match.length] === '(') return match;
    const inner = match.slice(1, -1).trim();
    if (inner.length === 0 || !/\\[a-zA-Z]/.test(inner)) return match;
    // Avoid stealing inner groups like `[\sigma(k_0)]` from `\Re[\sigma(k_0)]`.
    // The heuristic targets standalone bracket blocks such as `[S = k_B \log \Omega]`.
    if (!inner.includes('=')) return match;
    return `\n\n$$\n${inner}\n$$\n\n`;
  });

  return md;
}

type View = 'rendered' | 'raw';

export type ExplainProvider = 'claude' | 'cursor' | 'codex';

const PROVIDERS: ExplainProvider[] = ['cursor', 'codex', 'claude'];

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function setView(view: View) {
  const rendered = el('explain-rendered');
  const raw = el('explain-raw');
  const bR = el('explain-toggle-rendered');
  const bW = el('explain-toggle-raw');
  if (!rendered || !raw || !bR || !bW) return;

  const isRendered = view === 'rendered';
  rendered.hidden = !isRendered;
  raw.hidden = isRendered;

  bR.classList.toggle('explain-toggle--on', isRendered);
  bR.classList.toggle('explain-toggle--off', !isRendered);
  bR.setAttribute('aria-checked', String(isRendered));

  bW.classList.toggle('explain-toggle--on', !isRendered);
  bW.classList.toggle('explain-toggle--off', isRendered);
  bW.setAttribute('aria-checked', String(!isRendered));

  bR.tabIndex = isRendered ? 0 : -1;
  bW.tabIndex = isRendered ? -1 : 0;
}

function bindToggle(btn: HTMLElement, view: View) {
  btn.addEventListener('click', () => setView(view));
  btn.addEventListener('keydown', (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setView(view);
  });
}

function setProviderUI(active: ExplainProvider) {
  for (const p of PROVIDERS) {
    const btn = el(`explain-provider-${p}`);
    if (!btn) continue;
    const on = p === active;
    btn.classList.toggle('explain-toggle--on', on);
    btn.classList.toggle('explain-toggle--off', !on);
    btn.setAttribute('aria-checked', String(on));
    btn.tabIndex = on ? 0 : -1;
  }
}

function bindProviderButton(btn: HTMLElement, provider: ExplainProvider, onPick: (p: ExplainProvider) => void) {
  btn.addEventListener('click', () => onPick(provider));
  btn.addEventListener('keydown', (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onPick(provider);
  });
}

function mountAnswer(markdown: string) {
  const statusEl = el('explain-status');
  const toolbar = el('explain-toolbar');
  const rendered = el('explain-rendered');
  const raw = el('explain-raw');

  if (statusEl) {
    statusEl.textContent = 'Answer';
    statusEl.classList.remove('text-muted');
    statusEl.classList.add('text-accent/90');
  }

  if (toolbar) {
    toolbar.classList.remove('hidden');
    toolbar.classList.add('flex');
    toolbar.removeAttribute('aria-hidden');
    if (toolbar.dataset.bound !== '1') {
      toolbar.dataset.bound = '1';
      const bR = el('explain-toggle-rendered');
      const bW = el('explain-toggle-raw');
      if (bR) bindToggle(bR, 'rendered');
      if (bW) bindToggle(bW, 'raw');
    }
  }

  if (rendered && raw) {
    raw.textContent = markdown;
    const htmlRaw = marked.parse(normalizeMarkdownMath(markdown)) as string;
    const safe = DOMPurify.sanitize(htmlRaw, {
      USE_PROFILES: { html: true },
    });
    rendered.className = 'explain-md block';
    rendered.innerHTML = renderDisplayMathDollars(safe);
    try {
      renderMathInElement(rendered, {
        delimiters: [
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true },
        ],
        ignoredClasses: ['katex', 'katex-display', 'katex-html'],
        throwOnError: false,
        strict: 'ignore',
      });
    } catch {
      //
    }
  }

  setView('rendered');
}

function mountError(display: string) {
  const statusEl = el('explain-status');
  const toolbar = el('explain-toolbar');
  const rendered = el('explain-rendered');
  const raw = el('explain-raw');

  if (statusEl) {
    statusEl.textContent = 'Could not load answer';
    statusEl.classList.remove('text-muted');
    statusEl.classList.add('text-accent');
  }

  if (toolbar) {
    toolbar.classList.add('hidden');
    toolbar.classList.remove('flex');
    toolbar.setAttribute('aria-hidden', 'true');
  }

  if (rendered && raw) {
    rendered.innerHTML = '';
    rendered.textContent = display;
    rendered.className =
      'block text-sm leading-relaxed text-muted whitespace-pre-wrap';
    rendered.hidden = false;
    raw.hidden = true;
    raw.textContent = '';
  }
}

function mountLoading(label: string) {
  const statusEl = el('explain-status');
  const toolbar = el('explain-toolbar');
  const rendered = el('explain-rendered');
  const raw = el('explain-raw');

  if (statusEl) {
    statusEl.textContent = label;
    statusEl.classList.add('text-muted');
    statusEl.classList.remove('text-accent', 'text-accent/90');
  }

  if (toolbar) {
    toolbar.classList.add('hidden');
    toolbar.classList.remove('flex');
    toolbar.setAttribute('aria-hidden', 'true');
  }

  if (rendered && raw) {
    rendered.innerHTML = '';
    rendered.textContent = '';
    rendered.className = 'explain-md block';
    rendered.hidden = false;
    raw.hidden = true;
    raw.textContent = '';
  }
}

function coerceDefaultProvider(raw: string | undefined): ExplainProvider {
  const s = raw?.trim().toLowerCase();
  if (s === 'cursor' || s === 'claude') return s;
  return 'codex';
}

let explainFetchAbort: AbortController | null = null;
let lastExplainSlugPromptKey: string | null = null;
const answerByProvider = new Map<ExplainProvider, string>();

export function initExplainPromptView(root: HTMLElement) {
  const suggestApiBase = root.dataset.explainApi?.trim();
  const slug = root.dataset.explainSlug?.trim();
  const promptId = root.dataset.explainPromptId?.trim();

  if (!suggestApiBase || !slug || !promptId) return;

  const pageKeyInner = `${slug}:${promptId}`;
  if (lastExplainSlugPromptKey !== pageKeyInner) {
    lastExplainSlugPromptKey = pageKeyInner;
    answerByProvider.clear();
    explainFetchAbort?.abort();
    root.dataset.explainInit = '';
  }

  if (root.dataset.explainInit === '1') return;
  root.dataset.explainInit = '1';

  const defaultProvider = coerceDefaultProvider(root.dataset.explainDefaultProvider);

  const providerBar = el('explain-provider-toolbar');
  if (providerBar && providerBar.dataset.bound !== '1') {
    providerBar.dataset.bound = '1';
    for (const p of PROVIDERS) {
      const b = el(`explain-provider-${p}`);
      if (b) bindProviderButton(b, p, (pick) => requestExplain(pick));
    }
  }

  function requestExplain(provider: ExplainProvider) {
    setProviderUI(provider);

    const hit = answerByProvider.get(provider);
    if (hit !== undefined) {
      mountAnswer(hit);
      return;
    }

    const label =
      provider === 'claude'
        ? 'Generating Claude answer…'
        : provider === 'cursor'
          ? 'Generating Cursor answer…'
          : 'Generating Codex answer…';
    mountLoading(label);

    explainFetchAbort?.abort();
    const controller = new AbortController();
    explainFetchAbort = controller;

    fetch(`${suggestApiBase}/explain-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, promptId, provider }),
      signal: controller.signal,
    })
      .then((r) =>
        r.text().then((t) => {
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(t) as Record<string, unknown>;
          } catch {
            json = {};
          }
          return { ok: r.ok, json };
        }),
      )
      .then((resp) => {
        if (explainFetchAbort !== controller) return;
        const j = resp.json;
        if (resp.ok && typeof j.answer === 'string') {
          answerByProvider.set(provider, j.answer);
          mountAnswer(j.answer);
        } else {
          answerByProvider.delete(provider);
          const msg =
            j.error === 'rate_limit'
              ? 'Too many attempts — try again later.'
              : typeof j.message === 'string'
                ? j.message
                : 'Service error.';
          mountError(msg);
        }
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (explainFetchAbort !== controller) return;
        answerByProvider.delete(provider);
        mountError('Network error.');
      })
      .finally(() => {
        if (explainFetchAbort === controller) explainFetchAbort = null;
      });
  }

  requestExplain(defaultProvider);
}

let explainWireInstalled = false;

/**
 * View Transitions swap pages without a full reload; module scripts can run before
 * the new DOM is present. Re-run after each navigation via `astro:page-load`, like
 * the topic list progress script.
 */
export function wireExplainPromptView() {
  function boot() {
    const root = document.querySelector<HTMLElement>('section[data-explain-api]');
    if (!root) return;
    initExplainPromptView(root);
  }

  if (!explainWireInstalled) {
    explainWireInstalled = true;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
    document.addEventListener('astro:page-load', boot);
  } else {
    boot();
  }
}
