# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-13

First functional release.

### Added

- Server/client **boundary map** for the Next.js App Router, built by static
  analysis (TypeScript compiler API) — no app execution, no React internals.
- **Why-chains**: for every server-safe module that ends up in the client
  bundle, the exact import chain that pulled it across a `"use client"`
  boundary. Re-exports through barrel files are followed only for the names
  actually imported, matching bundler tree-shaking.
- **Bundle cost** per boundary: reads `.next/` client-reference manifests and
  attributes real KB (raw + gzip) to each client component, separating
  framework chunks from your own code.
- **Prop serialization checks** at each boundary: flags functions, class
  instances, and symbols before `next build` fails at prerender. Server
  Actions are recognized and allowed.
- **Server-only leak detection**: `server-only` code reachable from the client.
- `--explain <code>` — fix guides for common RSC errors.
- `--html [path]` — self-contained HTML report (no external assets).
- `--strict` — exit code `2` on a serialization hazard, for CI.
- `--json`, `--no-build`, `--no-color` flags.

[0.1.0]: https://github.com/TheSeydiCharyyev/rsc-xray/releases/tag/v0.1.0
