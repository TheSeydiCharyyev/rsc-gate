# rsc-xray

[![npm version](https://img.shields.io/npm/v/rsc-xray.svg)](https://www.npmjs.com/package/rsc-xray)
[![CI](https://github.com/TheSeydiCharyyev/rsc-xray/actions/workflows/ci.yml/badge.svg)](https://github.com/TheSeydiCharyyev/rsc-xray/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/rsc-xray.svg)](./LICENSE)

X-ray for React Server Components.

See exactly how many KB each `"use client"` ships to the browser — and **why** a server-safe module ended up in the client bundle, before React throws a cryptic boundary error.

![rsc-xray analyzing a Next.js App Router project](assets/demo.gif)

```text
rsc-xray v0.1.0 — ./my-app
  8 modules · 2 "use client" · 1 client-bundled · 1 boundary · 664 B app client JS (gzip 400 B)

BOUNDARIES  server → client
  app/page.tsx → components/ProductList.tsx  imports: ProductList  ships 664 B app JS

CLIENT-BUNDLED  no "use client", ships to the browser anyway — and here is why
  utils/format.ts
      app/page.tsx
      → components/ProductList.tsx ("use client")
      → utils/format.ts

PROPS ACROSS BOUNDARIES  what server code hands to client components
  app/page.tsx:10 <ProductList> (components/ProductList.tsx)
      products  ok
      onSelect  ✖ function — NOT serializable
```

## Usage

No install required — point it at a Next.js App Router project:

```bash
npx rsc-xray            # analyze the current directory
npx rsc-xray ./my-app   # analyze a specific project
```

Flags:

| Flag | Effect |
|------|--------|
| `--json` | machine-readable output |
| `--html [path]` | write a self-contained HTML report (default `rsc-xray-report.html`) |
| `--strict` | exit code `2` when a serialization hazard is found — for CI |
| `--no-build` | skip reading `.next/` (boundary map only, no bundle cost) |
| `--no-color` | plain text |
| `--explain <code>` | print a fix guide for a known RSC error |

## What it shows

- **Boundary map** — which modules are server, which are client, and where each `"use client"` boundary sits. Matches the build's own client-reference manifest.
- **Why a module is client-bundled** — the exact import chain that dragged a server-safe file across a `"use client"` boundary (the "accidental clientization" that quietly grows your bundle).
- **Bundle cost per boundary** — when a build exists, how many KB (and gzip) each client component ships, with framework chunks separated from your own code.
- **Prop serialization** — which props cross each boundary, flagging the ones that aren't serializable (functions, class instances, symbols) before `next build` fails at prerender. Server Actions are recognized and allowed.
- **Server-only leaks** — `server-only` code reachable from the client bundle.

## Why

The server/client boundary in the App Router is invisible in your editor, and crossing it the wrong way produces errors that don't point at the offending line. Server Components and Server Functions ranked among the most-disliked React features in the State of React 2025 survey, with serialization and "use client" cognitive overhead cited as recurring pain. rsc-xray makes the boundary — and its cost — visible.

## How it works

Pure static analysis over your source via the TypeScript compiler API — it does **not** run your app or hook into React internals. Re-exports through barrel files are followed only for the names actually imported, matching bundler tree-shaking, so a client export in a shared barrel doesn't falsely mark its server siblings as client.

With no build present it reports the boundary map and serialization checks. Run `next build` first (or drop `--no-build`) and it also reads `.next/` client-reference manifests to attribute real bundle bytes.

Works with the Next.js App Router on Next 15 and 16.

## Documentation

- [Concepts](docs/concepts.md) — what each section means (boundaries, why-chains, bundle cost, prop verdicts, server-only leaks).
- [Programmatic API](docs/api.md) — call the analyzer from Node instead of the CLI.
- [Architecture decisions](docs/decisions.md) — why it is static-analysis-first and how barrels are handled.

## CI

Fail a pull request when someone passes an unserializable prop across a boundary:

```yaml
- run: npx rsc-xray --strict
```

`--strict` exits `2` when a serialization hazard is found, `0` otherwise.

## License

MIT
