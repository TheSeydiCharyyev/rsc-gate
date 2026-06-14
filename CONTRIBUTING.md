# Contributing

Thanks for your interest in rsc-gate. Bug reports, fixtures that reproduce a
real-world false positive, and focused fixes are all welcome.

## Development

```bash
npm install
npm test          # vitest, runs against fixtures/
npx tsc --noEmit  # type check
npm run build     # tsup → dist/
node dist/cli.js fixtures/demo --no-color
```

## Project layout

| Path | What it is |
|------|------------|
| `src/parse.ts` | per-module parse: directive, imports, re-exports, exports |
| `src/resolve.ts` | path resolution: relative + tsconfig `paths` |
| `src/analyze.ts` | the graph: env propagation, boundaries, why-chains, server-only leaks |
| `src/props.ts` | JSX prop analysis across boundaries |
| `src/buildinfo.ts` | `.next/` manifest parsing and bundle-cost attribution |
| `src/report.ts` / `src/html.ts` | CLI and HTML rendering |
| `src/explain.ts` | the `--explain` catalog |
| `fixtures/` | test projects (`demo`, `edge`, `serialize`, `next-demo`) |
| `docs/decisions.md` | architecture decision records |

## Principles

- **No false positives.** A wrong warning costs more trust than a missed one.
  React 19 serializes `Date`/`Map`/`Set`/`Promise` across the boundary — never
  flag those. New detectors must ship with a fixture proving the negative case.
- **Static-analysis-first.** The core must not run the app or hook into React
  internals. Reading `.next/` build output is fine and optional.
- **Match the bundler.** Follow re-exports only for the names actually
  imported, the way tree-shaking does.

## Pull requests

- One concern per PR.
- Add or update tests under `test/`; keep `npx tsc --noEmit` clean.
- Run the CLI on `fixtures/edge` and a real App Router project before pushing.
