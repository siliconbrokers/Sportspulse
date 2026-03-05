# SportPulse

Snapshot-first sports attention dashboard. Transforms normalized football data into a deterministic, explainable treemap showing which teams deserve attention and why.

## Prerequisites

- Node.js 20+
- pnpm 9+

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

## Architecture

Strict unidirectional pipeline:

```
shared → canonical → signals → scoring → layout → snapshot → api → web
```

| Package | Responsibility |
|---------|---------------|
| `shared` | Domain primitives, IDs, enums, time utils |
| `canonical` | Provider ingestion, canonical models, normalization |
| `signals` | Signal computation from canonical data |
| `scoring` | Policy execution, score transforms, contributions |
| `layout` | Squarified treemap algorithm, geometry validation |
| `snapshot` | Build pipeline, caching, DTO assembly |
| `api` | Fastify endpoints, validation, error envelopes |
| `web` | React dashboard, treemap rendering, interactions |

## MVP Constraints

- Football only, single competition (La Liga)
- Mode B: Form + Agenda
- football-data.org as data source
- Backend-owned scoring and treemap geometry

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint all packages |
| `pnpm typecheck` | Type-check without emit |
| `pnpm format` | Format code with Prettier |
| `pnpm format:check` | Check formatting |
| `pnpm test:coverage` | Run tests with coverage |
