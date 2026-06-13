// Ф1.2 spike: can we build the boundary map + why-chains from sources alone,
// with zero Next.js runtime? TypeScript compiler API, manual relative resolution.
// Usage: node spike/analyze.mjs fixtures/demo

import ts from 'typescript';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';

const root = resolve(process.argv[2] ?? 'fixtures/demo');
const EXT = ['.tsx', '.ts', '.jsx', '.js'];

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : listFiles(full);
    return EXT.some((e) => full.endsWith(e)) ? [full] : [];
  });
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // external package (react, next/*) — out of scope for the spike
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [base, ...EXT.map((e) => base + e), ...EXT.map((e) => join(base, 'index' + e))]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

function parse(file) {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let directive = null;
  const first = sf.statements[0];
  if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)) {
    const text = first.expression.text;
    if (text === 'use client' || text === 'use server') directive = text;
  }
  const imports = [];
  const reexports = [];
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      imports.push(st.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      reexports.push(st.moduleSpecifier.text);
    }
  }
  return { directive, imports, reexports };
}

// --- build graph ---
const files = listFiles(root);
const mods = new Map(); // abs path -> { directive, deps: [{to, viaReexport}], envs:Set, chains:[] }
for (const f of files) {
  const { directive, imports, reexports } = parse(f);
  const deps = [];
  for (const s of imports) {
    const to = resolveImport(f, s);
    if (to) deps.push({ to, viaReexport: false });
  }
  for (const s of reexports) {
    const to = resolveImport(f, s);
    if (to) deps.push({ to, viaReexport: true });
  }
  mods.set(f, { directive, deps, envs: new Set(), chains: [] });
}

const rel = (f) => relative(root, f).replaceAll('\\', '/');
const entries = files.filter((f) => /app[\\/](page|layout)\.(t|j)sx?$/.test(f));

// BFS: propagate environment; crossing into a 'use client' module flips env and records a boundary
const boundaries = [];
const queue = entries.map((f) => ({ file: f, env: 'server', chain: [rel(f)] }));
const seen = new Set();
while (queue.length) {
  const { file, env, chain } = queue.shift();
  const key = file + '|' + env;
  if (seen.has(key)) continue;
  seen.add(key);
  const m = mods.get(file);
  if (!m) continue;
  m.envs.add(env);
  if (env === 'client' && !m.directive) m.chains.push(chain);
  for (const { to } of m.deps) {
    const child = mods.get(to);
    if (!child) continue;
    let childEnv = env;
    if (child.directive === 'use client' && env === 'server') {
      childEnv = 'client';
      boundaries.push({ from: rel(file), to: rel(to) });
    }
    queue.push({ file: to, env: childEnv, chain: [...chain, rel(to)] });
  }
}

// barrel warning: server-env module importing a barrel that re-exports a client module
const warnings = [];
for (const [f, m] of mods) {
  if (!m.envs.has('server')) continue;
  for (const { to } of m.deps) {
    const dep = mods.get(to);
    if (!dep) continue;
    for (const d of dep.deps) {
      if (d.viaReexport && mods.get(d.to)?.directive === 'use client') {
        warnings.push(`${rel(f)} imports barrel ${rel(to)} which re-exports CLIENT module ${rel(d.to)} — tree-shaking dependent, potential accidental pull`);
      }
    }
  }
}

// --- report ---
console.log(`rsc-xray spike — ${rel(root) || root}\n`);
console.log('MODULES');
for (const [f, m] of [...mods].sort()) {
  const env = [...m.envs].join('+') || 'unreached';
  const tag = m.directive === 'use client' ? 'CLIENT (use client)' : env === 'server' ? 'server' : env;
  console.log(`  ${rel(f).padEnd(36)} ${tag}`);
}
console.log('\nBOUNDARIES (server -> client)');
for (const b of boundaries) console.log(`  ${b.from}  ->  ${b.to}`);
console.log('\nWHY IN CLIENT BUNDLE (no directive, pulled by a client module)');
for (const [f, m] of mods) {
  if (m.directive || !m.chains.length) continue;
  const shortest = m.chains.sort((a, b) => a.length - b.length)[0];
  console.log(`  ${rel(f)}\n    ${shortest.join('\n    -> ')}`);
}
console.log('\nWARNINGS');
for (const w of warnings.length ? warnings : ['  (none)']) console.log(`  ${w}`);
