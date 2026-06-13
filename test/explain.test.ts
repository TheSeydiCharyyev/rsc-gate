import { describe, expect, it } from 'vitest';
import { EXPLANATIONS, findExplanation } from '../src/explain.js';

describe('explain catalog (Ф3.2)', () => {
  it('finds an entry by exact code', () => {
    expect(findExplanation('event-handlers')?.code).toBe('event-handlers');
  });

  it('finds an entry by a substring of the symptom', () => {
    expect(findExplanation('Event handlers cannot be passed')?.code).toBe('event-handlers');
  });

  it('returns null for an unknown query', () => {
    expect(findExplanation('nonsense-xyz')).toBeNull();
    expect(findExplanation('')).toBeNull();
  });

  it('every entry has the required non-empty fields', () => {
    for (const e of EXPLANATIONS) {
      expect(e.code).toBeTruthy();
      expect(e.title).toBeTruthy();
      expect(e.symptom).toBeTruthy();
      expect(e.cause).toBeTruthy();
      expect(e.fix).toBeTruthy();
    }
  });

  it('has at least 6 entries and unique codes', () => {
    expect(EXPLANATIONS.length).toBeGreaterThanOrEqual(6);
    const codes = EXPLANATIONS.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('only uses https docs URLs when present (no invented http links)', () => {
    for (const e of EXPLANATIONS) {
      if (e.docs) expect(e.docs).toMatch(/^https:\/\/(react\.dev|nextjs\.org)\//);
    }
  });
});
