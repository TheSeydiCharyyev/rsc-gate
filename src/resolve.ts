import ts from 'typescript';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const SOURCE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'];

export interface Resolver {
  /** Returns an absolute file path for a local module, or null for externals/unresolved. */
  resolve(fromFile: string, specifier: string): string | null;
}

const isFile = (p: string): boolean => {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false; // fs race, or a path we may not read
  }
};

const isDir = (p: string): boolean => {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** A file, with or without an extension. Directories are handled separately. */
function tryFileOnly(base: string): string | null {
  for (const c of [base, ...SOURCE_EXTS.map((e) => base + e)]) if (isFile(c)) return c;
  return null;
}

/**
 * The conditions a bundler picks for a Next app, most specific first. `require`
 * comes last: it usually points at a CJS build, which is the least useful thing
 * to analyze when the ESM source is right there.
 */
const EXPORT_CONDITIONS = ['import', 'module', 'browser', 'default', 'require'];

/** Walk a package.json "exports" value down to a path, honouring conditions. */
function pickCondition(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = pickCondition(v);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const c of EXPORT_CONDITIONS) {
      if (c in obj) {
        const hit = pickCondition(obj[c]);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/**
 * The entry file of a package directory: its `exports` map, else `module`/`main`,
 * else an index file. Without this a workspace package — the normal way a monorepo
 * shares client components — resolved to nothing, so every component inside it,
 * and every leak inside those, was invisible.
 */
function packageEntry(pkgDir: string, subpath: string): string | null {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return null; // no package.json, or malformed — fall back to index
  }

  const exp = pkg.exports;
  if (exp !== undefined) {
    let target: unknown;
    if (typeof exp === 'string' || Array.isArray(exp)) {
      if (subpath === '.') target = exp;
    } else if (exp && typeof exp === 'object') {
      const map = exp as Record<string, unknown>;
      const keys = Object.keys(map);
      if (keys.some((k) => k.startsWith('.'))) {
        if (map[subpath] !== undefined) {
          target = map[subpath];
        } else {
          for (const k of keys) {
            const star = k.indexOf('*');
            if (star === -1) continue;
            const pre = k.slice(0, star);
            const post = k.slice(star + 1);
            if (!subpath.startsWith(pre) || !subpath.endsWith(post)) continue;
            const filled = subpath.slice(pre.length, subpath.length - post.length);
            const pattern = pickCondition(map[k]);
            if (pattern) target = pattern.replace('*', filled);
            break;
          }
        }
      } else if (subpath === '.') {
        target = exp; // a bare conditions map, e.g. { "import": "./src/index.tsx" }
      }
    }

    const rel = typeof target === 'string' ? target : pickCondition(target);
    // `exports` is authoritative: if it does not expose this subpath, nothing does.
    return rel ? tryFileOnly(resolve(pkgDir, rel)) : null;
  }

  for (const field of ['module', 'main']) {
    const v = pkg[field];
    if (typeof v === 'string') {
      const hit = tryFileOnly(resolve(pkgDir, v));
      if (hit) return hit;
    }
  }
  return null;
}

function tryFile(base: string): string | null {
  const direct = tryFileOnly(base);
  if (direct) return direct;
  if (!isDir(base)) return null;
  return packageEntry(base, '.') ?? tryFileOnly(join(base, 'index'));
}

/** tsconfig "paths" (prefix + exact) and bare-specifier resolution via "baseUrl". */
export function createResolver(projectRoot: string): Resolver {
  const aliases: { prefix: string; targets: string[] }[] = [];
  const exactAliases = new Map<string, string[]>();
  /**
   * Only an EXPLICIT baseUrl resolves bare specifiers — never the pathsBasePath
   * fallback, or every project would start resolving bare names against its own
   * folders and shadow real packages.
   */
  let bareBase: string | null = null;
  // A JS Next project configures its aliases in jsconfig.json — same shape, same
  // meaning. Reading only tsconfig.json meant every alias in such a project was
  // dropped, the graph collapsed to the entries, and the report came back empty.
  // tsconfig wins when both exist, as it does for Next and tsc: the project is a
  // TypeScript one and jsconfig is ignored.
  //
  // Forward slashes: TS normalizes paths in diagnostics, and a backslash path
  // makes it throw a Debug Failure on malformed JSON instead of degrading.
  const tsconfigPath = ['tsconfig.json', 'jsconfig.json']
    .map((name) => join(projectRoot, name).replaceAll('\\', '/'))
    .find((p) => existsSync(p));
  if (tsconfigPath) {
    // Load the config through TS itself so "extends" chains are merged (FP #9)
    // — presets/monorepos declare paths in a base config, and readConfigFile
    // alone would silently drop them (empty graph reads as "all clean").
    // readDirectory is stubbed: only compilerOptions matter here, not the
    // project file list, and this skips the include/exclude glob walk.
    const host: ts.ParseConfigFileHost = {
      ...ts.sys,
      readDirectory: () => [],
      onUnRecoverableConfigFileDiagnostic: () => {
        /* malformed tsconfig — fall back to no aliases */
      },
    };
    const co = ts.getParsedCommandLineOfConfigFile(tsconfigPath, undefined, host)?.options ?? {};
    // paths resolve against baseUrl when set, else against the directory of
    // the config file that declared them (TS 4.1+ semantics, pathsBasePath).
    const pathsBase = typeof co.pathsBasePath === 'string' ? co.pathsBasePath : projectRoot;
    const baseUrl = co.baseUrl ?? pathsBase;
    if (co.baseUrl !== undefined) bareBase = co.baseUrl;
    for (const [pattern, targets] of Object.entries(co.paths ?? {})) {
      if (pattern.endsWith('/*')) {
        aliases.push({
          prefix: pattern.slice(0, -1),
          targets: targets.map((t) => resolve(baseUrl, t.replace(/\*$/, ''))),
        });
      } else if (!pattern.includes('*')) {
        // Exact alias, e.g. "@/lib": ["./src/lib"] — matches the specifier as
        // a whole (FP #10: these were silently dropped). Declaration-file
        // targets (.d.ts type shims for untyped packages) are types-only:
        // Next's paths plugin skips them and bundles the real package, so
        // resolving them here would invent a phantom client-bundled module.
        exactAliases.set(
          pattern,
          targets.filter((t) => !/\.d\.(ts|mts|cts)$/.test(t)).map((t) => resolve(baseUrl, t)),
        );
      }
    }
  }

  return {
    resolve(fromFile, specifier) {
      if (specifier.startsWith('.')) {
        return tryFile(resolve(dirname(fromFile), specifier));
      }
      // TS gives an exact paths match precedence over pattern matches — and a
      // matched key is definitive: no fallback to pattern aliases on a miss
      // (tsc fails the resolution; Next falls back to node_modules — external
      // either way).
      const exact = exactAliases.get(specifier);
      if (exact) {
        for (const t of exact) {
          const hit = tryFile(t);
          if (hit) return hit;
        }
        return null;
      }
      let patternMatched = false;
      for (const { prefix, targets } of aliases) {
        if (specifier.startsWith(prefix)) {
          patternMatched = true;
          const rest = specifier.slice(prefix.length);
          for (const t of targets) {
            const hit = tryFile(join(t, rest));
            if (hit) return hit;
          }
        }
      }
      // A matched pattern is definitive too, exactly like an exact key: verified
      // against ts.resolveModuleName — with a dead target, tsc reports the module
      // unresolved even when baseUrl WOULD have found a file for that specifier.
      if (patternMatched) return null;

      // Bare specifier under an explicit baseUrl — 'components/Leaky' → ./components/Leaky.
      // A documented Next/TS feature, and previously a silent hole: the resolver
      // returned null, the graph collapsed to the entries, and the empty report
      // read as "all clean" — the worst way for this tool to be wrong.
      // Only a file that actually exists wins, so real packages stay external.
      // (Where a file does exist, it shadows a package — that is tsc's behaviour
      // too, not a liberty taken here.)
      if (bareBase) {
        const hit = tryFile(resolve(bareBase, specifier));
        if (hit) return hit;
      }

      // A workspace package: `@acme/ui` is a node_modules symlink back into the
      // repo, which is how a monorepo shares client components. Its real path is
      // inside the project, so its files are already in the graph — only the edge
      // was missing, and every leak behind it stayed invisible.
      //
      // The guard is what keeps this honest: a *third-party* package resolves
      // outside the project and stays external. We do not analyze node_modules.
      return workspaceFile(fromFile, specifier);
    },
  };

  function workspaceFile(fromFile: string, specifier: string): string | null {
    const scoped = specifier.startsWith('@');
    const parts = specifier.split('/');
    const name = scoped ? parts.slice(0, 2).join('/') : parts[0];
    const subpath = parts.slice(scoped ? 2 : 1).join('/');

    for (let dir = dirname(fromFile); ; ) {
      const pkgDir = join(dir, 'node_modules', name);
      if (isDir(pkgDir)) {
        const hit = subpath
          ? (packageEntry(pkgDir, './' + subpath) ?? tryFile(join(pkgDir, subpath)))
          : packageEntry(pkgDir, '.');
        if (!hit) return null;

        // Follow the symlink: the graph is keyed by the real files under the
        // project, not by the node_modules path that points at them.
        let real: string;
        try {
          real = realpathSync(hit);
        } catch {
          return null;
        }
        // Inside the project AND outside node_modules. A workspace package's real
        // files are repo source; a third-party package's are not, even though its
        // node_modules folder technically sits inside the project. We never
        // analyze node_modules.
        const inside = relative(projectRoot, real);
        if (!inside || inside.startsWith('..')) return null;
        return inside.split(/[\\/]/).includes('node_modules') ? null : real;
      }
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}
