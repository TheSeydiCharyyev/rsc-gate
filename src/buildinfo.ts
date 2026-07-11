import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

export interface ManifestModule {
  /** Path as it appears in the manifest, '[project]/' stripped, posix. */
  modulePath: string;
  fromNodeModules: boolean;
  chunks: string[]; // chunk URLs like /_next/static/chunks/x.js
}

export interface ChunkCost {
  url: string;
  bytes: number;
  gzipBytes: number;
  /**
   * A node_modules client module references this chunk too, so the bundler may
   * have co-bundled project code into it — the manifest cannot tell us. Its
   * bytes are therefore never billed to the app (#13): they are reported
   * separately rather than silently dropped or silently charged.
   */
  sharedWithFramework: boolean;
  /** Other project "use client" modules sharing this chunk. */
  sharedWith: string[];
}

export interface ModuleCost {
  file: string; // analysis-relative posix path
  /** Chunks only this project's modules reference — definitely our code. */
  ownBytes: number;
  ownGzipBytes: number;
  /** Chunks co-bundled with the framework — may hold our code, not attributable. */
  sharedBytes: number;
  sharedGzipBytes: number;
  chunks: ChunkCost[];
}

export interface BuildInfo {
  distDir: string;
  /** Distinct own-chunk bytes across all matched modules. */
  appBytes: number;
  appGzipBytes: number;
  /** Distinct co-bundled-with-framework bytes. Not part of appBytes. */
  sharedBytes: number;
  sharedGzipBytes: number;
  moduleCosts: ModuleCost[];
}

/** Extract a balanced {...} JSON object starting at text[start] === '{'. */
function extractBalanced(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse a *_client-reference-manifest.js source into module → chunks entries. */
export function parseManifestText(text: string): ManifestModule[] {
  const byPath = new Map<string, ManifestModule>();
  // The key is a quoted route path and may itself contain "]" — e.g.
  // "/products/[id]/page" (FP #8: [^\]]* stopped at the first "]" and the
  // whole dynamic-route manifest was silently skipped). Match a complete
  // quoted string instead.
  const re = /globalThis\.__RSC_MANIFEST\[("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\]\s*=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = text.indexOf('{', m.index + m[0].length - 1);
    if (start === -1) continue;
    const raw = extractBalanced(text, start);
    if (!raw) continue;
    let obj: { clientModules?: Record<string, { chunks?: string[] }> };
    try {
      obj = JSON.parse(raw) as typeof obj;
    } catch {
      continue;
    }
    for (const [key, val] of Object.entries(obj.clientModules ?? {})) {
      const modulePath = key
        .replace(/ <module evaluation>$/, '')
        .replace(/^\[project\]\//, '')
        .replaceAll('\\', '/');
      const entry = byPath.get(modulePath) ?? {
        modulePath,
        fromNodeModules: modulePath.includes('node_modules/'),
        chunks: [],
      };
      for (const c of val.chunks ?? []) {
        if (typeof c === 'string' && c.endsWith('.js') && !entry.chunks.includes(c)) entry.chunks.push(c);
      }
      byPath.set(modulePath, entry);
    }
  }
  return [...byPath.values()];
}

function listManifestFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listManifestFiles(full));
    else if (name.endsWith('_client-reference-manifest.js')) out.push(full);
  }
  return out;
}

/**
 * Read .next build output and attribute client-chunk cost to the given
 * project "use client" modules (paths relative to the analyzed root, posix).
 * Returns null when there is no usable build.
 */
export function readBuildInfo(root: string, clientFiles: string[]): BuildInfo | null {
  const distDir = join(root, '.next');
  const manifests = listManifestFiles(join(distDir, 'server', 'app'));
  if (manifests.length === 0) return null;

  const modules = new Map<string, ManifestModule>();
  for (const f of manifests) {
    for (const entry of parseManifestText(readFileSync(f, 'utf8'))) {
      const prev = modules.get(entry.modulePath);
      if (prev) {
        for (const c of entry.chunks) if (!prev.chunks.includes(c)) prev.chunks.push(c);
      } else {
        modules.set(entry.modulePath, entry);
      }
    }
  }
  if (modules.size === 0) return null;

  // A chunk a node_modules client module references is not ours to bill. But if
  // a project module references it as well, the bundler may have co-bundled our
  // code into it, and the manifest does not say. Calling such a chunk "framework"
  // and dropping it (#13) reports "0 B" for code that does ship; calling it ours
  // overcharges. It gets its own category, and the report always names it.
  const frameworkChunks = new Set<string>();
  for (const m of modules.values()) {
    if (m.fromNodeModules) for (const c of m.chunks) frameworkChunks.add(c);
  }

  // Match manifest entries to analysis files.
  //
  // The manifest path is relative to the *workspace* root ("apps/web/components/
  // Button.tsx"), while an analysis file is relative to the app being analyzed
  // ("components/Button.tsx"). Matching on the tail alone collides in a monorepo:
  // packages/ui/components/Button.tsx ends with the same tail, and whichever came
  // first in the manifest won — so a component could be billed for a chunk that
  // belongs to an entirely different module. Match against the file's real path
  // instead, and when several entries are still tails of it, take the most
  // specific one.
  const rootPosix = root.replaceAll('\\', '/').replace(/\/+$/, '');
  const projectModules = [...modules.values()].filter((m) => !m.fromNodeModules);
  const isTailOf = (path: string, m: ManifestModule) => path === m.modulePath || path.endsWith('/' + m.modulePath);

  const matched = new Map<string, ManifestModule>(); // analysis file -> manifest entry
  for (const file of clientFiles) {
    const full = `${rootPosix}/${file}`;
    let hits = projectModules.filter((m) => isTailOf(full, m));

    // Fall back to the old tail match only if nothing lines up with the real path
    // — a manifest whose paths are rooted somewhere we cannot reconstruct.
    if (hits.length === 0) hits = projectModules.filter((m) => isTailOf(file, m));
    if (hits.length === 0) continue;

    const longest = Math.max(...hits.map((m) => m.modulePath.length));
    const best = hits.filter((m) => m.modulePath.length === longest);
    // Still tied: two entries we cannot tell apart. Attributing one of them would
    // be a guess, and a wrong cost is worse than a missing one.
    if (best.length === 1) matched.set(file, best[0]);
  }
  if (matched.size === 0) return null;

  const chunkSize = new Map<string, { bytes: number; gzipBytes: number }>();
  const sizeOf = (url: string) => {
    const cached = chunkSize.get(url);
    if (cached) return cached;
    const rel = url.replace(/^\/_next\//, '').split('/');
    const path = join(distDir, ...rel);
    let info = { bytes: 0, gzipBytes: 0 };
    try {
      const buf = readFileSync(path);
      info = { bytes: buf.length, gzipBytes: gzipSync(buf).length };
    } catch {
      /* chunk missing on disk — keep zeros */
    }
    chunkSize.set(url, info);
    return info;
  };

  const moduleCosts: ModuleCost[] = [];
  for (const [file, m] of matched) {
    const chunks: ChunkCost[] = m.chunks.map((url) => {
      const { bytes, gzipBytes } = sizeOf(url);
      const sharedWith = [...matched.entries()]
        .filter(([other, om]) => other !== file && om.chunks.includes(url))
        .map(([other]) => other);
      return { url, bytes, gzipBytes, sharedWithFramework: frameworkChunks.has(url), sharedWith };
    });
    const own = chunks.filter((c) => !c.sharedWithFramework);
    const shared = chunks.filter((c) => c.sharedWithFramework);
    moduleCosts.push({
      file,
      ownBytes: own.reduce((s, c) => s + c.bytes, 0),
      ownGzipBytes: own.reduce((s, c) => s + c.gzipBytes, 0),
      sharedBytes: shared.reduce((s, c) => s + c.bytes, 0),
      sharedGzipBytes: shared.reduce((s, c) => s + c.gzipBytes, 0),
      chunks,
    });
  }

  // Distinct chunks: two modules in one chunk must not double-count it.
  const distinctOwn = new Map<string, { bytes: number; gzipBytes: number }>();
  const distinctShared = new Map<string, { bytes: number; gzipBytes: number }>();
  for (const mc of moduleCosts) {
    for (const c of mc.chunks) {
      const into = c.sharedWithFramework ? distinctShared : distinctOwn;
      into.set(c.url, { bytes: c.bytes, gzipBytes: c.gzipBytes });
    }
  }
  const total = (m: Map<string, { bytes: number; gzipBytes: number }>, key: 'bytes' | 'gzipBytes') =>
    [...m.values()].reduce((s, c) => s + c[key], 0);

  return {
    distDir,
    appBytes: total(distinctOwn, 'bytes'),
    appGzipBytes: total(distinctOwn, 'gzipBytes'),
    sharedBytes: total(distinctShared, 'bytes'),
    sharedGzipBytes: total(distinctShared, 'gzipBytes'),
    // Sort by what the module actually costs us, own first, then the ambiguous
    // part — a co-bundled module must not sink to the bottom as if it were free.
    moduleCosts: moduleCosts.sort((a, b) => b.ownBytes - a.ownBytes || b.sharedBytes - a.sharedBytes),
  };
}
