import { useEffect, useRef, useState } from 'react';

type Mode = 'topic' | 'prompt';

type Props = {
  mode: Mode;
  topicSlug?: string;
  topicTitle?: string;
};

const GITHUB_REPO =
  (import.meta.env.VITE_GITHUB_REPO as string | undefined)?.trim() ||
  'keejkrej/100PUA';

const URL_MAX = 7800;

function escapeAttrHref(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function buildGithubDraftUrl(title: string, body: string): string {
  let t = title;
  let b = body;
  let u =
    'https://github.com/' +
    GITHUB_REPO +
    '/issues/new?title=' +
    encodeURIComponent(t) +
    '&body=' +
    encodeURIComponent(b);
  while (u.length > URL_MAX && b.length > 80) {
    b =
      b.slice(0, b.length - 120) +
      '\n\n_(trimmed for URL length — add more on GitHub if needed)_';
    u =
      'https://github.com/' +
      GITHUB_REPO +
      '/issues/new?title=' +
      encodeURIComponent(t) +
      '&body=' +
      encodeURIComponent(b);
  }
  return u;
}

export function SuggestFAB({
  mode,
  topicSlug = '',
  topicTitle = '',
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [feedback, setFeedback] = useState('');
  const [feedbackOk, setFeedbackOk] = useState(true);
  const [showFields, setShowFields] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const heading =
    mode === 'topic'
      ? 'Suggest a topic'
      : `Suggest a prompt · ${topicTitle.slice(0, 48)}${topicTitle.length > 48 ? '…' : ''}`;

  function resetDialog() {
    setFeedback('');
    setFeedbackOk(true);
    setShowFields(true);
    setSubmitting(false);
  }

  function openDialog() {
    resetDialog();
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    const onClose = () => resetDialog();
    dlg.addEventListener('close', onClose);
    return () => dlg.removeEventListener('close', onClose);
  }, []);

  function openGithubDraft(form: HTMLFormElement) {
    const fd = new FormData(form);
    const footerDraft =
      '\n\n---\n_Sent via [100 prompts site](https://github.com/' +
      GITHUB_REPO +
      '). Not created until you submit on GitHub._';

    let title: string;
    let body: string;
    if (mode === 'topic') {
      const tit = String(fd.get('title') ?? '').trim();
      const bod = String(fd.get('body') ?? '').trim();
      if (!tit) return;
      title = 'Suggestion: new topic · ' + tit.slice(0, 100);
      body =
        '### Proposed topic\n' +
        tit +
        '\n\n### Notes\n' +
        (bod || '_none_') +
        footerDraft;
    } else {
      const pre = String(fd.get('pretitle') ?? '').trim();
      const pb = String(fd.get('body') ?? '').trim();
      if (!pb) return;
      title = 'Suggestion: new prompt · ' + (pre || topicTitle).slice(0, 80);
      body =
        '### Topic\n' +
        topicTitle +
        '\n**Slug:** `' +
        topicSlug +
        '`\n\n### Suggested row / prompt\n' +
        (pre ? '**Title:** ' + pre + '\n\n' : '') +
        pb +
        footerDraft;
    }
    window.open(buildGithubDraftUrl(title, body), '_blank', 'noopener,noreferrer');
    closeDialog();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    const apiPayload =
      mode === 'topic'
        ? {
            mode: 'topic' as const,
            title: String(fd.get('title') ?? '').trim(),
            notes: String(fd.get('body') ?? '').trim(),
          }
        : {
            mode: 'prompt' as const,
            topicTitle,
            topicSlug,
            pretitle: String(fd.get('pretitle') ?? '').trim(),
            promptBody: String(fd.get('body') ?? '').trim(),
          };

    if (mode === 'topic' && !apiPayload.title) return;
    if (mode === 'prompt' && !('promptBody' in apiPayload && apiPayload.promptBody))
      return;

    setSubmitting(true);
    setFeedback('');

    try {
      const resp = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiPayload),
      });
      const text = await resp.text();
      let json: { issueUrl?: string; error?: string } = {};
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        json = {};
      }

      if (resp.status === 503) {
        openGithubDraft(form);
        return;
      }

      if (resp.ok && json.issueUrl) {
        setFeedbackOk(true);
        setFeedback(
          `Created. <a class="underline decoration-accent/50 hover:text-accent" href="${escapeAttrHref(json.issueUrl)}" target="_blank" rel="noopener noreferrer">View issue</a>`,
        );
        setShowFields(false);
      } else {
        const msg =
          json.error === 'rate_limit'
            ? 'Too many attempts — try again later.'
            : json.error === 'invalid_payload'
              ? 'Invalid input.'
              : 'Could not create issue.';
        setFeedbackOk(false);
        setFeedback(msg);
        setSubmitting(false);
      }
    } catch {
      openGithubDraft(form);
    }
  }

  return (
    <>
      <button
        type="button"
        className="text-muted cursor-pointer text-[11px] tracking-wide underline decoration-transparent underline-offset-2 transition-colors hover:text-accent hover:decoration-accent/60"
        aria-haspopup="dialog"
        aria-controls="suggest-dialog"
        aria-label={
          mode === 'topic' ? 'Suggest a new topic' : 'Suggest a new prompt'
        }
        onClick={openDialog}
      >
        add
      </button>

      <dialog
        ref={dialogRef}
        id="suggest-dialog"
        className="fixed left-1/2 top-1/2 z-[100] w-[min(100%,28rem)] max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-muted/40 bg-surface p-6 text-text shadow-xl backdrop:bg-black/50 open:flex open:flex-col"
        onClick={(ev) => {
          if (ev.target === dialogRef.current) closeDialog();
        }}
      >
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-medium leading-snug tracking-tight text-text">
              {heading}
            </h2>
            <button
              type="button"
              className="text-muted -mr-1 -mt-1 shrink-0 rounded px-2 py-1 text-lg leading-none transition-colors hover:text-text"
              aria-label="Close"
              onClick={closeDialog}
            >
              ×
            </button>
          </div>
          {showFields && (
            <p className="text-[11px] leading-relaxed text-muted">
              Your suggestion is turned into a GitHub issue when the API is
              configured; otherwise this opens a GitHub draft.
            </p>
          )}
          {feedback ? (
            <p
              role="status"
              className={`text-[11px] leading-relaxed ${feedbackOk ? 'text-muted' : 'text-accent'}`}
              dangerouslySetInnerHTML={{ __html: feedback }}
            />
          ) : null}

          {showFields ? (
            <div className="flex flex-col gap-4">
              {mode === 'topic' ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="suggest-topic-title" className="text-[11px] text-muted">
                      Title (short)
                    </label>
                    <input
                      id="suggest-topic-title"
                      name="title"
                      required
                      maxLength={120}
                      autoComplete="off"
                      className="rounded-lg border border-muted/40 bg-void px-3 py-2 text-sm text-text outline-none ring-accent/30 transition-shadow focus:border-accent/50 focus:ring-2"
                      placeholder="e.g. MIT 8.04 Quantum Physics playlist"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="suggest-topic-body" className="text-[11px] text-muted">
                      Notes (links, why it fits, CSV source…)
                    </label>
                    <textarea
                      id="suggest-topic-body"
                      name="body"
                      rows={5}
                      maxLength={4000}
                      className="resize-y rounded-lg border border-muted/40 bg-void px-3 py-2 text-sm text-text outline-none ring-accent/30 transition-shadow focus:border-accent/50 focus:ring-2"
                      placeholder="Optional details"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="suggest-prompt-title" className="text-[11px] text-muted">
                      Suggested title (optional)
                    </label>
                    <input
                      id="suggest-prompt-title"
                      name="pretitle"
                      maxLength={200}
                      autoComplete="off"
                      className="rounded-lg border border-muted/40 bg-void px-3 py-2 text-sm text-text outline-none ring-accent/30 transition-shadow focus:border-accent/50 focus:ring-2"
                      placeholder="Short label or section title"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="suggest-prompt-body" className="text-[11px] text-muted">
                      Prompt text or source (YouTube URL, chapter, etc.)
                    </label>
                    <textarea
                      id="suggest-prompt-body"
                      name="body"
                      required
                      rows={5}
                      maxLength={4000}
                      className="resize-y rounded-lg border border-muted/40 bg-void px-3 py-2 text-sm text-text outline-none ring-accent/30 transition-shadow focus:border-accent/50 focus:ring-2"
                      placeholder="What should the new row say or link to?"
                    />
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg border border-accent/40 bg-accent/10 py-2.5 text-sm text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit suggestion'}
              </button>
            </div>
          ) : null}
        </form>
      </dialog>
    </>
  );
}
