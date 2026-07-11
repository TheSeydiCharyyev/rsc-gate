# Concepts

rsc-gate reads your App Router source and (optionally) your `.next/` build, then
reports five things. This is what each one means.

## Boundaries

A **boundary** is the edge where a Server Component renders a Client Component —
the point a `"use client"` module is first reached from server code.

```text
BOUNDARIES  server → client
  app/page.tsx → components/ProductList.tsx  imports: ProductList  ships 664 B app JS
```

`imports:` lists the names that crossed the edge. `ships … app JS` appears when
a build is present (see [Bundle cost](#bundle-cost)).

## Client-bundled (why-chains)

A module with **no** `"use client"` directive can still be shipped to the
browser — because something the client imports pulls it in. rsc-gate shows the
exact chain:

```text
CLIENT-BUNDLED  no "use client", ships to the browser anyway — and here is why
  utils/format.ts
      app/page.tsx
      → components/ProductList.tsx ("use client")
      → utils/format.ts
```

`utils/format.ts` is a plain server-safe helper, but `ProductList` is a client
component and imports it, so it lands in the client bundle. This is the
"accidental clientization" that quietly grows bundles.

**Barrels are handled like the bundler.** A client component importing one name
from a barrel (`export { Button } from './Button'; export { Card } from './Card'`)
does **not** drag the other exports into the client — rsc-gate follows re-exports
only for the names actually imported, matching tree-shaking. A naive analyzer
marks `Card` as client here; rsc-gate does not.

## Bundle cost

When a `next build` exists, rsc-gate reads the client-reference manifests and
attributes real bytes to each client component:

```text
BUNDLE COST  from ./.next
  app client JS: 664 B (gzip 400 B) — chunks only your code is in
  co-bundled with framework: 56.5 KB (gzip 13.5 KB) — may include your code; not attributable
  components/ProductList.tsx  664 B own (gzip 400 B) in 1 chunk · chunk shared with components/ui/Button.tsx · +56.5 KB co-bundled with framework
```

A chunk is **yours** when no `node_modules` client module references it. Those are
the only bytes counted as app client JS — you see the cost of your code, not
React's. A chunk two of your components share is counted once, not twice.

A chunk that a framework module references **as well as** your code is a third
category: **co-bundled**. The manifest lists which chunks a module needs, not
which chunks hold its code, so when the bundler mixes your component in with
vendor code there is no honest way to split the bytes. rsc-gate does not guess:
those bytes are reported on their own line and left out of the app total.

The case worth knowing about: a component whose *only* chunk is co-bundled has
`0 B` of its own. It still ships. Earlier versions printed `0 B own` and left it
there, which read as "this component is free"; the report now says
`no chunk of its own — its code sits inside N of framework chunks, not separable`.

Run with `--no-build` to skip this and get the boundary map only.

## Prop serialization

Props handed from a Server Component to a Client Component must be serializable.
rsc-gate gives each prop a verdict:

| Verdict | Meaning |
|---------|---------|
| `ok` | serializable (primitives, plain objects, arrays, and React 19 built-ins like `Date`/`Map`/`Set`/`Promise`) |
| `function` / `function-ref` | a function — not serializable; `next build` fails at prerender. Pass a Server Action instead, or move the handler into the client component |
| `class-instance` | a `new Foo()` instance — pass plain data (a POJO) |
| `symbol` | a `Symbol()` — not serializable |
| `spread` | a `{...spread}` that can't be statically verified |

**Server Actions are allowed.** A function with a `"use server"` body, or one
imported from a `"use server"` module, is recognized as a legal prop and not
flagged.

`--strict` exits with code `2` when any non-spread hazard is found, so CI can
fail the build before prerender does.

## Server-only leaks

If a module that runs on the client imports the `server-only` package, the build
(or runtime) will throw. rsc-gate flags it directly:

```text
SERVER-ONLY LEAKS  server-only code reachable from the client bundle
  components/Widget.tsx  imports "server-only"
```

This detector is intentionally conservative — importing a `"use server"` module
into a client component is the normal Server-Action pattern and is **not**
flagged.

Leak detection is only as good as the import graph: a client module the graph
cannot reach is a module whose leaks are invisible. That is why edges the
analyzer cannot see are treated as bugs, not as acceptable gaps.

## Module resolution

The graph is only as good as the resolver: an import it cannot follow is a module
it cannot see, and a leak inside that module is one it cannot report. So the rules
match `tsc` deliberately, and were checked against `ts.resolveModuleName`:

1. **Relative** — `./x`, `../x`.
2. **Exact `paths` key** — `"@/lib": ["./src/lib"]`. Beats a pattern, and is
   **final**: if its target does not exist, the module is unresolved. There is no
   second guess.
3. **`paths` pattern** — `"@/*": ["./src/*"]`. Also final once matched.
4. **`baseUrl`** — with an explicit `baseUrl`, a bare `components/C` resolves to
   `./components/C`. Only if the file exists, so real packages stay external.
5. Otherwise the specifier is an external package.

Step 4 applies **only** to an explicit `baseUrl` in the config. And note what
steps 2–3 mean in practice: when a `paths` alias points somewhere that does not
exist, rsc-gate reports nothing rather than reaching for `baseUrl` — because that
is what tsc does, and a resolution tsc does not make is an edge the bundler will
not make either.

## CommonJS

`require('./x')` is an edge, and is followed. It pulls the whole module and runs
in the importer's environment, so a `.cjs` required from a client component ships
to the client — and if it imports `server-only`, that is a leak like any other.

What is *not* read is the other half of CommonJS: `module.exports` / `exports.x`.
So the names a `.cjs` exports are unknown to us, and a named import *through* one
does not resolve. Such a module is marked in the report rather than passed off as
understood:

```text
MODULES
  [client*] lib/secrets.cjs  [opaque — CommonJS exports not analyzed]
```

Only literal specifiers create edges. `require(someVariable)` is not statically
knowable, and `require.resolve('./x')` returns an id rather than loading a
module — inventing edges for either would mean guessing.
