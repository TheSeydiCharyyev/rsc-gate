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

/** Minimal tsconfig "paths" support: prefix patterns like "@/*": ["./*"]. */
export function createResolver(projectRoot: string): Resolver {
  const aliases: { prefix: string; targets: string[] }[] = [];
  // Forward slashes: TS normalizes paths in diagnostics, and a backslash path
  // makes it throw a Debug Failure on malformed JSON instead of degrading.
  const tsconfigPath = join(projectRoot, 'tsconfig.json').replaceAll('\\', '/');
  if (existsSync(tsconfigPath)) {
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
    for (const [pattern, targets] of Object.entries(co.paths ?? {})) {
      if (pattern.endsWith('/*')) {
        aliases.push({
          prefix: pattern.slice(0, -1),
          targets: targets.map((t) => resolve(baseUrl, t.replace(/\*$/, ''))),
        });
      }
    }
  }

  return {
    resolve(fromFile, specifier) {
      if (specifier.startsWith('.')) {
        return tryFile(resolve(dirname(fromFile), specifier));
      }
      for (const { prefix, targets } of aliases) {
        if (specifier.startsWith(prefix)) {
          const rest = specifier.slice(prefix.length);
          for (const t of targets) {
            const hit = tryFile(join(t, rest));
            if (hit) return hit;
          }
        }
      }
      return null; // bare specifier => external package
    },
  };
}
