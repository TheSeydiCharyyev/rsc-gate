#!/usr/bin/env node
import { resolve } from 'node:path';
import { statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { analyzeProject } from './analyze.js';
import { parseArgs } from './args.js';
import { readBuildInfo } from './buildinfo.js';
import { renderReport, renderExplanation, renderExplanationList } from './report.js';
import { renderHtml } from './html.js';
import { findExplanation } from './explain.js';
import { strictGate } from './gate.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`rsc-gate: ${parsed.error}`);
  console.error('run `rsc-gate --help` for usage.');
  process.exit(1);
}
const opts = parsed.options;

const color = !opts.noColor && process.stdout.isTTY !== false && !process.env.NO_COLOR;

if (opts.help) {
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
      '  --strict         exit 2 on serialization hazards or server-only leaks (CI gate)',
      '  --html [path]    write a self-contained HTML report (default: rsc-gate-report.html)',
      '                   the path must end in .html/.htm, or be given as --html=<path>',
      '  --explain <code> show a fix guide for a known RSC error',
      '  -h, --help       show this help',
    ].join('\n'),
  );
  process.exit(0);
}

if (opts.explain) {
  const found = opts.explainQuery ? findExplanation(opts.explainQuery) : null;
  if (found) {
    console.log(renderExplanation(found, { color }));
    process.exit(0);
  }
  console.error(
    opts.explainQuery
      ? `rsc-gate: no explanation for '${opts.explainQuery}'.`
      : 'rsc-gate: --explain expects an error code.',
  );
  console.error(renderExplanationList({ color }));
  process.exit(1);
}

const root = resolve(opts.dir ?? '.');

try {
  const analysis = analyzeProject(root);
  const clientFiles = analysis.modules.filter((m) => m.directive === 'use client').map((m) => m.file);
  const build = opts.noBuild ? null : readBuildInfo(root, clientFiles);

  if (opts.json) {
    console.log(JSON.stringify({ ...analysis, build }, null, 2));
  } else if (opts.html) {
    const out = resolve(opts.htmlPath);
    if (statSync(out, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`--html expects a file path, but '${opts.htmlPath}' is a directory`);
    }
    writeFileSync(out, renderHtml(analysis, build, version), 'utf8');
    console.log(`report written to ${out}`);
  } else {
    console.log(renderReport(analysis, { color, version, build }));
  }
  if (opts.strict && strictGate(analysis).failed) {
    process.exit(2);
  }
} catch (err) {
  console.error(`rsc-gate: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
