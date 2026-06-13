import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
