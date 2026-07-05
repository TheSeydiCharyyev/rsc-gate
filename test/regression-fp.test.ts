import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';

const fx = (name: string) => analyzeProject(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));

describe('FP #1 — module-scope Server Action passed by reference', () => {
  const a = fx('action-ref');
  it('is not flagged as a hazard', () => {
    expect(a.propFindings).toHaveLength(0);
  });
  it('the onSave crossing is verdict ok', () => {
    const c = a.propsCrossings.find((x) => x.component === 'Form');
    expect(c?.props.find((p) => p.name === 'onSave')?.verdict).toBe('ok');
  });
});

describe('FP #2 — wildcard re-export does not infect a server-only sibling', () => {
  const a = fx('wildcard-leak');
  const byFile = Object.fromEntries(a.modules.map((m) => [m.file, m]));
  it('ServerThing is never marked client', () => {
    expect(byFile['components/ServerThing.ts']?.envs ?? []).not.toContain('client');
  });
  it('produces no fake server-only violation', () => {
    expect(a.serverOnlyViolations).toHaveLength(0);
  });
  it('Helper IS legitimately client-bundled (the real, non-fake pull)', () => {
    expect(byFile['components/Helper.ts'].envs).toContain('client');
  });
});

describe('FP #3 — a "use client" page is treated as client', () => {
  const a = fx('client-entry');
  const byFile = Object.fromEntries(a.modules.map((m) => [m.file, m]));
  it('the entry page has the client env', () => {
    expect(byFile['app/page.tsx'].envs).toContain('client');
  });
  it('its server-only import is detected (would be missed if entry were server)', () => {
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).toContain('app/page.tsx');
  });
});

describe('FP #12 — orphan "use client" file is not a server-only leak', () => {
  const a = fx('orphan-leak');
  it('the unreachable Orphan.tsx is NOT flagged despite importing server-only', () => {
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).not.toContain('components/Orphan.tsx');
  });
  it('the reachable leak is still flagged (detector not over-silenced)', () => {
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).toEqual(['components/Reachable.tsx']);
  });
  it('the orphan never appears among analyzed modules (no env)', () => {
    expect(a.modules.map((m) => m.file)).not.toContain('components/Orphan.tsx');
  });
});

describe('namespace re-export — `export * as ns` is followed, not terminal', () => {
  const a = fx('ns-reexport');
  const byFile = Object.fromEntries(a.modules.map((m) => [m.file, m]));
  it('the client module behind the namespace barrel gets the client env', () => {
    expect(byFile['components/widgets.tsx']?.envs ?? []).toContain('client');
  });
  it('its server-only import is detected (was silently dropped)', () => {
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).toEqual(['components/widgets.tsx']);
  });
  it('the boundary through the barrel is recorded', () => {
    expect(a.boundaries.some((b) => b.chain.at(-1) === 'components/widgets.tsx')).toBe(true);
  });
});

describe('FP #9 — tsconfig "extends" chain is merged for paths aliases', () => {
  const a = fx('extends-alias');
  const byFile = Object.fromEntries(a.modules.map((m) => [m.file, m]));
  it('the "@/*" alias from the base config resolves (graph is not empty)', () => {
    expect(byFile['src/components/Leaky.tsx']?.envs ?? []).toContain('client');
  });
  it('the leak behind the inherited alias is detected (was an empty "all clean" report)', () => {
    expect(a.serverOnlyViolations.map((v) => v.clientFile)).toEqual(['src/components/Leaky.tsx']);
  });
  it('the boundary through the alias is recorded', () => {
    expect(a.boundaries.some((b) => b.chain.at(-1) === 'src/components/Leaky.tsx')).toBe(true);
  });
});

describe('malformed tsconfig.json — analyzer degrades instead of crashing', () => {
  it('does not throw on syntactically broken JSON (Windows Debug Failure regression)', () => {
    expect(() => fx('broken-tsconfig')).not.toThrow();
  });
  it('still analyzes the app entries', () => {
    expect(fx('broken-tsconfig').modules.map((m) => m.file)).toContain('app/page.tsx');
  });
});

describe('FP #4 — wildcard barrel does not mis-attribute a server component', () => {
  const a = fx('edge');
  it('the server-only <WidgetB> is not reported as a client-component crossing', () => {
    expect(a.propsCrossings.map((c) => c.component)).not.toContain('WidgetB');
  });
  it('every crossing points at the file that actually defines the component', () => {
    for (const c of a.propsCrossings) {
      expect(c.componentFile.toLowerCase()).toContain(c.component.toLowerCase());
    }
  });
});
