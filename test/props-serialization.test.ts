import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';

const fx = fileURLToPath(new URL('../fixtures/serialize', import.meta.url));
const a = analyzeProject(fx);
const crossing = a.propsCrossings.find((c) => c.component === 'Client');
const verdictOf = (name: string) => crossing?.props.find((p) => p.name === name)?.verdict;

describe('serialization detectors (Ф3.1)', () => {
  it('flags exactly two hazards: class instance and symbol', () => {
    const hazards = a.propFindings.filter((f) => f.kind !== 'spread');
    expect(hazards).toHaveLength(2);
    expect(hazards.map((f) => f.kind).sort()).toEqual(['class-instance', 'symbol']);
  });

  it('flags new Thing() as class-instance', () => {
    expect(verdictOf('thing')).toBe('class-instance');
  });

  it('flags Symbol() as symbol', () => {
    expect(verdictOf('sym')).toBe('symbol');
  });

  it('does NOT flag React 19 serializable built-ins (Date, Map)', () => {
    expect(verdictOf('when')).toBe('ok');
    expect(verdictOf('lookup')).toBe('ok');
  });

  it('does NOT flag primitives or plain objects', () => {
    expect(verdictOf('label')).toBe('ok');
    expect(verdictOf('count')).toBe('ok');
    expect(verdictOf('config')).toBe('ok');
  });
});
