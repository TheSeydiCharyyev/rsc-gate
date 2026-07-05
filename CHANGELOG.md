# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `import('…')` and `next/dynamic(() => import('…'))` edges are now part of
  the import graph. Lazily loaded client subtrees — charts, modals, maps —
  used to vanish from the boundary map, why-chains, bundle cost and
  `server-only` leak detection without warning. A dynamic import behaves like
  `import * as`: it loads in the importer's environment and may use the whole
  namespace. Non-literal specifiers (`import(variable)`) are not statically
  knowable and are still skipped; `typeof import('…')` type positions never
  create edges; `/* webpackIgnore: true */` / `turbopackIgnore` imports are
  left alone — the bundler ships nothing for them.
- Bundled type declarations are back: `dist/index.d.ts` ships again, and
  package.json now declares `types` and an `exports` map (`.` →
  types/import + `./package.json`). Verified against consumers on all three
  TS resolution modes — `node16`, `nodenext`, `bundler` — plus a runtime
  smoke test from the packed tarball. (tsup injects `baseUrl` into its dts
  pass, which typescript@6 turns into a hard error — silenced via a
  dts-scoped `ignoreDeprecations`.)

### Fixed (false positives — the project's #1 principle)

- Bundle cost now works on dynamic routes. The client-reference-manifest key
  of a dynamic route contains `]` — `"/products/[id]/page"` — and the parser
  regex stopped at the first `]`, silently skipping the whole manifest, so
  `[id]`/`[...slug]` routes reported empty or `null` cost.
- Exact `paths` aliases — `"@/lib": ["./src/lib"]`, no `/*` — now resolve
  instead of being silently ignored. Semantics mirror tsc and Next's paths
  plugin: an exact match takes precedence over pattern aliases and is
  definitive (no pattern fallback on a miss), and `.d.ts`/`.d.mts`/`.d.cts`
  targets — types-only shims for untyped packages — are skipped, since Next
  bundles the real package, never the declaration file.
- tsconfig `"extends"` chains are now merged when loading `paths` aliases
  (config is loaded through the TypeScript compiler itself). Previously a
  preset/monorepo project declaring `@/*` in a base config lost every alias —
  the import graph collapsed to the entries alone and the report read as
  "all clean" (the worst kind of false result for a no-FP gate). `paths`
  without `baseUrl` now also resolve TS-4.1-style: relative to the config
  file that declares them. A syntactically broken tsconfig.json no longer
  crashes the analyzer on Windows — it degrades to no aliases.

- An orphan `"use client"` file — one no entry ever imports — is no longer
  reported as a `server-only` leak. A directive alone does not ship a module
  to the client; the leak is only real when the module is actually reachable
  from an app entry in the client environment. (Note: leak detection is now
  only as complete as the import graph — a client file the graph cannot reach
  is silent. Dynamic-import edges, `extends` chains and exact aliases are
  covered as of this release; the known remaining gap is `baseUrl`-only bare
  specifiers.)
- `export * as ns from './x'` is now followed correctly. It used to be
  recorded as a transparent wildcard AND a terminal local export — so the BFS
  stopped at the barrel (a client module behind it never got the client env,
  hiding its `server-only` leak), while plain named lookups could leak
  *through* the namespace (phantom edges). Now only the `ns` binding is
  importable, and requesting it pulls the whole source module.
- The serializable-constructor whitelist now matches what React 19 Flight
  actually accepts for Server→Client props (verified against
  `ReactFlightServer.js` @ react v19.0.0):
  - `new ArrayBuffer()`, typed arrays (`Uint8Array` & co.), `DataView`,
    `Blob`, `File`, `FormData` and `ReadableStream` are **no longer flagged**
    as non-serializable class instances.
  - `new RegExp()`, `new WeakMap()` and `new WeakSet()` are **now flagged** —
    React throws on them at render (they were wrongly whitelisted).
  - `new Error()` stays allowed: Flight serializes it (message redacted in
    production, the build does not fail).
  - `new URL()` stays flagged: React does not serialize URL instances.

## [0.1.0] — 2026-06-14

First release under the name **rsc-gate** (previously published as `rsc-xray`,
now deprecated and pointing here). Repositioned around catching boundary bugs
before build, in CI and the editor.

### Fixed (false positives — the project's #1 principle)

- A module-scope Server Action passed to a Client Component by reference is no
  longer flagged as a non-serializable prop.
- A wildcard re-export (`export * from …`) no longer marks an unrelated
  server-only sibling that shares the same barrel as client (no fake
  `server-only` leak).
- A page/layout that is itself `"use client"` is now analyzed in the client
  environment, so its boundaries and `server-only` leaks are detected.
- A server component reached through a wildcard barrel is no longer
  mis-attributed to the client file next to it.

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

[0.1.0]: https://github.com/TheSeydiCharyyev/rsc-gate/releases/tag/v0.1.0
