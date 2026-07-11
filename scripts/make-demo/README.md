# make-demo

Renders `assets/demo.gif` (README) and `assets/demo.mp4` (LinkedIn) from a **real
run of the CLI**.

The previous renderer lived in `C:\tmp` and did not survive a cleanup, which is why
the shipped demo still said `v0.0.1` long after 0.3.0 was out. This one lives in the
repo. Do not move it back out.

```bash
npm run build                        # the demo runs dist/cli.js, so build first
python scripts/make-demo/make_demo.py
```

Requires Pillow and `ffmpeg` on `PATH`.

## It is not a mockup

`storefront/` is a small Next.js App Router project. The script generates a `.next`
snapshot for it, runs `dist/cli.js storefront --strict`, and paints the ANSI bytes
the CLI wrote to stdout. Every path, byte count, verdict and exit code in the frames
is whatever the tool printed. Change the analyzer's output and the demo changes with
it; if the strict gate ever stops exiting 2 on this project, the script refuses to
render rather than quietly produce a demo of nothing.

Exactly two transforms are applied to the captured output, both in `sanitize()` and
`wrap()`:

1. the project's absolute path becomes `~/storefront`, so the demo does not show
   somebody's home directory;
2. lines longer than the terminal are wrapped on word boundaries. The longest line
   the CLI prints is 174 characters, so at any readable font size *something* wraps.

## What the demo has to show

`storefront/` is built so that one run exercises everything 0.3.0 added. If you edit
it, keep all of these — they are the reason it exists:

| Shown | Comes from |
|---|---|
| `[lazy]` boundary + lazy why-chain | `PriceChart`, loaded via `next/dynamic` |
| serialization hazards | `onSelect` (function) and `new Money(...)` (class instance) crossing into client components |
| a healthy prop, for contrast | `AddToCart`'s `sku` / `quantity` → `ok` |
| `SERVER-ONLY LEAKS` + why-chain | `lib/pricing.ts` imports `server-only`, and `PriceChart` imports it |
| `NOTES` | `AdminPanel.tsx` — `use client` + `server-only`, reachable from nothing |
| `co-bundled with framework` | `Rating.tsx`, whose only chunk is the framework's ("no chunk of its own") |
| the gate firing | `--strict` → `echo $?` → `2` |

## The build snapshot is generated, not committed

`storefront/.next/` is written by the script and stays gitignored — unlike
`fixtures/frozen-build/`, which is committed because CI depends on it. Nothing here
runs in CI, so there is no reason to carry ~140 KB of fake chunks in git, and no
`.gitattributes` dance to keep `core.autocrlf` from changing their byte sizes.

The chunk contents are deterministic filler, not a repeating pattern: a repeated
pattern gzips to nearly nothing and the report would claim a 92 KB chunk compresses
to 300 B. A fixed LCG lands the ratio at ~25-37%, where real JS lands.

The manifest shape is the interesting part, and it mirrors what Next 16 emits:

| Chunk | Referenced by | Category |
|---|---|---|
| `app-*.js` | ProductGrid **and** AddToCart | own, shared between the two |
| `chart-*.js` | PriceChart | own — its own lazy chunk |
| `framework-*.js` | `layout-router` (node_modules) **and** four of ours | co-bundled — not attributable |
| `vendor-*.js` | `layout-router` alone | framework — belongs in no total |

## Both outputs are byte-identical on every run

No `Date.now()`, no RNG, no wall-clock. Text is painted once into a tall "tape"
image and each frame is a crop of it, so a given line's pixels are identical in every
frame it appears in — which is also what lets the GIF encode a scroll as a shift
rather than a redraw.

## LinkedIn's constraints, which cost two re-encodes to find

`demo.mp4` must be **larger than ~75 KB**, **no wider than 2.4:1**, and **constant
frame rate**, or LinkedIn refuses it. A bare terminal-shaped video is too wide and
gets rejected, so the terminal is padded into a 2992×1684 16:9 canvas in the
terminal's own background colour. `check_linkedin()` asserts all four properties
after encoding and fails the run if any of them regress — that is the whole reason
it exists, so do not delete it to make the script quieter.
