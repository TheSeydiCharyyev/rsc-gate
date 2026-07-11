import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';
import { parseManifestText, readBuildInfo } from '../src/buildinfo.js';

const SAMPLE = `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/page"] = {"moduleLoading":{"prefix":""},"clientModules":{` +
  `"[project]/myapp/node_modules/next/dist/esm/client/components/layout-router.js <module evaluation>":{"id":1,"name":"*","chunks":["/_next/static/chunks/fw.js"],"async":false},` +
  `"[project]/myapp/components/Widget.tsx <module evaluation>":{"id":2,"name":"*","chunks":["/_next/static/chunks/fw.js","/_next/static/chunks/app.js"],"async":false},` +
  `"[project]/myapp/components/Widget.tsx":{"id":2,"name":"*","chunks":["/_next/static/chunks/fw.js","/_next/static/chunks/app.js"],"async":false}}};`;

describe('parseManifestText', () => {
  const entries = parseManifestText(SAMPLE);

  it('dedupes "<module evaluation>" keys and strips the [project] prefix', () => {
    const widget = entries.find((e) => e.modulePath === 'myapp/components/Widget.tsx');
    expect(widget).toBeDefined();
    expect(widget!.chunks).toEqual(['/_next/static/chunks/fw.js', '/_next/static/chunks/app.js']);
    expect(entries.filter((e) => e.modulePath.includes('Widget'))).toHaveLength(1);
  });

  it('flags node_modules entries as framework', () => {
    const fw = entries.find((e) => e.fromNodeModules);
    expect(fw?.modulePath).toContain('layout-router');
  });
});

// FP #8: the manifest key of a dynamic route contains "]" — "/products/[id]/page".
// The old regex ([^\]]*) stopped at the first "]" and skipped the whole manifest.
const DYNAMIC_SAMPLE = `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/products/[id]/page"] = {"moduleLoading":{"prefix":""},"clientModules":{` +
  `"[project]/myapp/components/ProductCard.tsx":{"id":3,"name":"*","chunks":["/_next/static/chunks/product.js"],"async":false}}};
globalThis.__RSC_MANIFEST["/blog/[...slug]/page"] = {"clientModules":{` +
  `"[project]/myapp/components/PostBody.tsx":{"id":4,"name":"*","chunks":["/_next/static/chunks/post.js"],"async":false}}};`;

describe('parseManifestText — dynamic route keys (FP #8)', () => {
  const entries = parseManifestText(DYNAMIC_SAMPLE);

  it('parses a "[id]" dynamic-route manifest instead of silently skipping it', () => {
    const card = entries.find((e) => e.modulePath === 'myapp/components/ProductCard.tsx');
    expect(card).toBeDefined();
    expect(card!.chunks).toEqual(['/_next/static/chunks/product.js']);
  });

  it('parses a "[...slug]" catch-all manifest too', () => {
    const post = entries.find((e) => e.modulePath === 'myapp/components/PostBody.tsx');
    expect(post).toBeDefined();
    expect(post!.chunks).toEqual(['/_next/static/chunks/post.js']);
  });

  it('static-route keys still parse (no regression)', () => {
    expect(parseManifestText(SAMPLE).length).toBeGreaterThan(0);
  });
});

const nextDemo = fileURLToPath(new URL('../fixtures/next-demo', import.meta.url));
const hasBuild = existsSync(join(nextDemo, '.next', 'server', 'app'));

describe.skipIf(!hasBuild)('readBuildInfo on a real Next 16 build', () => {
  const info = readBuildInfo(nextDemo, ['components/ProductList.tsx', 'components/ui/Button.tsx'])!;

  it('matches both project client modules', () => {
    expect(info).not.toBeNull();
    expect(info.moduleCosts.map((m) => m.file).sort()).toEqual([
      'components/ProductList.tsx',
      'components/ui/Button.tsx',
    ]);
  });

  it('separates framework chunks from own app chunks', () => {
    const pl = info.moduleCosts.find((m) => m.file === 'components/ProductList.tsx')!;
    expect(pl.frameworkBytes).toBeGreaterThan(10_000); // shared framework runtime
    expect(pl.ownBytes).toBeGreaterThan(0);
    expect(pl.ownBytes).toBeLessThan(10_000); // our code is tiny
  });

  it('reports chunk sharing between project modules', () => {
    const pl = info.moduleCosts.find((m) => m.file === 'components/ProductList.tsx')!;
    const own = pl.chunks.filter((c) => !c.framework);
    expect(own.some((c) => c.sharedWith.includes('components/ui/Button.tsx'))).toBe(true);
  });

  it('computes app totals without double-counting shared chunks', () => {
    expect(info.appBytes).toBeGreaterThan(0);
    expect(info.appBytes).toBeLessThan(20_000);
    expect(info.appGzipBytes).toBeLessThan(info.appBytes);
  });
});

// #14: the suite above skips on a clean checkout — fixtures/next-demo/.next is
// gitignored — so bundle cost, one of the three features, shipped with no CI
// coverage at all. fixtures/frozen-build carries a committed .next snapshot, so
// everything below runs everywhere. No skipIf: if this cannot run, it must fail.
const frozen = fileURLToPath(new URL('../fixtures/frozen-build', import.meta.url));

// Sizes of the committed chunks. Exact on purpose: they are what proves cost is
// attributed to the right module. (.gitattributes pins `* -text` so core.autocrlf
// cannot make a Windows worktree disagree with Linux CI about these numbers.)
const FRAMEWORK_BYTES = 741;
const SHARED_BYTES = 345; // Card + Badge
const PRODUCT_BYTES = 211; // ProductCard, reached only via the [id] route

describe('readBuildInfo on the frozen build snapshot (#14)', () => {
  const analysis = analyzeProject(frozen);
  const clientFiles = analysis.modules.filter((m) => m.directive === 'use client').map((m) => m.file);
  const info = readBuildInfo(frozen, clientFiles)!;
  const cost = (file: string) => info.moduleCosts.find((m) => m.file === file)!;

  it('runs at all — the snapshot is committed, not gitignored', () => {
    expect(existsSync(join(frozen, '.next', 'server', 'app'))).toBe(true);
    expect(info).not.toBeNull();
  });

  it('matches every project client module through the analyzer, by path suffix', () => {
    // The manifest says "[project]/fixtures/frozen-build/components/Card.tsx";
    // the analyzer says "components/Card.tsx". The suffix match is the join.
    expect(clientFiles.sort()).toEqual([
      'components/Badge.tsx',
      'components/Card.tsx',
      'components/ProductCard.tsx',
    ]);
    expect(info.moduleCosts.map((m) => m.file).sort()).toEqual([
      'components/Badge.tsx',
      'components/Card.tsx',
      'components/ProductCard.tsx',
    ]);
  });

  it('never bills a node_modules module to the project', () => {
    expect(info.moduleCosts.some((m) => m.file.includes('node_modules'))).toBe(false);
    expect(info.moduleCosts.some((m) => m.file.includes('layout-router'))).toBe(false);
  });

  it('splits framework chunks from own chunks', () => {
    const card = cost('components/Card.tsx');
    expect(card.ownBytes).toBe(SHARED_BYTES);
    expect(card.frameworkBytes).toBe(FRAMEWORK_BYTES);

    const framework = card.chunks.find((c) => c.url.includes('framework-'))!;
    expect(framework.framework).toBe(true);
    expect(framework.bytes).toBe(FRAMEWORK_BYTES);

    const own = card.chunks.find((c) => c.url.includes('app-shared-'))!;
    expect(own.framework).toBe(false);
    expect(own.bytes).toBe(SHARED_BYTES);
  });

  it('reports the two modules that share a chunk, in both directions', () => {
    const shared = (file: string) =>
      cost(file).chunks.find((c) => c.url.includes('app-shared-'))!.sharedWith;
    expect(shared('components/Card.tsx')).toEqual(['components/Badge.tsx']);
    expect(shared('components/Badge.tsx')).toEqual(['components/Card.tsx']);

    // ProductCard is alone in its chunk — sharedWith must not invent a peer.
    expect(cost('components/ProductCard.tsx').chunks.find((c) => c.url.includes('product-'))!.sharedWith).toEqual(
      [],
    );
  });

  it('counts a shared chunk once in the app total', () => {
    // Card and Badge each carry the 345 B chunk, but the app ships it once.
    const perModule = info.moduleCosts.reduce((s, m) => s + m.ownBytes, 0);
    expect(perModule).toBe(SHARED_BYTES * 2 + PRODUCT_BYTES); // 901 — the naive sum
    expect(info.appBytes).toBe(SHARED_BYTES + PRODUCT_BYTES); // 556 — the honest one
    expect(info.appGzipBytes).toBeGreaterThan(0);
    expect(info.appGzipBytes).toBeLessThan(info.appBytes);
  });

  it('gives a dynamic [id] route a non-zero cost (FP #8 stays fixed)', () => {
    const product = cost('components/ProductCard.tsx');
    expect(product.ownBytes).toBe(PRODUCT_BYTES);
    expect(product.ownBytes).toBeGreaterThan(0);

    // The route is only reachable through the "/products/[id]/page" manifest key,
    // so a parser that chokes on the "]" reports this module at 0 B.
    const manifest = readFileSync(
      join(frozen, '.next', 'server', 'app', 'products', '[id]', 'page_client-reference-manifest.js'),
      'utf8',
    );
    expect(parseManifestText(manifest).some((e) => e.modulePath.endsWith('components/ProductCard.tsx'))).toBe(
      true,
    );
  });
});
