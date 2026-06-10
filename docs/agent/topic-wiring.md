# Topic wiring

## decided:

- New topics require **three** updates: `src/data/<slug>.json`, row in `src/data/topics.manifest.json`, import + key in `src/lib/topic-registry.ts` — see `AGENTS.md`
- Manifest-only slugs redirect `/topic/<slug>` to `/`; explain index build skips missing JSON with a warning
- Prompt URLs are stable: `/topic/<slug>/prompt/<id>` — keep prompt `id` values when editing content

## commands:

- `bun run build` — regenerates `data/prompt-index.json` and verifies production build
- `bun run dev` — local dev on port 3000
