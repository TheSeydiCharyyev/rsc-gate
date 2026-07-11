# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed (false positives — the project's #1 principle)

- `require('./x')` is now an edge. CommonJS was not merely unparsed, it was
  *invisible*: with no edge, the required file never entered the import graph, so
  a `.cjs` that a client component pulls in — and that imports `server-only` —
  produced an empty, all-clear report. The worst possible failure for a tool
  whose job is to catch exactly that. A `require` behaves like `import * as`: it
  pulls the whole module and evaluates in the importer's environment.

  The other half of CommonJS is deliberately left unread. `module.exports` names
  are not extracted, so a named import *through* a `.cjs` still does not resolve
  — and the report says so (`[opaque — CommonJS exports not analyzed]`) rather
  than presenting the module as understood. Only literal specifiers create edges:
  `require(someVariable)` is not statically knowable, and `require.resolve('./x')`
  yields an id rather than loading a module, so neither is turned into one.

- Bundle cost no longer reports `0 B` for a client component that ships. A chunk
  was called "framework" — and dropped from every total — as soon as a single
  `node_modules` module referenced it. But the manifest lists the chunks a module
  *needs*, not the chunks that *hold its code*, so when the bundler co-bundles a
  component with vendor code, that component's only chunk is a "framework" one
  and it was billed at `0 B own`, `ships 0 B app JS`. Read as: this component is
  free. It is not.

  Co-bundled chunks are now their own category, next to own chunks and pure
  framework chunks. Their bytes are reported (`sharedBytes`, and a
  `co-bundled with framework — may include your code; not attributable` line)
  and still kept out of `appBytes`, which stays conservative. No byte-splitting
  heuristic was invented — the manifest cannot support one, so the report says
  what it does not know: `no chunk of its own — its code sits inside N of
  framework chunks, not separable`.

### Changed

- **Breaking (types).** `ChunkCost.framework` → `ChunkCost.sharedWithFramework`,
  and `ModuleCost.frameworkBytes` → `ModuleCost.sharedBytes` (plus
  `sharedGzipBytes`); `BuildInfo` gains `sharedBytes` / `sharedGzipBytes`. The
  old names claimed a certainty the data does not have — "framework" implied the
  chunk was *not yours*, when in truth it may be partly yours and unsplittable.
  `appBytes` is unchanged in both meaning and value.

### Added

- `fixtures/frozen-build/` — a committed snapshot of a Next build, so bundle
  cost is finally covered by CI. `fixtures/next-demo/` has a real `.next/`, but
  `.gitignore` keeps it out of the repository, so its tests were guarded by
  `skipIf` and simply never ran on a clean checkout: one of the tool's three
  features had **no CI coverage at all**. Confirmed by mutation — dropping
  `sharedWith`, billing framework chunks to the app, or double-counting a shared
  chunk in `appBytes` each left CI fully green before this fixture, and each
  fails now. The snapshot pins the framework/own split, chunk sharing between two
  modules, `appBytes` counting a shared chunk once, and a dynamic `[id]` route
  reporting a non-zero cost. `.gitattributes` marks it `-text`: the tests assert
  exact byte sizes, and `core.autocrlf` would otherwise have a Windows worktree
  and Linux CI disagree about every one of them.

### Changed

- The CLI now rejects an argument line it cannot honour instead of guessing.
  Previously every unrecognized `--flag` was accepted and then ignored, so
  `rsc-gate --stirct` — a typo — analyzed the project, found the hazard, and
  exited `0`: a CI gate that silently never fired. Unknown options, a value
  handed to a boolean flag (`--json=true`), a second positional argument and
  `--json --html` together are now errors with exit code `1`.

### Fixed

- `rsc-gate --html ./app` no longer swallows the project directory. `--html`
  takes an optional value, so a bare token after it was ambiguous; the old
  parser always consumed it, leaving the tool to analyze the *current*
  directory and then write its report to a path that was really a directory
  (`EISDIR`). A token is now read as the report path only when it ends in
  `.html`/`.htm`; anything else stays the `[dir]` argument. `--html=<path>`
  sets the path explicitly, whatever its extension, and pointing it at an
  existing directory is now a clear error rather than a stray `EISDIR`.
- `--json --html out.html` printed the JSON report and wrote no HTML: `--json`
  won the branch, and the requested file was dropped without a word. The
  combination is now rejected.
- `-h` works. It was checked for (`flags.has('-h')`) but never collected, as
  only `--`-prefixed tokens entered the flag set, so `rsc-gate -h` was parsed
  as a *directory named `-h`* and failed with "No app/ or src/app/ directory
  found under …/-h". A bare `--` is now the usual end-of-options separator.
- `--explain --json` reported `no explanation for '--json'`. `--explain` now
  refuses to read a following flag as its error code, and says
  `--explain expects an error code` when none was given.

Argument parsing moved to `src/args.ts` as a pure function, and is covered by
22 unit tests; `cli.ts` keeps only the I/O.

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
