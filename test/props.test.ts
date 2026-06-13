import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';

const demo = fileURLToPath(new URL('../fixtures/demo', import.meta.url));
const a = analyzeProject(demo);

describe('props across boundaries (Ф2.3)', () => {
  it('detects the page → ProductList crossing with both props', () => {
    expect(a.propsCrossings).toHaveLength(1);
    const x = a.propsCrossings[0];
    expect(x.file).toBe('app/page.tsx');
    expect(x.component).toBe('ProductList');
    expect(x.componentFile).toBe('components/ProductList.tsx');
    expect(x.props.map((p) => p.name).sort()).toEqual(['onSelect', 'products']);
  });

  it('flags the inline arrow function prop as a serialization hazard', () => {
    expect(a.propFindings).toHaveLength(1);
    const f = a.propFindings[0];
    expect(f.prop).toBe('onSelect');
    expect(f.kind).toBe('function');
    expect(f.message).toContain('not serializable');
  });

  it('keeps the data prop ok', () => {
    const products = a.propsCrossings[0].props.find((p) => p.name === 'products');
    expect(products?.verdict).toBe('ok');
  });

  it('does not flag server→server JSX (Header → Card) or client-internal JSX (ProductList → Button)', () => {
    expect(a.propsCrossings.filter((x) => x.component === 'Card')).toHaveLength(0);
    expect(a.propsCrossings.filter((x) => x.component === 'Button')).toHaveLength(0);
  });
});
