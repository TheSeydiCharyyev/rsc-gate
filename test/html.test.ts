import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyze.js';
import { renderHtml } from '../src/html.js';

const demo = fileURLToPath(new URL('../fixtures/demo', import.meta.url));
const html = renderHtml(analyzeProject(demo), null, '0.0.1');

describe('--html report (Ф5.1)', () => {
  it('is a complete HTML document', () => {
    expect(html.toLowerCase()).toContain('<!doctype html');
    expect(html).toContain('</html>');
  });

  it('includes boundary content and module count', () => {
    expect(html).toContain('components/ProductList.tsx');
    expect(html).toContain('rsc-gate');
  });

  it('is self-contained: no external CSS/JS is loaded', () => {
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//i);
    expect(html).not.toContain('<script src');
  });

  it('has the expected report sections', () => {
    expect(html).toContain('Boundaries');
    expect(html).toContain('Client-bundled');
    expect(html).toContain('Modules');
  });

  it('escapes HTML metacharacters via esc()', () => {
    // A would-be injection in a path must come out escaped, never as a live tag.
    const inj = renderHtml({ ...analyzeProject(demo), root: '<script>x</script>' }, null, '0.0.1');
    expect(inj).toContain('&lt;script&gt;');
    expect(inj).not.toContain('<script>x</script>');
  });
});
