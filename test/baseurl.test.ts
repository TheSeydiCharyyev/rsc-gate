import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';
import { createResolver } from '../src/resolve.js';

const fx = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

describe('bare specifiers under an explicit baseUrl', () => {
  const root = fx('baseurl-bare');
  const a = analyzeProject(root);
  const files = a.modules.map((m) => m.file);

  it('resolves them, instead of collapsing the graph to the entries', () => {
    // The failure this fixes: the resolver returned null, nothing but app/page.tsx
    // stayed in the graph, and the empty report read as "all clean".
    expect(files).toContain('components/Leaky.tsx');
    expect(files).toContain('components/Plain.tsx');
    expect(a.boundaries).toHaveLength(2);
  });

  it('catches the server-only leak that used to be invisible', () => {
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).toEqual(['components/Leaky.tsx']);
  });

  it('leaves real packages external', () => {
    // 'react' has no file under baseUrl, so it must not become a module.
    expect(files.some((f) => f.includes('react'))).toBe(false);
    expect(createResolver(root).resolve(`${root}/app/page.tsx`, 'react')).toBeNull();
  });

  it('does not fall back to baseUrl when a paths pattern matched but missed', () => {
    // 'dead/*' → './nowhere/*' (dead), yet ./dead/Ghost.tsx exists. tsc reports
    // the module unresolved rather than reaching for baseUrl — verified against
    // ts.resolveModuleName — so Ghost must stay out of the graph, leak and all.
    expect(files).not.toContain('dead/Ghost.tsx');
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).not.toContain('dead/Ghost.tsx');
    expect(JSON.stringify(a)).not.toContain('Ghost');
    expect(createResolver(root).resolve(`${root}/app/page.tsx`, 'dead/Ghost')).toBeNull();
  });
});

describe('without baseUrl, a bare specifier stays a package', () => {
  const root = fx('no-baseurl');
  const a = analyzeProject(root);

  it('does not resolve it against the project root', () => {
    // Same import as the fixture above, but no baseUrl — tsc would not resolve
    // it either, so inventing the edge would be a false positive.
    expect(a.modules.map((m) => m.file)).toEqual(['app/page.tsx']);
    expect(a.boundaries).toHaveLength(0);
    expect(a.serverOnlyViolations).toHaveLength(0);
    expect(createResolver(root).resolve(`${root}/app/page.tsx`, 'components/Leaky')).toBeNull();
  });
});

describe('baseUrl does not disturb the existing alias fixtures', () => {
  it('exact aliases still win and stay definitive (#10)', () => {
    const a = analyzeProject(fx('exact-alias'));
    expect(a.modules).toHaveLength(3);
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).toEqual(['src/components/Leaky.tsx']);
  });

  it('pattern aliases from an extended config still resolve (#9)', () => {
    const a = analyzeProject(fx('extends-alias'));
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).toEqual(['src/components/Leaky.tsx']);
  });

  it('the edge fixture, which sets baseUrl AND paths, is unchanged', () => {
    const a = analyzeProject(fx('edge'));
    expect(a.modules).toHaveLength(7);
    expect(a.boundaries).toHaveLength(2);
    expect(a.serverOnlyViolations).toHaveLength(0);
  });
});
