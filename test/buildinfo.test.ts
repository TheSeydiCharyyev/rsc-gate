import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';
import { parseManifestText, readBuildInfo } from '../src/buildinfo.js';
import { renderReport } from '../src/report.js';

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
    expect(pl.sharedBytes).toBeGreaterThan(10_000); // shared framework runtime
    expect(pl.ownBytes).toBeGreaterThan(0);
    expect(pl.ownBytes).toBeLessThan(10_000); // our code is tiny
  });

  it('reports chunk sharing between project modules', () => {
    const pl = info.moduleCosts.find((m) => m.file === 'components/ProductList.tsx')!;
    const own = pl.chunks.filter((c) => !c.sharedWithFramework);
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
const FRAMEWORK_BYTES = 741; // co-bundled: layout-router + Card + Badge + ProductCard + Inline
const SHARED_BYTES = 345; // Card + Badge
const PRODUCT_BYTES = 211; // ProductCard, reached only via the [id] route
const VENDOR_ONLY_BYTES = 343; // referenced by layout-router alone — never ours

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
    const expected = [
      'components/Badge.tsx',
      'components/Card.tsx',
      'components/Inline.tsx',
      'components/ProductCard.tsx',
    ];
    expect(clientFiles.sort()).toEqual(expected);
    expect(info.moduleCosts.map((m) => m.file).sort()).toEqual(expected);
  });

  it('never bills a node_modules module to the project', () => {
    expect(info.moduleCosts.some((m) => m.file.includes('node_modules'))).toBe(false);
    expect(info.moduleCosts.some((m) => m.file.includes('layout-router'))).toBe(false);
  });

  it('splits co-bundled chunks from own chunks', () => {
    const card = cost('components/Card.tsx');
    expect(card.ownBytes).toBe(SHARED_BYTES);
    expect(card.sharedBytes).toBe(FRAMEWORK_BYTES);

    const framework = card.chunks.find((c) => c.url.includes('framework-'))!;
    expect(framework.sharedWithFramework).toBe(true);
    expect(framework.bytes).toBe(FRAMEWORK_BYTES);

    const own = card.chunks.find((c) => c.url.includes('app-shared-'))!;
    expect(own.sharedWithFramework).toBe(false);
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

  it('never charges the app for a chunk only the framework uses', () => {
    // vendor-only-7e5b13.js (343 B) is referenced by layout-router and nobody
    // else. It is not co-bundled with us — it belongs in no total, no module.
    const urls = info.moduleCosts.flatMap((m) => m.chunks.map((c) => c.url));
    expect(urls.some((u) => u.includes('vendor-only-'))).toBe(false);
    expect(existsSync(join(frozen, '.next', 'static', 'chunks', 'vendor-only-7e5b13.js'))).toBe(true);
    expect(statSync(join(frozen, '.next', 'static', 'chunks', 'vendor-only-7e5b13.js')).size).toBe(
      VENDOR_ONLY_BYTES,
    );
    // Neither total absorbs it: 556 stays 556, and shared is 741, not 1084.
    expect(info.appBytes).toBe(SHARED_BYTES + PRODUCT_BYTES);
    expect(info.sharedBytes).toBe(FRAMEWORK_BYTES);
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

  // #13: Inline.tsx was co-bundled into the framework chunk, so it has no chunk
  // of its own. It still ships. Reporting 0 B and nothing else is the lie.
  it('does not pretend a co-bundled module is free', () => {
    const inline = cost('components/Inline.tsx');
    expect(inline.chunks).toHaveLength(1);
    expect(inline.chunks[0].sharedWithFramework).toBe(true);
    expect(inline.ownBytes).toBe(0); // honest: we cannot size its code…
    expect(inline.sharedBytes).toBe(FRAMEWORK_BYTES); // …but we must not imply zero
  });

  it('says so in the report instead of printing "0 B"', () => {
    const text = renderReport({ ...analysis, root: frozen }, { color: false, version: '0.0.0', build: info });
    expect(text).toContain('co-bundled with framework');
    expect(text).toMatch(/Inline\.tsx\s+no chunk of its own/);
    // The boundary line must not claim it ships nothing.
    expect(text).not.toMatch(/Inline\.tsx.*ships 0 B/);
    expect(text).not.toMatch(/Inline\.tsx\s+0 B own/);
  });

  it('keeps co-bundled bytes out of the app total but still reports them', () => {
    expect(info.appBytes).toBe(SHARED_BYTES + PRODUCT_BYTES); // Inline adds nothing…
    expect(info.sharedBytes).toBe(FRAMEWORK_BYTES); // …but the bytes are not hidden
    expect(info.sharedGzipBytes).toBeGreaterThan(0);
    expect(info.sharedGzipBytes).toBeLessThan(info.sharedBytes);
  });
});

// A monorepo has more than one components/Button.tsx. Matching a manifest entry by
// the tail of its path collided: whichever came first won, so a component could be
// billed for a chunk belonging to an entirely different module.
describe('manifest paths are matched against the real path, not a tail', () => {
  const repo = mkdtempSync(join(tmpdir(), 'rsc-gate-monorepo-cost-'));
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const app = join(repo, 'apps', 'web');
  mkdirSync(join(app, '.next', 'server', 'app'), { recursive: true });
  mkdirSync(join(app, '.next', 'static', 'chunks'), { recursive: true });
  writeFileSync(
    join(app, '.next', 'server', 'app', 'page_client-reference-manifest.js'),
    'globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n' +
      'globalThis.__RSC_MANIFEST["/page"] = {"clientModules":{' +
      '"[project]/packages/ui/components/Button.tsx":{"id":1,"name":"*","chunks":["/_next/static/chunks/ui.js"],"async":false},' +
      '"[project]/apps/web/components/Button.tsx":{"id":2,"name":"*","chunks":["/_next/static/chunks/web.js"],"async":false}}};',
  );
  writeFileSync(join(app, '.next', 'static', 'chunks', 'ui.js'), 'X'.repeat(9000));
  writeFileSync(join(app, '.next', 'static', 'chunks', 'web.js'), 'Y'.repeat(300));

  const info = readBuildInfo(app, ['components/Button.tsx'])!;

  it('bills the app its own chunk, not the one from another package', () => {
    const cost = info.moduleCosts.find((m) => m.file === 'components/Button.tsx')!;
    expect(cost.chunks.map((c) => c.url)).toEqual(['/_next/static/chunks/web.js']);
    expect(cost.ownBytes).toBe(300); // was 9000 — packages/ui's chunk, 30× wrong
    expect(info.appBytes).toBe(300);
  });
});

// #13, in isolation: a project module whose ONLY chunk is one a node_modules
// module also references. The old code flagged that chunk "framework", filtered
// it out, and reported ownBytes = 0 — "0 B app client JS" for code that ships.
const COBUNDLED_SAMPLE = `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/page"] = {"clientModules":{` +
  `"[project]/app/node_modules/next/dist/esm/client/components/layout-router.js":{"id":1,"name":"*","chunks":["/_next/static/chunks/vendor.js"],"async":false},` +
  `"[project]/app/components/CoBundled.tsx":{"id":2,"name":"*","chunks":["/_next/static/chunks/vendor.js"],"async":false},` +
  `"[project]/app/components/Standalone.tsx":{"id":3,"name":"*","chunks":["/_next/static/chunks/own.js"],"async":false}}};`;

describe('co-bundled chunks are a category of their own (#13)', () => {
  const entries = parseManifestText(COBUNDLED_SAMPLE);
  const byPath = (needle: string) => entries.find((e) => e.modulePath.endsWith(needle))!;

  it('sees the vendor chunk in both the framework and the project module', () => {
    expect(byPath('layout-router.js').fromNodeModules).toBe(true);
    expect(byPath('layout-router.js').chunks).toEqual(['/_next/static/chunks/vendor.js']);

    const co = byPath('components/CoBundled.tsx');
    expect(co.fromNodeModules).toBe(false);
    // Its only chunk is the vendor one — there is nowhere else its code can be.
    expect(co.chunks).toEqual(['/_next/static/chunks/vendor.js']);
  });

  it('leaves a chunk no framework module touches as plainly ours', () => {
    expect(byPath('components/Standalone.tsx').chunks).toEqual(['/_next/static/chunks/own.js']);
  });
});
