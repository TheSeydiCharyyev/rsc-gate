# Concepts

rsc-xray reads your App Router source and (optionally) your `.next/` build, then
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
browser — because something the client imports pulls it in. rsc-xray shows the
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
does **not** drag the other exports into the client — rsc-xray follows re-exports
only for the names actually imported, matching tree-shaking. A naive analyzer
marks `Card` as client here; rsc-xray does not.

## Bundle cost

When a `next build` exists, rsc-xray reads the client-reference manifests and
attributes real bytes to each client component:

```text
BUNDLE COST  from ./.next
  app client JS: 664 B (gzip 400 B) — your code, framework chunks excluded
  components/ProductList.tsx  664 B own (gzip 400 B) in 1 chunk · chunk shared with components/ui/Button.tsx
```

Chunks referenced by framework client components (anything under `node_modules`)
are **excluded** from your numbers — you see the cost of your code, not React's.
Shared chunks are noted so two components aren't each charged the full size.

Run with `--no-build` to skip this and get the boundary map only.

## Prop serialization

Props handed from a Server Component to a Client Component must be serializable.
rsc-xray gives each prop a verdict:

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
(or runtime) will throw. rsc-xray flags it directly:

```text
SERVER-ONLY LEAKS  server-only code reachable from the client bundle
  components/Widget.tsx  imports "server-only"
```

This detector is intentionally conservative — importing a `"use server"` module
into a client component is the normal Server-Action pattern and is **not**
flagged.
