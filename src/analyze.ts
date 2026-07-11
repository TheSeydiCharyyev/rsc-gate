import { readdirSync, realpathSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseModule, type ParsedModule } from './parse.js';
import { analyzeProps, type PropFinding, type PropsCrossing } from './props.js';
import { createResolver, SOURCE_EXTS, type Resolver } from './resolve.js';

export type Env = 'server' | 'client';

export interface ModuleReport {
  file: string; // relative to root, posix separators
  directive: 'use client' | 'use server' | null;
  envs: Env[];
  /** For client-bundled modules (no directive): shortest import chain from an entry. */
  clientChain?: string[];
  /** Pure re-export barrel: no own code, ~0 bundle weight. */
  pureReexport?: boolean;
  /**
   * CommonJS: we follow `require()` edges into it, so it is in the graph and its
   * own imports are checked — but its `module.exports` names are not read, so a
   * named import *through* it does not resolve. Flagged rather than passed off
   * as fully analyzed (#11).
   */
  opaqueExports?: boolean;
}

export interface Boundary {
  /** Import chain from the entry to the "use client" module (inclusive). */
  chain: string[];
  /** Names imported across the boundary ('*' = namespace/side-effect). */
  names: string[];
}

export interface Analysis {
  root: string;
  appDir: string;
  entries: string[];
  modules: ModuleReport[];
  boundaries: Boundary[];
  /** JSX usages of client components inside server modules, with per-prop verdicts. */
  propsCrossings: PropsCrossing[];
  /** Serialization hazards: props that will fail to cross the boundary. */
  propFindings: PropFinding[];
  /** Server-only code reachable from the client bundle. */
  serverOnlyViolations: ServerOnlyViolation[];
}

export interface ServerOnlyViolation {
  /** Client module — reached in the client env (a directive alone does not ship it). */
  clientFile: string;
  /** Import specifier that triggered the violation. */
  imports: string;
  reason: 'server-only-package';
  message: string;
}

const SERVER_ONLY_PACKAGES = new Set(['server-only']);

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', '.turbo', 'coverage']);
const ENTRY_NAMES = /^(page|layout|template|loading|error|not-found|global-error|default|route)\.(tsx|ts|jsx|js)$/;

/**
 * Walk the project for source files, following symlinks the way a bundler does —
 * but only once each. Symlinked source directories are real in monorepos, so
 * skipping them would drop modules from the graph (a silent false negative). The
 * catch is that a link back into an ancestor is a cycle: the old walk recursed
 * into it until the OS gave up with ELOOP and the whole analysis died. Keying the
 * visited set on the *real* path breaks the cycle at the first repeat, and lets a
 * file reachable by two paths be analyzed once, not twice.
 */
function listSourceFiles(dir: string, seenDirs = new Set<string>()): string[] {
  let realDir: string;
  try {
    realDir = realpathSync(dir);
  } catch {
    return []; // broken link, or a directory we cannot read
  }
  if (seenDirs.has(realDir)) return [];
  seenDirs.add(realDir);

  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full); // follows links, like the bundler's resolver
    } catch {
      continue; // dangling symlink — nothing there to analyze
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...listSourceFiles(full, seenDirs));
    } else if (st.isFile() && SOURCE_EXTS.some((e) => full.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

interface Node {
  parsed: ParsedModule;
  envs: Set<Env>;
  clientChain?: string[];
  /** Re-export names already followed per env ('*' = all). */
  followed: Map<Env, Set<string> | '*'>;
}

interface WorkItem {
  file: string;
  env: Env;
  chain: string[];
  /** Which exports of this module the importer asked for. '*' = everything. */
  names: Set<string> | '*';
}

export function analyzeProject(projectRoot: string): Analysis {
  // Normalize at the door. listSourceFiles walks with join(root, …), so the node
  // map inherits the root's shape — while the resolver always hands back absolute
  // paths. A relative root therefore made every nodes.get(target) miss: each edge
  // was dropped, the graph collapsed to the entry files, and the report came back
  // empty — "all clean" for a project nobody had actually looked at. The CLI
  // resolves its argument, so only API callers ever hit it.
  const root = resolve(projectRoot);
  const appDir = ['app', join('src', 'app')].map((d) => join(root, d)).find((d) => existsSync(d));
  if (!appDir) throw new Error(`No app/ or src/app/ directory found under ${root}`);

  const resolver: Resolver = createResolver(root);
  const files = listSourceFiles(root);
  const nodes = new Map<string, Node>();
  for (const f of files) {
    nodes.set(f, { parsed: parseModule(f), envs: new Set(), followed: new Map() });
  }

  const rel = (f: string) => relative(root, f).replaceAll('\\', '/');
  const entries = files.filter((f) => f.startsWith(appDir) && ENTRY_NAMES.test(f.split(/[\\/]/).pop() ?? ''));

  // Does `file` (transitively) export `name`? Lets a named re-export be forwarded only
  // to the wildcard source that actually provides it, instead of every sibling barrel
  // (which would mark unrelated server modules as client — FP #2).
  const exportsName = (file: string, name: string, seen = new Set<string>()): boolean => {
    if (seen.has(file)) return false;
    seen.add(file);
    const n = nodes.get(file);
    if (!n) return false;
    if (n.parsed.localExportNames.has(name)) return true;
    for (const re of n.parsed.reexports) {
      const t = resolver.resolve(file, re.specifier);
      if (!t) continue;
      if (re.wildcard) {
        if (exportsName(t, name, seen)) return true;
      } else {
        const hit = re.named.find((e) => e.exported === name);
        if (hit && exportsName(t, hit.imported, seen)) return true;
      }
    }
    return false;
  };

  const boundaries: Boundary[] = [];
  const boundaryKeys = new Set<string>();
  // A page/layout that is itself "use client" starts in the client env (FP #3).
  const queue: WorkItem[] = entries.map((f) => ({
    file: f,
    env: nodes.get(f)?.parsed.directive === 'use client' ? 'client' : 'server',
    chain: [f],
    names: '*' as const,
  }));

  const push = (from: WorkItem, target: string, names: Set<string> | '*') => {
    const node = nodes.get(target);
    if (!node) return;
    let env = from.env;
    if (node.parsed.directive === 'use client' && from.env === 'server') {
      env = 'client';
      const chain = [...from.chain, target].map(rel);
      const nameList = names === '*' ? ['*'] : [...names].sort();
      const key = chain.join('>') + '|' + nameList.join(',');
      if (!boundaryKeys.has(key)) {
        boundaryKeys.add(key);
        boundaries.push({ chain, names: nameList });
      }
    }
    queue.push({ file: target, env, chain: [...from.chain, target], names });
  };

  while (queue.length > 0) {
    const item = queue.shift()!;
    const node = nodes.get(item.file);
    if (!node) continue;

    // Module evaluation: runs once per env. All plain imports execute.
    if (!node.envs.has(item.env)) {
      node.envs.add(item.env);
      if (item.env === 'client' && !node.parsed.directive && !node.clientChain) {
        node.clientChain = item.chain.map(rel);
      }
      for (const imp of node.parsed.imports) {
        const target = resolver.resolve(item.file, imp.specifier);
        if (!target) continue;
        const names: Set<string> | '*' = imp.namespace || imp.sideEffectOnly ? '*' : imp.names;
        push(item, target, names);
      }
    }

    // Re-export following: only for names actually requested (tree-shaking semantics).
    const followed = node.followed.get(item.env);
    if (followed === '*') continue;
    const done = followed ?? new Set<string>();

    const forward = (specifier: string, importedName: string | '*') => {
      const target = resolver.resolve(item.file, specifier);
      if (!target) return;
      push(item, target, importedName === '*' ? '*' : new Set([importedName]));
    };

    if (item.names === '*') {
      node.followed.set(item.env, '*');
      for (const re of node.parsed.reexports) {
        if (re.wildcard || re.ns !== undefined) forward(re.specifier, '*');
        else for (const n of re.named) forward(re.specifier, n.imported);
      }
    } else {
      const fresh = [...item.names].filter((n) => !done.has(n));
      if (fresh.length === 0) continue;
      for (const n of fresh) done.add(n);
      node.followed.set(item.env, done);
      for (const n of fresh) {
        // `export * as n from …`: the namespace object exposes the whole source —
        // requesting `n` must pull it, even though `n` is also a local export name.
        const nsSources = node.parsed.reexports.filter((re) => re.ns === n);
        if (nsSources.length > 0) {
          for (const re of nsSources) forward(re.specifier, '*');
          continue;
        }
        if (node.parsed.localExportNames.has(n)) continue; // defined here — terminal
        for (const re of node.parsed.reexports) {
          if (re.wildcard) {
            const t = resolver.resolve(item.file, re.specifier);
            if (t && exportsName(t, n)) forward(re.specifier, n); // only the source that has `n`
          } else {
            const hit = re.named.find((e) => e.exported === n);
            if (hit) forward(re.specifier, hit.imported);
          }
        }
      }
    }
  }

  const modules: ModuleReport[] = [...nodes.entries()]
    .filter(([, n]) => n.envs.size > 0)
    .map(([f, n]) => ({
      file: rel(f),
      directive: n.parsed.directive,
      envs: [...n.envs].sort() as Env[],
      ...(n.clientChain ? { clientChain: n.clientChain } : {}),
      ...(n.parsed.imports.length === 0 && n.parsed.localExportNames.size === 0 && n.parsed.reexports.length > 0
        ? { pureReexport: true }
        : {}),
      ...(n.parsed.commonjsExports ? { opaqueExports: true } : {}),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

  const { crossings, findings } = analyzeProps(nodes, resolver, rel);

  // server-only package imported from a module that runs in the client.
  // The module must actually be REACHED in the client env — a "use client"
  // directive alone is not enough: an orphan/WIP client file never ships,
  // so its server-only import cannot leak (FP #12). Flip side: detection is
  // only as complete as the import graph, so an edge the resolver cannot see is
  // a silent miss, not a gap to live with — hence extends chains, exact aliases,
  // dynamic imports, require() and bare baseUrl specifiers are all followed.
  const serverOnlyViolations: ServerOnlyViolation[] = [];
  for (const [f, n] of nodes) {
    if (!n.envs.has('client')) continue;
    for (const imp of n.parsed.imports) {
      // The specifier has to still BE the package. A project may alias
      // "server-only" to a local shim in tsconfig `paths` — the resolver follows
      // that, the graph shows the shim as an ordinary module, and nothing throws
      // at build. Matching the raw specifier flagged it anyway, so the report
      // contradicted its own module list and failed a healthy build.
      if (SERVER_ONLY_PACKAGES.has(imp.specifier) && resolver.resolve(f, imp.specifier) === null) {
        serverOnlyViolations.push({
          clientFile: rel(f),
          imports: imp.specifier,
          reason: 'server-only-package',
          message: `"${imp.specifier}" marks a module as server-only, but this module ships to the client — the import will throw at build/runtime`,
        });
      }
    }
  }
  serverOnlyViolations.sort((a, b) => a.clientFile.localeCompare(b.clientFile));

  return {
    root,
    appDir: rel(appDir),
    entries: entries.map(rel).sort(),
    modules,
    boundaries: boundaries.sort((a, b) => a.chain.join().localeCompare(b.chain.join())),
    propsCrossings: crossings,
    propFindings: findings,
    serverOnlyViolations,
  };
}
