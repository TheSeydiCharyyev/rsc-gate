import type { Analysis } from './analyze.js';
import type { BuildInfo } from './buildinfo.js';
import { EXPLANATIONS, type Explanation } from './explain.js';

const codes = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

export function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

export function renderExplanation(e: Explanation, opts: { color: boolean }): string {
  const c = (code: keyof typeof codes, s: string) => (opts.color ? codes[code] + s + codes.reset : s);
  const lines = [
    c('bold', e.title) + c('dim', `  [${e.code}]`),
    '',
    c('yellow', 'Symptom') + '  ' + e.symptom,
    '',
    c('cyan', 'Cause') + '    ' + e.cause,
    '',
    c('green', 'Fix') + '      ' + e.fix,
  ];
  if (e.docs) lines.push('', c('dim', `Docs: ${e.docs}`));
  return lines.join('\n');
}

export function renderExplanationList(opts: { color: boolean }): string {
  const c = (code: keyof typeof codes, s: string) => (opts.color ? codes[code] + s + codes.reset : s);
  return ['Known codes:', ...EXPLANATIONS.map((e) => `  ${c('cyan', e.code)}  ${c('dim', e.title)}`)].join('\n');
}

export interface RenderOptions {
  color: boolean;
  version: string;
  build?: BuildInfo | null;
}

export function renderReport(a: Analysis, opts: RenderOptions): string {
  const c = (code: keyof typeof codes, s: string) => (opts.color ? codes[code] + s + codes.reset : s);
  const lines: string[] = [];
  const build = opts.build ?? null;

  const clientModules = a.modules.filter((m) => m.directive === 'use client');
  const bundled = a.modules.filter((m) => !m.directive && m.envs.includes('client') && !m.pureReexport);
  const costOf = (file: string) => build?.moduleCosts.find((m) => m.file === file);

  lines.push(c('bold', `rsc-gate v${opts.version}`) + c('dim', ` — ${a.root}`));
  lines.push(
    '  ' +
      `${a.modules.length} modules · ` +
      c('cyan', `${clientModules.length} "use client"`) +
      ' · ' +
      c('yellow', `${bundled.length} client-bundled`) +
      ' · ' +
      `${a.boundaries.length} ${a.boundaries.length === 1 ? 'boundary' : 'boundaries'}` +
      (build ? ' · ' + c('bold', `${formatBytes(build.appBytes)} app client JS`) + c('dim', ` (gzip ${formatBytes(build.appGzipBytes)})`) : ''),
  );
  lines.push('');

  lines.push(c('bold', 'BOUNDARIES') + c('dim', '  server → client'));
  if (a.boundaries.length === 0) lines.push(c('dim', '  (none)'));
  for (const b of a.boundaries) {
    const from = b.chain.length >= 2 ? b.chain[b.chain.length - 2] : b.chain[0];
    const to = b.chain[b.chain.length - 1];
    const cost = costOf(to);
    // "ships 0 B" would be a lie when every chunk this module lives in is also
    // the framework's — we cannot size its code, but it is not free (#13).
    const costNote = !cost
      ? ''
      : cost.ownBytes > 0
        ? `  ${c('yellow', `ships ${formatBytes(cost.ownBytes)} app JS`)}`
        : cost.sharedBytes > 0
          ? `  ${c('yellow', 'co-bundled with framework')}`
          : '';
    lines.push(`  ${from} ${c('cyan', '→ ' + to)}  ${c('dim', `imports: ${b.names.join(', ')}`)}${costNote}`);
  }
  if (!build) lines.push(c('dim', '  (run `next build` to see per-boundary bundle cost)'));
  lines.push('');

  lines.push(c('bold', 'CLIENT-BUNDLED') + c('dim', '  no "use client", ships to the browser anyway — and here is why'));
  if (bundled.length === 0) lines.push(c('dim', '  (none)'));
  for (const m of bundled) {
    lines.push(`  ${c('yellow', m.file)}`);
    if (m.clientChain) {
      const last = m.clientChain.length - 1;
      const pretty = m.clientChain
        .map((f, i) => {
          const mod = a.modules.find((x) => x.file === f);
          return mod?.directive === 'use client' && i !== last ? `${f} ("use client")` : f;
        })
        .join('\n      → ');
      lines.push(c('dim', `      ${pretty}`));
    }
  }
  lines.push('');

  lines.push(c('bold', 'PROPS ACROSS BOUNDARIES') + c('dim', '  what server code hands to client components'));
  if (a.propsCrossings.length === 0) lines.push(c('dim', '  (none)'));
  for (const x of a.propsCrossings) {
    lines.push(`  ${x.file}:${x.line} ${c('cyan', `<${x.component}>`)} ${c('dim', `(${x.componentFile})`)}`);
    for (const p of x.props) {
      if (p.verdict === 'ok') {
        lines.push(c('dim', `      ${p.name}  ok`));
      } else {
        const finding = a.propFindings.find((f) => f.file === x.file && f.line === x.line && f.prop === p.name);
        const labels: Record<string, string> = {
          spread: 'cannot verify (spread)',
          function: 'function — NOT serializable',
          'function-ref': 'function — NOT serializable',
          'class-instance': 'class instance — NOT serializable',
          symbol: 'symbol — NOT serializable',
        };
        lines.push(`      ${p.name}  ${c('red', `✖ ${labels[p.verdict] ?? 'NOT serializable'}`)}`);
        if (finding && p.verdict !== 'spread') lines.push(c('dim', `         ${finding.message}`));
      }
    }
  }
  lines.push('');

  if (a.serverOnlyViolations.length > 0) {
    lines.push(c('bold', 'SERVER-ONLY LEAKS') + c('dim', '  server-only code reachable from the client bundle'));
    for (const v of a.serverOnlyViolations) {
      lines.push(`  ${c('red', v.clientFile)}  ${c('dim', `imports "${v.imports}"`)}`);
      lines.push(c('dim', `      ${v.message}`));
    }
    lines.push('');
  }

  if (build) {
    lines.push(c('bold', 'BUNDLE COST') + c('dim', `  from ${build.distDir}`));
    lines.push(
      `  app client JS: ${c('bold', formatBytes(build.appBytes))}` +
        c('dim', ` (gzip ${formatBytes(build.appGzipBytes)}) — chunks only your code is in`),
    );
    if (build.sharedBytes > 0) {
      lines.push(
        `  co-bundled with framework: ${c('bold', formatBytes(build.sharedBytes))}` +
          c('dim', ` (gzip ${formatBytes(build.sharedGzipBytes)}) — may include your code; not attributable`),
      );
    }
    for (const mc of build.moduleCosts) {
      const own = mc.chunks.filter((ch) => !ch.sharedWithFramework);
      const peers = [...new Set(own.flatMap((ch) => ch.sharedWith))];
      // A module with no own chunk at all is the #13 case: its code exists, but
      // it lives inside a framework chunk, so say that instead of billing 0 B.
      const head =
        own.length === 0 && mc.sharedBytes > 0
          ? `  ${c('cyan', mc.file)}  ${c('yellow', 'no chunk of its own')}` +
            c('dim', ` — its code sits inside ${formatBytes(mc.sharedBytes)} of framework chunks, not separable`)
          : `  ${c('cyan', mc.file)}  ${formatBytes(mc.ownBytes)}` +
            c('dim', ` own (gzip ${formatBytes(mc.ownGzipBytes)}) in ${own.length} chunk${own.length === 1 ? '' : 's'}`) +
            (peers.length > 0 ? c('dim', ` · chunk shared with ${peers.join(', ')}`) : '') +
            (mc.sharedBytes > 0 ? c('dim', ` · +${formatBytes(mc.sharedBytes)} co-bundled with framework`) : '');
      lines.push(head);
    }
    lines.push('');
  }

  lines.push(c('bold', 'MODULES'));
  for (const m of a.modules) {
    const tag =
      m.directive === 'use client'
        ? c('cyan', '[client]')
        : m.directive === 'use server'
          ? c('red', '[action]')
          : m.envs.length > 1
            ? c('yellow', '[shared]')
            : m.envs[0] === 'client'
              ? c('yellow', '[client*]')
              : c('green', '[server]');
    lines.push(`  ${tag} ${m.file}`);
  }
  if (bundled.length > 0 || a.modules.some((m) => m.envs.length > 1)) {
    lines.push('');
    lines.push(c('dim', '  [shared] = evaluated in BOTH environments  ·  [client*] = client-bundled without a directive'));
  }

  return lines.join('\n');
}
