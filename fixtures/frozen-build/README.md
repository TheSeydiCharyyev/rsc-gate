# frozen-build fixture

A **frozen snapshot of a Next.js build**, committed to git so that bundle-cost
analysis (`readBuildInfo`) is exercised on every CI run.

`fixtures/next-demo/` holds a *real* `.next/`, but `.gitignore` keeps it out of
the repository — so on a clean checkout its tests skip, and bundle cost, one of
the tool's three features, had no coverage at all (backlog #14).

Nothing here is generated at test time. The `.next/` tree is hand-written to
match what Next 16 emits, small enough to read:

| Chunk | Referenced by | Category |
|---|---|---|
| `app-shared-9b3e7d.js` | Card **and** Badge | own, shared between the two |
| `product-2c8f04.js` | ProductCard, via the `/products/[id]` dynamic route | own |
| `framework-4f2a1c.js` | `layout-router` (a `node_modules` module) **and** Card, Badge, ProductCard, Inline | co-bundled — not attributable (#13) |
| `vendor-only-7e5b13.js` | `layout-router` alone | framework — belongs in no total |

That layout is what makes the fixture worth having: it pins the own/co-bundled
split, `sharedWith`, `appBytes` counting a shared chunk exactly once, and a
dynamic-route manifest key (`"/products/[id]/page"` — the `]` that FP #8 used to
choke on) producing a non-zero cost.

`Inline.tsx` is the #13 case on its own: its **only** chunk is the framework's, so
it has no own bytes at all. It still ships. The report must say
`no chunk of its own`, never `0 B own` — which is what the old code said.

The tests assert **exact byte sizes**, so `.gitattributes` pins `* -text`: with
`core.autocrlf` on, git would otherwise hand a Windows worktree CRLF files and
Linux CI LF files, and the two would disagree on every size.

Editing a chunk changes its size and will fail `test/buildinfo.test.ts` — that is
the point. Update the expected numbers there deliberately.
