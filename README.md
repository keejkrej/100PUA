# 100PUA

Curated prompt lists for courses, papers, and libraries — one page per topic, one page per prompt, with optional AI explain and GitHub-backed suggestions.

Built with [TanStack Start](https://tanstack.com/start), [Effect](https://effect.website/), [Bun](https://bun.sh/), and [Base UI](https://base-ui.com/) (coss-style primitives).

## Requirements

- [Bun](https://bun.sh/) 1.3.4 (see `.bun-version`)

## Commands

| Command | Action |
| :-- | :-- |
| `bun install` | Install dependencies |
| `bun run dev` | Dev server (Vite + TanStack Start) |
| `bun run build` | Build prompt index + production bundle |
| `bun start` | Run production server (`.output/server/index.mjs`) |
| `bun run typecheck` | TypeScript check |
| `bun run lint` | oxlint |
| `bun run format` | oxfmt |
| `bun run prewarm:explain` | Warm explain cache (optional) |

## Project layout

```text
src/
  routes/              TanStack file routes (/ , /topic/$slug , /topic/$slug/prompt/$promptId)
  routes/api/          Thin HTTP adapters → @100pua/api (Effect HttpApi)
  components/          UI (SuggestFAB, ExplainPrompt, ThemeToggle, ui/*)
  data/                Topic JSON + topics.manifest.json
  lib/topic-registry.ts  Imports every topic JSON for loaders
packages/
  domain/              Effect Schema, services, topic loaders
  api/                 HttpApi definition + handlers
data/
  prompt-index.json    Generated at build time (explain/API lookup)
```

## Environment

| Variable | Purpose |
| :-- | :-- |
| `CURSOR_API_KEY` | Enables `/api/explain-prompt` and on-page explain UI |
| `GITHUB_TOKEN` | Creates issues via `/api/suggestions` |
| `GITHUB_REPO` / `VITE_GITHUB_REPO` | Repo for suggestions (default `keejkrej/100PUA`) |
| `EXPLAIN_CACHE_DIR` | Optional persistent explain cache directory |

Copy `.env.example` if present, or set vars in Render (see `render.yaml`).

## Deploy

[Render](https://render.com/) blueprint in `render.yaml`: `bun install`, `bun run build`, `bun start`, health check `/api/health`.

## Maintainer docs

See [AGENTS.md](./AGENTS.md) for the topic/prompt checklist and routing guards.
