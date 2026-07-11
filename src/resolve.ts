import ts from 'typescript';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const SOURCE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'];

export interface Resolver {
  /** Returns an absolute file path for a local module, or null for externals/unresolved. */
  resolve(fromFile: string, specifier: string): string | null;
}

function tryFile(base: string): string | null {
  const candidates = [base, ...SOURCE_EXTS.map((e) => base + e), ...SOURCE_EXTS.map((e) => join(base, 'index' + e))];
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return c;
    } catch {
      /* ignore fs races */
    }
  }
  return null;
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

      return null; // external package
    },
  };
}
