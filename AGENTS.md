# Agent notes (topics and prompts)

This file documents how curated topics are wired into the Astro site so changes stay consistent. **Skipping a step here has caused production bugs** (for example a topic listed in the manifest but missing from `topicBySlug`, which redirected `/topic/<slug>/` to `/`).

## Adding a new topic

Do **all** of the following; partial updates look fine locally but break routing or listings.

1. **`src/data/<slug>.json`**  
   Full topic document: `slug`, `topicTitle`, `courseLine`, `promptCount`, and `prompts` (each prompt needs a stable string `id`, `title`, `query`, optional `resourceUrls` as a string array for videos/docs/papers, etc.). The filename must be `<slug>.json` and match the `slug` field inside the file.

2. **`src/data/topics.manifest.json`**  
   Append a row with the same `slug`, human-readable `topicTitle`, `courseLine`, and `promptCount` (used on the home page and for static path generation).

3. **`src/lib/topic-registry.ts`**  
   Add `import … from '../data/<slug>.json'` and register `'<slug>': …Doc` on `topicBySlug`. Astro resolves topic pages from this map at build time; the manifest alone is **not** enough.

4. **Verify**  
   Run `npm run build` and confirm the log lists `/topic/<slug>/index.html` and `/topic/<slug>/prompt/<id>/index.html` for each prompt. If the topic index is missing from the log or you only see a redirect, re-check step 3.

## Editing prompts on an existing topic

- Change prompt content in **`src/data/<slug>.json`** only. Keep `id` values stable if the URLs are already in use; prompt URLs are `/topic/<slug>/prompt/<id>/`.
- If you add or remove prompts, update **`promptCount`** in both the topic JSON and the **`topics.manifest.json`** row for that slug so the UI stays accurate.

## Why there are two “sources” (and how they differ)

| Piece | Role |
|--------|------|
| `topics.manifest.json` | Lightweight list: drives the home page (`src/pages/index.astro`) and **`getStaticPaths`** for `/topic/[slug]/` (every manifest slug gets a static route candidate). |
| `topic-registry.ts` (`topicBySlug`) | Imports each full `src/data/<slug>.json` and supplies the data used to **render** topic and prompt pages. |

**Rendering guard:** `src/pages/topic/[slug].astro` redirects to `/` when `manifest` has the slug but `topicBySlug[slug]` is missing. Always keep manifest slugs and `topicBySlug` keys in sync.

**Prompt static paths:** `src/pages/topic/[slug]/prompt/[promptId].astro` only emits prompt routes when `topicBySlug[t.slug]` exists (`if (!topic) continue`). So a slug in the manifest without a registry entry can produce a broken topic index (redirect) and **no** prompt pages at all.

## API / explain index (related, not route rendering)

`scripts/build-prompt-index.ts` (run via `npm run build`) reads **`topics.manifest.json`** and, for each slug, **`src/data/<slug>.json`** on disk. It does **not** read `topic-registry.ts`. If the manifest references a slug but the JSON file is missing, that slug is skipped with a console warning and explain/API features for those prompts will be incomplete.

## Optional tooling

`scripts/import-topic.mjs` is a maintainer script for specific CSV-driven imports; new topics added by hand still require the checklist above unless that script is extended to update the registry and manifest automatically.
