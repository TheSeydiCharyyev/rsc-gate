import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';

const edge = fileURLToPath(new URL('../fixtures/edge', import.meta.url));
const a = analyzeProject(edge);
const byFile = Object.fromEntries(a.modules.map((m) => [m.file, m]));

describe('src/app + route groups + dynamic routes', () => {
  it('finds entries inside (group) and [param] segments under src/app', () => {
    expect(a.entries).toContain('src/app/(marketing)/page.tsx');
    expect(a.entries).toContain('src/app/dashboard/[id]/page.tsx');
  });
});

describe('tsconfig path aliases (@/*)', () => {
  it('resolves aliased imports to client components', () => {
    expect(byFile['src/components/Chart.tsx'].directive).toBe('use client');
    expect(byFile['src/components/Chart.tsx'].envs).toEqual(['client']);
  });
});

describe('export * barrels with named-import tracking', () => {
  it('WidgetA (requested by dashboard) is client', () => {
    expect(byFile['src/components/widgets/WidgetA.tsx'].directive).toBe('use client');
    expect(byFile['src/components/widgets/WidgetA.tsx'].envs).toEqual(['client']);
  });

  it('WidgetB stays server-only even though it shares the wildcard barrel with WidgetA', () => {
    expect(byFile['src/components/widgets/WidgetB.tsx'].envs).toEqual(['server']);
  });
});

describe('default-export client components', () => {
  it('boundary detected for default import <Chart>', () => {
    const chartBoundary = a.boundaries.find((b) => b.chain.at(-1) === 'src/components/Chart.tsx');
    expect(chartBoundary).toBeDefined();
    expect(chartBoundary!.names).toContain('default');
  });
});

describe('Server Actions as props (must NOT be flagged)', () => {
  it('actions.ts is recognized as a "use server" module', () => {
    expect(byFile['src/lib/actions.ts'].directive).toBe('use server');
  });

  it('passing an imported Server Action to a client component produces zero findings', () => {
    expect(a.propFindings).toHaveLength(0);
  });

  it('the crossing itself is recorded with verdict ok', () => {
    const x = a.propsCrossings.find((c) => c.component === 'Chart');
    expect(x).toBeDefined();
    expect(x!.props.find((p) => p.name === 'onSave')?.verdict).toBe('ok');
  });
});
