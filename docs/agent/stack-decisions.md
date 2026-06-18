# Stack decisions

## 2025-06-10

- Audit vs techstack: ran `bun run format` (48 files were unformatted; CI `format:check` was failing)
- Added oxlint `no-restricted-imports` override on TSX for manual `useMemo`/`useCallback`/`memo` (warn only)
- Removed `submitSuggestionRequest` (`Effect.runPromise` bypass); `SuggestFAB` uses `submitSuggestionMutation` with `useAtomSet(..., { mode: 'promise' })`

## 2025-06-18

- Migrated app framework from TanStack Start (Vite + Nitro) to Next.js App Router
- Replaced `VITE_*` client env vars with `NEXT_PUBLIC_*`
- Page loaders became Server Components + client islands for interactive UI

## decided:

- Next.js App Router + React 19 + React Compiler — `next.config.ts`, `src/app/`
- Effect Platform `HttpApi` in `@100pua/api`; domain logic in `@100pua/domain`
- Client server-state via `@effect-atom/atom-react` + `AtomHttpApi` — `src/lib/api-client.ts`; not TanStack Query
- API routes mount handlers via `runHttpApiRequest` — `src/app/api/*/route.ts`
- UI: Base UI / coss-compatible wrappers under `src/components/ui/` — see `components.json`
- Bun workspaces monorepo: app at repo root, shared packages under `packages/*`
- Tooling: Bun + oxfmt + oxlint; extensionless relative imports everywhere (packages included)
- Topic data: dual wiring required — `src/data/topics.manifest.json` + `src/lib/topic-registry.ts` — see `AGENTS.md`

## open:

- Turborepo task graph not added; root scripts call `bun`/`oxlint`/`tsc` directly (small monorepo)
- `react-hooks-js/use-memo` rules unavailable in `eslint-plugin-react-hooks@5.2.0`; React Compiler enforces no manual memo instead
