# Programmatic API

The same analysis the CLI runs is available as a library. Useful for custom CI
checks, editor integrations, or dashboards.

```ts
import { analyzeProject, readBuildInfo, renderHtml } from 'rsc-gate';

const analysis = analyzeProject('./my-app');

// boundaries
for (const b of analysis.boundaries) {
  console.log(b.chain.join(' → '), '| imports:', b.names.join(', '));
}

// serialization hazards (what --strict gates on)
const hazards = analysis.propFindings.filter((f) => f.kind !== 'spread');
if (hazards.length) process.exitCode = 2;

// server-only leaks
for (const v of analysis.serverOnlyViolations) {
  console.log(v.clientFile, 'imports', v.imports);
}
```

## `analyzeProject(root: string): Analysis`

Pure static analysis — does not run the app. Throws if `root` has no `app/` or
`src/app/` directory.

`root` may be relative or absolute; it is resolved against `process.cwd()`, and
`Analysis.root` comes back absolute either way.

```ts
interface Analysis {
  root: string;                     // absolute, however you spelled it
  appDir: string;
  entries: string[];
  modules: ModuleReport[];          // file, directive, envs, clientChain?, pureReexport?, opaqueExports?
  boundaries: Boundary[];           // chain, names
  propsCrossings: PropsCrossing[];  // every client-component JSX usage in server code
  propFindings: PropFinding[];      // the non-ok props
  serverOnlyViolations: ServerOnlyViolation[];
}
```

All `file` fields are POSIX paths relative to `root`.

## `readBuildInfo(root, clientFiles): BuildInfo | null`

Reads `.next/` client-reference manifests and attributes bundle bytes. Returns
`null` when there is no usable build. `clientFiles` is the list of `"use client"`
module paths (`analysis.modules.filter(m => m.directive === 'use client').map(m => m.file)`).

```ts
interface BuildInfo {
  distDir: string;
  appBytes: number;        // chunks only your code is in
  appGzipBytes: number;
  sharedBytes: number;     // chunks co-bundled with the framework — not in appBytes
  sharedGzipBytes: number;
  moduleCosts: ModuleCost[];
}

interface ModuleCost {
  file: string;
  ownBytes: number;        // 0 is possible — see below
  ownGzipBytes: number;
  sharedBytes: number;     // co-bundled with the framework, not attributable
  sharedGzipBytes: number;
  chunks: ChunkCost[];
}
```

A chunk a `node_modules` client module also references is **co-bundled**
(`ChunkCost.sharedWithFramework`). The manifest does not say how much of it is
yours, so its bytes are reported in `sharedBytes` and never added to `appBytes`.

This means `ownBytes` can legitimately be `0` while the module still ships: the
bundler put all of its code in a framework chunk. Check `sharedBytes` before
telling a user a component is free.

## Rendering helpers

```ts
import { renderReport, renderHtml } from 'rsc-gate';

renderReport(analysis, { color: false, version: '0.1.0', build });  // ANSI/plain string
renderHtml(analysis, build, '0.1.0');                                // self-contained HTML
```

## Explanations

```ts
import { EXPLANATIONS, findExplanation } from 'rsc-gate';

findExplanation('event-handlers');                       // by code
findExplanation('Event handlers cannot be passed');      // by symptom substring
```

Types are exported from the package root (`Analysis`, `Boundary`, `ModuleReport`,
`PropFinding`, `PropVerdict`, `ServerOnlyViolation`, `BuildInfo`, `Explanation`).
