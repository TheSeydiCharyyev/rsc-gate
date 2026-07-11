import type { Analysis } from './analyze.js';
import type { BuildInfo, ModuleCost } from './buildinfo.js';
import { formatBytes } from './report.js';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

const STYLE = `
:root { color-scheme: light dark; --bg:#fff; --fg:#1a1a1a; --dim:#666; --line:#e3e3e3; --card:#f7f7f8; --cyan:#0a7ea4; --yellow:#9a6b00; --red:#c0392b; --green:#1e7e45; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1115; --fg:#e6e6e6; --dim:#9aa0a6; --line:#262a31; --card:#171a21; --cyan:#39b6d8; --yellow:#e0b341; --red:#ff6b5e; --green:#54d18c; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; padding:2rem; }
.wrap { max-width:1000px; margin:0 auto; }
h1 { font-size:1.4rem; margin:0 0 .25rem; }
h2 { font-size:.8rem; letter-spacing:.08em; text-transform:uppercase; color:var(--dim); margin:2rem 0 .6rem; border-bottom:1px solid var(--line); padding-bottom:.3rem; }
.lede { font-size:1.05rem; margin:.2rem 0 1.5rem; }
.lede b { color:var(--cyan); }
.dim { color:var(--dim); }
.card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:.7rem .9rem; margin:.5rem 0; }
.chain { color:var(--dim); margin:.35rem 0 0 1rem; white-space:pre-wrap; }
.chain b { color:var(--fg); }
table { width:100%; border-collapse:collapse; }
td,th { text-align:left; padding:.3rem .5rem; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--dim); font-weight:600; }
.ok { color:var(--green); } .bad { color:var(--red); font-weight:600; }
.tag { display:inline-block; padding:0 .4rem; border-radius:4px; font-size:.78rem; border:1px solid var(--line); }
.t-client { color:var(--cyan); } .t-server { color:var(--green); } .t-shared,.t-clientstar { color:var(--yellow); } .t-action { color:var(--red); }
code { color:var(--cyan); }
footer { margin-top:2.5rem; color:var(--dim); font-size:.8rem; }
`;

export function renderHtml(a: Analysis, build: BuildInfo | null, version: string): string {
  const clientModules = a.modules.filter((m) => m.directive === 'use client');
  const bundled = a.modules.filter((m) => !m.directive && m.envs.includes('client') && !m.pureReexport);
  const costOf = (file: string) => build?.moduleCosts.find((m) => m.file === file);

  const lede = build
    ? `<b>${formatBytes(build.appBytes)}</b> of app client JS across <b>${a.boundaries.length}</b> server→client ${a.boundaries.length === 1 ? 'boundary' : 'boundaries'} <span class="dim">(gzip ${formatBytes(build.appGzipBytes)})</span>` +
      (build.sharedBytes > 0
        ? ` <span class="dim">+ ${formatBytes(build.sharedBytes)} co-bundled with framework, not attributable</span>`
        : '')
    : `<b>${clientModules.length}</b> "use client" modules across <b>${a.boundaries.length}</b> ${a.boundaries.length === 1 ? 'boundary' : 'boundaries'} — run <code>next build</code> for bundle cost`;

  // "0 B" would read as free for a module whose only chunk is the framework's.
  const ownCell = (cost: ModuleCost | undefined) => {
    if (!cost) return '<span class="dim">—</span>';
    if (cost.ownBytes === 0 && cost.sharedBytes > 0) {
      return `<span class="dim">co-bundled (${formatBytes(cost.sharedBytes)})</span>`;
    }
    return formatBytes(cost.ownBytes);
  };

  const boundaryRows = a.boundaries
    .map((b) => {
      const from = b.chain.length >= 2 ? b.chain[b.chain.length - 2] : b.chain[0];
      const to = b.chain[b.chain.length - 1];
      return `<tr><td>${esc(from)}</td><td><code>${esc(to)}</code></td><td class="dim">${esc(b.names.join(', '))}</td><td>${ownCell(costOf(to))}</td></tr>`;
    })
    .join('');

  const bundledCards = bundled
    .map((m) => {
      const chain = m.clientChain
        ? `<div class="chain">${m.clientChain
            .map((f, i) => {
              const mod = a.modules.find((x) => x.file === f);
              const isClient = mod?.directive === 'use client' && i !== m.clientChain!.length - 1;
              return (i > 0 ? '→ ' : '') + (isClient ? `<b>${esc(f)}</b> ("use client")` : esc(f));
            })
            .join('\n')}</div>`
        : '';
      return `<div class="card"><b>${esc(m.file)}</b>${chain}</div>`;
    })
    .join('');

  const propRows = a.propsCrossings
    .flatMap((x) =>
      x.props.map((p) => {
        const cls = p.verdict === 'ok' ? 'ok' : 'bad';
        const label = p.verdict === 'ok' ? 'ok' : `${esc(p.verdict)} — not serializable`;
        return `<tr><td><code>${esc(x.component)}</code> <span class="dim">${esc(x.file)}:${x.line}</span></td><td>${esc(p.name)}</td><td class="${cls}">${label}</td></tr>`;
      }),
    )
    .join('');

  const leakCards = a.serverOnlyViolations
    .map((v) => `<div class="card"><b class="bad">${esc(v.clientFile)}</b> <span class="dim">imports "${esc(v.imports)}"</span><div class="chain">${esc(v.message)}</div></div>`)
    .join('');

  const noteCards = a.notes
    .map((n) => `<div class="card"><b>${esc(n.file)}</b><div class="chain">${esc(n.message)}</div></div>`)
    .join('');

  const costRows = build
    ? build.moduleCosts
        .map((mc) => {
          const own = mc.chunks.filter((ch) => !ch.sharedWithFramework);
          const peers = [...new Set(own.flatMap((ch) => ch.sharedWith))];
          const coBundled = mc.sharedBytes > 0 ? formatBytes(mc.sharedBytes) : '—';
          return `<tr><td><code>${esc(mc.file)}</code></td><td>${ownCell(mc)}</td><td class="dim">${formatBytes(mc.ownGzipBytes)}</td><td class="dim">${coBundled}</td><td class="dim">${peers.length ? esc(peers.join(', ')) : '—'}</td></tr>`;
        })
        .join('')
    : '';

  const moduleRows = a.modules
    .map((m) => {
      const [tag, cls] =
        m.directive === 'use client'
          ? ['client', 't-client']
          : m.directive === 'use server'
            ? ['action', 't-action']
            : m.envs.length > 1
              ? ['shared', 't-shared']
              : m.envs[0] === 'client'
                ? ['client*', 't-clientstar']
                : ['server', 't-server'];
      return `<tr><td><span class="tag ${cls}">${tag}</span></td><td>${esc(m.file)}</td></tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>rsc-gate report</title><style>${STYLE}</style></head>
<body><div class="wrap">
<h1>rsc-gate <span class="dim">v${esc(version)}</span></h1>
<div class="lede">${lede}</div>
<div class="dim">${esc(a.root)} · ${a.modules.length} modules · ${clientModules.length} "use client" · ${bundled.length} client-bundled</div>

<h2>Boundaries — server → client</h2>
<table><thead><tr><th>from</th><th>client component</th><th>imports</th><th>app JS</th></tr></thead><tbody>${boundaryRows || '<tr><td class="dim" colspan="4">none</td></tr>'}</tbody></table>

<h2>Client-bundled — no "use client", ships anyway</h2>
${bundledCards || '<div class="dim">none</div>'}

<h2>Props across boundaries</h2>
<table><thead><tr><th>component</th><th>prop</th><th>verdict</th></tr></thead><tbody>${propRows || '<tr><td class="dim" colspan="3">none</td></tr>'}</tbody></table>

${a.serverOnlyViolations.length ? `<h2>Server-only leaks</h2>${leakCards}` : ''}

${a.notes.length ? `<h2>Notes</h2><p class="dim">Not failures — nothing here fails <code>--strict</code>.</p>${noteCards}` : ''}

${build ? `<h2>Bundle cost</h2><p class="dim"><b>own</b> — chunks only your code is in. <b>co-bundled</b> — chunks the framework is in too: they may carry your code, and the manifest cannot say how much, so they are never billed to the app total.</p><table><thead><tr><th>module</th><th>own</th><th>gzip</th><th>co-bundled</th><th>shared with</th></tr></thead><tbody>${costRows}</tbody></table>` : ''}

<h2>Modules</h2>
<table><tbody>${moduleRows}</tbody></table>

<footer>Generated by rsc-gate — static analysis, no app execution. <span class="dim">[shared] = both envs · [client*] = client-bundled without a directive</span></footer>
</div></body></html>`;
}
