import ts from 'typescript';
import { existsSync, readFileSync, statSync } from 'node:fs';
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
  const tsconfigPath = join(projectRoot, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    const cfg = ts.readConfigFile(tsconfigPath, (p) => readFileSync(p, 'utf8')).config as
      | { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }
      | undefined;
    const co = cfg?.compilerOptions;
    const baseUrl = resolve(projectRoot, co?.baseUrl ?? '.');
    for (const [pattern, targets] of Object.entries(co?.paths ?? {})) {
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
