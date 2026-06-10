# Agent notes (topics and prompts)

This file documents how curated topics are wired into the TanStack Start app so changes stay consistent. **Skipping a step here has caused production bugs** (for example a topic listed in the manifest but missing from `topicBySlug`, which redirects `/topic/<slug>` to `/`).

## Stack (for agents)

- **Runtime / package manager:** Bun (`bun install`, `bun run dev`, `bun run build`)
- **App:** TanStack Start (`src/routes/*`), Nitro output, React 19 + React Compiler
- **API:** Effect `HttpApi` in `packages/api`, domain logic in `packages/domain`
- **Client API:** `@effect-atom/atom-react` + `AtomHttpApi` (`src/lib/api-client.ts`)
- **UI:** Base UI wrappers under `src/components/ui/` (coss-compatible; see `components.json`)

## Adding a new topic

Do **all** of the following; partial updates look fine locally but break routing or listings.

1. **`src/data/<slug>.json`**  
   Full topic document: `slug`, `topicTitle`, `courseLine`, `promptCount`, and `prompts` (each prompt needs a stable string `id`, `title`, `query`, optional `resourceUrls` as a string array for videos/docs/papers, etc.). The filename must be `<slug>.json` and match the `slug` field inside the file.

2. **`src/data/topics.manifest.json`**  
   Append a row with the same `slug`, human-readable `topicTitle`, `courseLine`, and `promptCount` (used on the home page).

3. **`src/lib/topic-registry.ts`**  
   Add `import … from '../data/<slug>.json'` and register `'<slug>': …Doc` on `topicBySlug`. Route loaders resolve topics from this map; the manifest alone is **not** enough.

4. **Verify**  
   Run `bun run build` and confirm the build completes. Spot-check routes in the dev server or production output:
   - `/topic/<slug>`
   - `/topic/<slug>/prompt/<id>` for each prompt id  
   If the topic page redirects to `/`, re-check step 3.

## Editing prompts on an existing topic

- Change prompt content in **`src/data/<slug>.json`** only. Keep `id` values stable if the URLs are already in use; prompt URLs are `/topic/<slug>/prompt/<id>`.
- If you add or remove prompts, update **`promptCount`** in both the topic JSON and the **`topics.manifest.json`** row for that slug so the UI stays accurate.

## Why there are two “sources” (and how they differ)

| Piece | Role |
|--------|------|
| `topics.manifest.json` | Lightweight list: drives the home page (`src/routes/index.tsx`) and is the canonical slug list for tooling. |
| `topic-registry.ts` (`topicBySlug`) | Imports each full `src/data/<slug>.json` and supplies the data used to **render** topic and prompt pages via `@100pua/domain/topics` loaders. |

**Rendering guard:** `src/routes/topic.$slug.tsx` (and the prompt route) call `resolveTopic` / `resolvePrompt` with `topicBySlug`. If the manifest has a slug but `topicBySlug[slug]` is missing, the loader redirects to `/`. Always keep manifest slugs and `topicBySlug` keys in sync.

**Prompt routes:** `src/routes/topic.$slug.prompt.$promptId.tsx` only works when the topic exists in `topicBySlug`. A manifest-only slug produces a broken topic page (redirect) and no usable prompt data.

## API / explain index (related, not route rendering)

`scripts/build-prompt-index.ts` (run via `bun run build`) reads **`topics.manifest.json`** and, for each slug, **`src/data/<slug>.json`** on disk. It does **not** read `topic-registry.ts`. If the manifest references a slug but the JSON file is missing, that slug is skipped with a console warning and explain/API features for those prompts will be incomplete.

## Optional tooling

`scripts/import-topic.mjs` is a maintainer script for specific CSV-driven imports; new topics added by hand still require the checklist above unless that script is extended to update the registry and manifest automatically.

## UI components

Interactive surfaces use `src/components/ui/*` (Button, Dialog, Input, Textarea, ToggleGroup). Add more via `components.json` registries (`@coss`) or by extending the Base UI wrappers; keep styling aligned with tokens in `src/styles/global.css`.
