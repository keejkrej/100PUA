import DOMPurify from 'dompurify';
import renderMathInElement from 'katex/contrib/auto-render';
import { marked } from 'marked';

marked.use({ gfm: true, breaks: true });

type View = 'rendered' | 'raw';

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
    const html = marked.parse(markdown) as string;
    rendered.className = 'explain-md block';
    rendered.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    try {
      renderMathInElement(rendered, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true },
        ],
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

export function initExplainPromptView(root: HTMLElement) {
  const suggestApiBase = root.dataset.explainApi?.trim();
  const slug = root.dataset.explainSlug?.trim();
  const promptId = root.dataset.explainPromptId?.trim();

  if (!suggestApiBase || !slug || !promptId) return;

  fetch(`${suggestApiBase}/explain-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, promptId }),
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
      const j = resp.json;
      if (resp.ok && typeof j.answer === 'string') mountAnswer(j.answer);
      else {
        const msg =
          j.error === 'rate_limit'
            ? 'Too many attempts — try again later.'
            : typeof j.message === 'string'
              ? j.message
              : 'Service error.';
        mountError(msg);
      }
    })
    .catch(() => mountError('Network error.'));
}
