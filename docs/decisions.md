# Architecture decisions

## ADR-001 — Core = static analysis; build manifests as optional ground truth (2026-06-12, Ф1)

**Spike setup:** handcrafted fixture (`fixtures/demo`) analyzed by `spike/analyze.mjs` (TS Compiler API), then the same code dropped into a real `create-next-app` (Next 16.2.9, Turbopack) at `fixtures/next-demo`, built, and compared against `.next/` output.

**Findings:**

1. **Boundary detection: static analysis matches the build 100%.** `page_client-reference-manifest.js` lists exactly the two `"use client"` modules (ProductList, Button) that the spike found. Manifest path format (Turbopack): `"[project]/<path> <module evaluation>"`.
2. **Why-chains are real:** `formatPrice` (server-safe util) verifiably shipped in a client chunk (`toFixed(2)` found in `.next/static/chunks/`) — pulled there solely by the ProductList `"use client"` import, exactly as the chain reported.
3. **Barrel re-exports get tree-shaken (CORRECTION to naive analysis).** The spike marked `Card.tsx` as `server+client` because ProductList imports `{ Button }` from the barrel which also re-exports Card. Reality: `"card"` className is in NO client chunk — Turbopack dropped it. **The analyzer must track NAMED imports through barrels (tree-shaking simulation), not blanket-follow re-exports.** Blanket following = false positives → instant credibility loss.
4. **Function-prop hazard is a build-breaker, not a runtime nit.** The planted `onSelect={fn}` prop killed `next build` at prerender with `Error: Event handlers cannot be passed to Client Component props` — no file path, no import chain in the error. Static pre-build detection (Ф3.1) has confirmed value.
5. Server content (`"Shop"`) does not leak into client chunks — sanity check passed.

**Decision:**

- **Core engine: static analysis** (TS Compiler API), zero Next runtime, zero React internals. Fast, works without a build, IDE/CI-friendly.
- **Named-export resolution through barrels is MVP-mandatory** (see finding 3).
- **Optional `--from-build` mode** reads `.next/server/app/*_client-reference-manifest.js` as ground truth to validate/annotate the static map; bundle-cost feature (Ф2.5) pairs manifest entries with `.next/static/chunks/` sizes.
- Keep the engine Next-adapter-based (manifest parsing isolated in an adapter) — RSC is spreading beyond Next (@vitejs/plugin-rsc, Waku); don't hard-couple core to Next.

**Versions pinned in fixture:** next@16.2.9 (Turbopack default), react 19.x.

## ADR-002 — Version matrix + real-world validation (2026-06-12, Ф4)

- **Next 15.5.19 verified** (separate scratch app, same fixture code): manifest keys use the same `"[project]/<path>"` format; path prefix differs by workspace root (suffix-matching in buildinfo handles both). Boundary + bundle-cost (695 B) correct. Matrix = Next 15/16 ✅.
- **Real-world run: shadcn-ui/taxonomy** (18k★, App Router, 95 modules): 22 boundaries, 17 client-bundled modules with correct why-chains (e.g. `ui/button.tsx` pulled client via `user-auth-form.tsx`), catch-all `[...slug]`/`[[...slug]]` segments handled, **0 false positives, 0 crashes, 0.75 s**.
- Edge fixture locks in: `src/app`, route groups `(name)`, dynamic `[id]`, tsconfig `@/*` aliases, `export *` barrels (named tracking holds), default-export client components, Server Actions passed as props (NOT flagged — both `'use server'` module imports and body-prologue forms).
- CI: ubuntu+windows × node 20/22 (Windows-first-class is a positioning point), typecheck + tests + build + fixture smoke runs + `--strict` gate assertion. Workflow committed, activates when the GitHub repo is created at launch.
