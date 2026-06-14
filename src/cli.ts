#!/usr/bin/env node
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { analyzeProject } from './analyze.js';
import { readBuildInfo } from './buildinfo.js';
import { renderReport, renderExplanation, renderExplanationList } from './report.js';
import { renderHtml } from './html.js';
import { findExplanation } from './explain.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));

// `--explain <code>` / `--html [path]` may consume the following token; keep
// those out of dirArg detection.
const explainIdx = args.indexOf('--explain');
const explainQuery = explainIdx !== -1 ? args[explainIdx + 1] : undefined;
const htmlIdx = args.indexOf('--html');
const htmlPathArg = htmlIdx !== -1 && args[htmlIdx + 1] && !args[htmlIdx + 1].startsWith('--') ? args[htmlIdx + 1] : undefined;
const consumed = new Set<number>();
if (explainIdx !== -1) consumed.add(explainIdx + 1);
if (htmlPathArg) consumed.add(htmlIdx + 1);
const positional = args.filter((a, i) => !a.startsWith('--') && !consumed.has(i));
const dirArg = positional[0];

const color = !flags.has('--no-color') && process.stdout.isTTY !== false && !process.env.NO_COLOR;

if (flags.has('--help') || flags.has('-h')) {
  console.log(
    [
      `rsc-gate v${version} — catch RSC boundary bugs before next build`,
      '',
      'Usage: npx rsc-gate [dir] [flags]',
      '',
      '  dir              Next.js App Router project root (default: cwd)',
      '  --json           machine-readable output',
      '  --no-color       plain text',
      '  --no-build       skip reading .next/ bundle-cost data',
      '  --strict         exit 2 when serialization hazards are found (CI gate)',
      '  --html [path]    write a self-contained HTML report (default: rsc-gate-report.html)',
      '  --explain <code> show a fix guide for a known RSC error',
    ].join('\n'),
  );
  process.exit(0);
}

if (flags.has('--explain')) {
  const found = explainQuery ? findExplanation(explainQuery) : null;
  if (found) {
    console.log(renderExplanation(found, { color }));
    process.exit(0);
  }
  console.error(`rsc-gate: no explanation for '${explainQuery ?? ''}'.`);
  console.error(renderExplanationList({ color }));
  process.exit(1);
}

const root = resolve(dirArg ?? '.');

try {
  const analysis = analyzeProject(root);
  const clientFiles = analysis.modules.filter((m) => m.directive === 'use client').map((m) => m.file);
  const build = flags.has('--no-build') ? null : readBuildInfo(root, clientFiles);

  if (flags.has('--json')) {
    console.log(JSON.stringify({ ...analysis, build }, null, 2));
  } else if (flags.has('--html')) {
    const out = resolve(htmlPathArg ?? 'rsc-gate-report.html');
    writeFileSync(out, renderHtml(analysis, build, version), 'utf8');
    console.log(`report written to ${out}`);
  } else {
    console.log(renderReport(analysis, { color, version, build }));
  }
  if (flags.has('--strict') && analysis.propFindings.some((f) => f.kind !== 'spread')) {
    process.exit(2);
  }
} catch (err) {
  console.error(`rsc-gate: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
