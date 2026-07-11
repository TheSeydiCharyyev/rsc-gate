#!/usr/bin/env python3
"""Render assets/demo.gif and assets/demo.mp4 from a real rsc-gate run.

The demo is not a mockup. This script builds a small Next.js App Router project
(scripts/make-demo/storefront), runs the *actual* CLI against it, and paints the
ANSI bytes the CLI wrote to stdout. Nothing in the frames is typed by hand: change
the analyzer's output and the demo changes with it.

Two transforms are applied to the captured stdout, and they are the only two:

  1. the project's absolute path is rewritten to ~/storefront, so the demo does
     not show someone's home directory;
  2. long lines are wrapped at the terminal width, which is what a terminal does.

Everything else - every path, byte count, verdict and exit code - is whatever the
CLI printed.

Usage:
    npm run build            # dist/cli.js must exist; the demo runs the real CLI
    python scripts/make-demo/make_demo.py

Requires: Pillow, ffmpeg on PATH.
"""

from __future__ import annotations

import gzip
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parents[2]
PROJECT = Path(__file__).resolve().parent / "storefront"
CLI = REPO / "dist" / "cli.js"
ASSETS = REPO / "assets"
WORK = Path(__file__).resolve().parent / ".work"

# ---------------------------------------------------------------------------
# Terminal look. Sampled from the v0.1.0 demo so the new one is recognisably the
# same tool: GitHub dark, macOS window chrome.
# ---------------------------------------------------------------------------

BG = "#0d1117"
TITLEBAR = "#161b22"
TITLE_TEXT = "#8b949e"
LIGHTS = ("#ff5f56", "#ffbd2e", "#27c93f")

FG = "#c9d1d9"          # default text
BOLD_FG = "#ffffff"     # \x1b[1m
DIM_FG = "#8b949e"      # \x1b[2m
RED = "#f85149"         # \x1b[31m
GREEN = "#3fb950"       # \x1b[32m
YELLOW = "#d29922"      # \x1b[33m
CYAN = "#39c5cf"        # \x1b[36m

SGR = {31: RED, 32: GREEN, 33: YELLOW, 36: CYAN}

COLS = 112          # the longest line the CLI prints is 174 chars: something wraps
ROWS = 24           # whatever this is, it is what scrolls - and scroll frames are
                    # what a GIF cannot delta-compress, so it also sets the file size
FONT_SIZE = 19
LINE_H = 29
PAD_X = 28
PAD_Y = 16
TITLEBAR_H = 46
CURSOR = "#39c5cf"
REVEAL = 7          # output lines per frame
GIF_COLORS = 32

# LinkedIn rejects video outside these bounds; both were established the hard way.
LI_W, LI_H = 2992, 1684          # 16:9 canvas, terminal padded into it
LI_MIN_BYTES = 75 * 1024         # a file under ~75 KB is refused
LI_MAX_RATIO = 2.4               # so is anything wider than 2.4:1

MONO = ["C:/Windows/Fonts/consola.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]
MONO_BOLD = ["C:/Windows/Fonts/consolab.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"]
# Consolas has no U+2716 (the "not serializable" cross) and no U+2713. A real
# terminal falls back to another installed face for those; so do we, rather than
# swapping in a character the CLI never printed.
FALLBACK = ["C:/Windows/Fonts/seguisym.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]


def pick(paths: list[str]) -> str:
    for p in paths:
        if Path(p).exists():
            return p
    sys.exit(f"none of these fonts exist: {paths}")


# ---------------------------------------------------------------------------
# 1. A build snapshot, generated (not committed) so .gitignore stays untouched.
#
# The shape is the point, and it mirrors what Next 16 emits:
#
#   app-*.js       ProductGrid + AddToCart      -> own, and shared between the two
#   chart-*.js     PriceChart                   -> own, its own lazy chunk
#   framework-*.js layout-router AND four of our components
#                                               -> co-bundled: may hold our code,
#                                                  the manifest does not say whose
#   vendor-*.js    layout-router alone          -> framework, belongs in no total
#
# Rating's *only* chunk is the framework one, which is the case the report has to
# describe as "no chunk of its own" rather than the "0 B own" the old code printed.
# ---------------------------------------------------------------------------

CHUNKS = {
    "app-7c31e9.js": 1834,
    "chart-4b8d02.js": 3121,
    "framework-9e2f15.js": 94208,
    "vendor-2a6c88.js": 41984,
}

MANIFEST_MODULES = {
    # A node_modules module is what marks a chunk as the framework's.
    "node_modules/next/dist/esm/client/components/layout-router.js": ["framework-9e2f15.js", "vendor-2a6c88.js"],
    "components/ProductGrid.tsx": ["framework-9e2f15.js", "app-7c31e9.js"],
    "components/AddToCart.tsx": ["framework-9e2f15.js", "app-7c31e9.js"],
    "components/PriceChart.tsx": ["framework-9e2f15.js", "chart-4b8d02.js"],
    "components/Rating.tsx": ["framework-9e2f15.js"],
}

WORDS = (
    "props state chunk render hydrate route flight payload stream client server "
    "module resolve boundary manifest cache entry loader emit patch node ref key "
    "queue effect layout mount update commit fiber lane batch signal owner scope"
).split()


def js_filler(nbytes: int, seed: int) -> bytes:
    """Deterministic minified-JS-looking bytes of an exact length.

    A repeating pattern would gzip to nearly nothing and the report would claim a
    92 KB chunk compresses to 300 B. Vary the identifiers with a fixed LCG so the
    gzip ratio lands where real JS lands, and stays the same on every machine.
    """
    state = seed & 0xFFFFFFFF
    def rnd(n: int) -> int:
        nonlocal state
        state = (1103515245 * state + 12345) & 0x7FFFFFFF
        return state % n

    out = bytearray(b"(self.webpackChunk=self.webpackChunk||[]).push([[%d],{" % seed)
    while len(out) < nbytes:
        a, b, c = (WORDS[rnd(len(WORDS))] for _ in range(3))
        i = rnd(9999)
        out += (
            '%d:(e,t,n)=>{"use strict";n.d(t,{%s:()=>%s%d});'
            'const %s%d=(%s,%s)=>%s?.%s??{%s:%d,%s:"%s"};' % (
                i, a[:2] + str(i % 97), a, i, b, i, a, b, a, c, c, i * 7 % 4093, b, a + c
            )
        ).encode()
    return bytes(out[:nbytes])


def write_build_snapshot() -> None:
    next_dir = PROJECT / ".next"
    if next_dir.exists():
        shutil.rmtree(next_dir)
    chunk_dir = next_dir / "static" / "chunks"
    chunk_dir.mkdir(parents=True)
    for i, (name, size) in enumerate(CHUNKS.items()):
        (chunk_dir / name).write_bytes(js_filler(size, 1337 + i * 101))

    mods = []
    for path, chunks in MANIFEST_MODULES.items():
        urls = ['"/_next/static/chunks/%s"' % c for c in chunks]
        # Not hash(): Python salts it per process, and the manifest has to come out
        # byte-identical on every run.
        mid = 10000 + sum(ord(c) * (i + 1) for i, c in enumerate(path)) % 90000
        for key in ('[project]/%s <module evaluation>' % path, '[project]/%s' % path):
            mods.append('"%s":{"id":%d,"name":"*","chunks":[%s],"async":false}'
                        % (key, mid, ",".join(urls)))
    body = ('{"moduleLoading":{"prefix":"","crossOrigin":null},"clientModules":{%s},'
            '"ssrModuleMapping":{},"edgeSSRModuleMapping":{},"clientCssManifest":{},'
            '"entryCSSFiles":{},"entryJSFiles":{}}' % ",".join(mods))
    manifest = (
        "globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n"
        'globalThis.__RSC_MANIFEST["/page"] = %s;\n' % body
    )
    out = next_dir / "server" / "app"
    out.mkdir(parents=True)
    (out / "page_client-reference-manifest.js").write_bytes(manifest.encode())

    for name, size in CHUNKS.items():
        raw = (chunk_dir / name).read_bytes()
        gz = len(gzip.compress(raw, 9))
        print(f"  chunk {name:24s} {size:6d} B  gzip {gz:5d} B  ({gz / size:.0%})")


# ---------------------------------------------------------------------------
# 2. Run the real CLI and keep its ANSI bytes.
# ---------------------------------------------------------------------------

@dataclass
class Run:
    stdout: str
    code: int


def run_cli(*args: str) -> Run:
    # stdout is a pipe, so isTTY is undefined - and the CLI's check is
    # `isTTY !== false`, which means we get the colours a terminal would get.
    p = subprocess.run(
        [shutil.which("node") or "node", str(CLI), str(PROJECT), *args],
        capture_output=True, cwd=REPO,
    )
    if p.stderr:
        print("  cli stderr:", p.stderr.decode(errors="replace").strip())
    return Run(p.stdout.decode("utf-8"), p.returncode)


def sanitize(text: str) -> str:
    """Rewrite the machine-specific project path to ~/storefront. Nothing else."""
    for form in (str(PROJECT), str(PROJECT).replace("\\", "/")):
        text = text.replace(form, "~/storefront")
    # The tail of a rewritten Windows path keeps its backslashes (~/storefront\.next).
    return text.replace("~/storefront\\", "~/storefront/")


# ---------------------------------------------------------------------------
# 3. ANSI -> styled cells.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Style:
    color: str = FG
    bold: bool = False


Line = list[tuple[str, Style]]


def parse_ansi(text: str) -> list[Line]:
    lines: list[Line] = []
    cur: Line = []
    color, bold, dim = FG, False, False
    i = 0
    buf = ""

    def flush() -> None:
        nonlocal buf
        if buf:
            c = DIM_FG if (dim and color == FG) else color
            cur.append((buf, Style(BOLD_FG if (bold and color == FG) else c, bold)))
            buf = ""

    while i < len(text):
        ch = text[i]
        if ch == "\x1b" and text[i + 1 : i + 2] == "[":
            j = text.index("m", i)
            flush()
            for part in text[i + 2 : j].split(";"):
                n = int(part or 0)
                if n == 0:
                    color, bold, dim = FG, False, False
                elif n == 1:
                    bold = True
                elif n == 2:
                    dim = True
                elif n in SGR:
                    color = SGR[n]
            i = j + 1
            continue
        if ch == "\n":
            flush()
            lines.append(cur)
            cur = []
            i += 1
            continue
        buf += ch
        i += 1
    flush()
    if cur:
        lines.append(cur)
    return lines


def wrap(lines: list[Line], cols: int) -> list[Line]:
    """Wrap over-long lines at the terminal width, breaking on spaces.

    A real terminal breaks mid-word; that reads badly in a demo ("the imp/ort will
    throw"), so this breaks on word boundaries and hangs the continuation under the
    line's own indent. It is the same transform either way - reflowing text to the
    window width - and it never changes a character the CLI printed.
    """
    out: list[Line] = []
    for line in lines:
        flat = [(ch, st) for text, st in line for ch in text]
        if len(flat) <= cols:
            out.append(line)
            continue
        text = "".join(c for c, _ in flat)
        indent = len(text) - len(text.lstrip())
        pos, first = 0, True
        while pos < len(flat):
            width = cols if first else cols - indent - 2
            end = min(pos + width, len(flat))
            if end < len(flat):
                brk = text.rfind(" ", pos + 1, end + 1)
                if brk > pos:
                    end = brk
            cells = [(" ", Style())] * (0 if first else indent + 2) + flat[pos:end]
            merged: Line = []
            for c, s in cells:
                if merged and merged[-1][1] == s:
                    merged[-1] = (merged[-1][0] + c, s)
                else:
                    merged.append((c, s))
            out.append(merged)
            pos = end + 1 if end < len(flat) and text[end] == " " else end
            first = False
    return out


# ---------------------------------------------------------------------------
# 4. Paint.
# ---------------------------------------------------------------------------

class Painter:
    def __init__(self) -> None:
        self.regular = ImageFont.truetype(pick(MONO), FONT_SIZE)
        self.bold = ImageFont.truetype(pick(MONO_BOLD), FONT_SIZE)
        # The fallback face's glyphs are drawn small next to Consolas at the same
        # nominal size; +2 evens out the weight of the one glyph it supplies (the
        # "not serializable" cross).
        self.fallback = ImageFont.truetype(pick(FALLBACK), FONT_SIZE + 2)
        self.covered = set(TTFontCmap(pick(MONO)))
        ascent, descent = self.regular.getmetrics()
        self.ascent = ascent
        self.box = ascent + descent                       # the glyph box, not LINE_H
        self.top_pad = (LINE_H - self.box) // 2           # centre it in the row
        # Keep the font's real advance width - rounding it to an integer would
        # either crowd the glyphs or leave a visible gap over 96 columns.
        self.cell_w = self.regular.getlength("M")
        self.width = PAD_X * 2 + round(COLS * self.cell_w)
        self.height = TITLEBAR_H + PAD_Y * 2 + ROWS * LINE_H
        self.title = ImageFont.truetype(pick(MONO), 19)

    def font_for(self, ch: str, bold: bool) -> ImageFont.FreeTypeFont:
        if ord(ch) not in self.covered:
            return self.fallback
        return self.bold if bold else self.regular

    def draw_line(self, d: ImageDraw.ImageDraw, line: Line, x: int, y: int) -> None:
        """Draw one row, cell by cell, the way a terminal lays glyphs on a grid.

        Both faces are anchored to a shared baseline: anchoring to the ascender
        instead drops the fallback glyph below the line, because the two fonts do
        not agree on where their ascender is. The fallback glyph is also centred in
        its cell, since it is not monospaced and its advance is not the cell width.
        """
        baseline = y + self.ascent
        col = 0
        for text, st in line:
            for ch in text:
                if ch != " ":
                    f = self.font_for(ch, st.bold)
                    if f is self.fallback:
                        d.text((x + (col + 0.5) * self.cell_w, baseline), ch,
                               font=f, fill=st.color, anchor="ms")
                    else:
                        d.text((x + col * self.cell_w, baseline), ch,
                               font=f, fill=st.color, anchor="ls")
                col += 1

    def tape(self, lines: list[Line]) -> Image.Image:
        """Every line, painted once. Frames are crops of this, so a given line's
        pixels are identical in every frame it appears in - which is what lets the
        GIF encode a scroll as a shift instead of a redraw."""
        img = Image.new("RGB", (self.width - PAD_X * 2, max(1, len(lines)) * LINE_H), BG)
        d = ImageDraw.Draw(img)
        for i, line in enumerate(lines):
            self.draw_line(d, line, 0, i * LINE_H + self.top_pad)
        return img

    def chrome(self) -> Image.Image:
        img = Image.new("RGB", (self.width, self.height), BG)
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, self.width, TITLEBAR_H], fill=TITLEBAR)
        for i, c in enumerate(LIGHTS):
            cx = 24 + i * 26
            d.ellipse([cx - 7, TITLEBAR_H // 2 - 7, cx + 7, TITLEBAR_H // 2 + 7], fill=c)
        t = "rsc-gate"
        d.text(((self.width - self.title.getlength(t)) / 2, TITLEBAR_H // 2 - 11),
               t, font=self.title, fill=TITLE_TEXT)
        return img

    def frame(self, tape: Image.Image, chrome: Image.Image, shown: int,
              typing: Line | None, cursor: bool) -> Image.Image:
        img = chrome.copy()
        total = shown + (1 if typing else 0)
        top = max(0, total - ROWS)          # scroll: keep the last ROWS lines
        vis_from, vis_to = top, min(shown, top + ROWS)
        if vis_to > vis_from:
            crop = tape.crop((0, vis_from * LINE_H, tape.width, vis_to * LINE_H))
            img.paste(crop, (PAD_X, TITLEBAR_H + PAD_Y))
        d = ImageDraw.Draw(img)
        row = vis_to - top
        if typing is not None:
            y = TITLEBAR_H + PAD_Y + row * LINE_H + self.top_pad
            self.draw_line(d, typing, PAD_X, y)
            if cursor:
                col = sum(len(t) for t, _ in typing)
                d.rectangle([PAD_X + col * self.cell_w, y,
                             PAD_X + (col + 1) * self.cell_w - 2, y + self.box], fill=CURSOR)
        return img


def TTFontCmap(path: str) -> set[int]:
    from fontTools.ttLib import TTFont
    return set(TTFont(path, fontNumber=0).getBestCmap().keys())


# ---------------------------------------------------------------------------
# 5. Script the session.
# ---------------------------------------------------------------------------

def prompt(cmd: str) -> Line:
    return [("$ ", Style(GREEN, True)), (cmd, Style(FG))]


@dataclass
class Frame:
    shown: int
    typing: Line | None
    cursor: bool
    ms: int


def timeline(report: list[Line], code: int) -> tuple[list[Line], list[Frame]]:
    cmd = "npx rsc-gate . --strict"
    lines: list[Line] = [prompt(cmd), []]
    lines += report
    lines += [[], prompt("echo $?"), [(str(code), Style(RED, True))]]

    frames: list[Frame] = []
    frames.append(Frame(0, [("$ ", Style(GREEN, True))], True, 500))
    for i in range(2, len(cmd) + 1, 2):                  # type the command
        frames.append(Frame(0, prompt(cmd[:i]), True, 70))
    frames.append(Frame(0, prompt(cmd), True, 420))      # beat before Enter

    # Reveal the report, and dwell on the sections that carry the point rather than
    # letting them scroll past. A section ends where the next unindented header
    # starts; pause on the frame that completes it.
    body_start = 2
    body_end = body_start + len(report)
    texts = ["".join(t for t, _ in line) for line in report]
    heads = [i for i, t in enumerate(texts) if t and not t.startswith(" ")]

    DWELL = {"PROPS ACROSS": 700, "SERVER-ONLY LEAKS": 1300, "NOTES": 800, "BUNDLE COST": 900}
    pauses: dict[int, int] = {}
    for i in heads:
        for name, ms in DWELL.items():
            if texts[i].startswith(name):
                nxt = next((j for j in heads if j > i), len(report))
                pauses[body_start + nxt - 1] = ms          # last line of the section

    n = body_start
    frames.append(Frame(n, None, False, 260))
    while n < body_end:
        prev, n = n, min(n + REVEAL, body_end)
        hold = max((ms for at, ms in pauses.items() if prev < at <= n), default=300)
        frames.append(Frame(n, None, False, hold))
    frames.append(Frame(body_end, None, False, 900))

    echo = "echo $?"
    base = body_end + 1
    frames.append(Frame(base, [("$ ", Style(GREEN, True))], True, 260))
    for i in range(2, len(echo) + 1, 2):
        frames.append(Frame(base, prompt(echo[:i]), True, 70))
    frames.append(Frame(base, prompt(echo), True, 380))
    frames.append(Frame(base + 2, None, False, 3400))    # exit code, and hold
    return lines, frames


# ---------------------------------------------------------------------------
# 6. Encode.
# ---------------------------------------------------------------------------

def ffmpeg(*args: str) -> None:
    subprocess.run([shutil.which("ffmpeg") or "ffmpeg", "-y", "-v", "error", *args], check=True)


def encode_gif(frames: list[Image.Image], durs: list[int], out: Path) -> None:
    d = WORK / "gif"
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
    with open(d / "in.txt", "w") as f:
        for i, (img, ms) in enumerate(zip(frames, durs)):
            img.save(d / f"f{i:04d}.png")
            f.write(f"file 'f{i:04d}.png'\nduration {ms / 1000:.3f}\n")
        f.write(f"file 'f{len(frames) - 1:04d}.png'\n")   # concat needs the last one twice

    # A terminal is flat colour plus antialiased text: a small palette with no
    # dithering keeps the text crisp and the file small. bayer/floyd-steinberg
    # would speckle the background and cost several hundred KB.
    ffmpeg("-f", "concat", "-safe", "0", "-i", str(d / "in.txt"),
           "-vf", f"palettegen=max_colors={GIF_COLORS}:stats_mode=diff", str(d / "pal.png"))
    ffmpeg("-f", "concat", "-safe", "0", "-i", str(d / "in.txt"), "-i", str(d / "pal.png"),
           "-lavfi", "paletteuse=dither=none:diff_mode=rectangle", "-loop", "0", str(out))


def encode_mp4(frames: list[Image.Image], durs: list[int], out: Path, scale: int) -> None:
    d = WORK / "mp4"
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)

    # Constant frame rate: LinkedIn drops variable-fps files. Hold each frame for
    # as many 30fps ticks as its duration is worth.
    fps = 30
    idx = 0
    for img, ms in zip(frames, durs):
        big = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
        for _ in range(max(1, round(ms / 1000 * fps))):
            big.save(d / f"f{idx:05d}.png")
            idx += 1

    ffmpeg("-framerate", str(fps), "-i", str(d / "f%05d.png"),
           "-vf", f"pad={LI_W}:{LI_H}:(ow-iw)/2:(oh-ih)/2:color={BG}",
           "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
           "-r", str(fps), "-vsync", "cfr", "-crf", "20", "-preset", "slow",
           "-movflags", "+faststart", str(out))


def check_linkedin(path: Path) -> None:
    size = path.stat().st_size
    probe = subprocess.run(
        [shutil.which("ffprobe") or "ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate,nb_frames",
         "-of", "default=nw=1", str(path)],
        capture_output=True, text=True, check=True).stdout
    info = dict(l.split("=") for l in probe.strip().splitlines())
    w, h = int(info["width"]), int(info["height"])
    ratio = w / h
    ok = True
    print(f"\n  demo.mp4  {w}x{h}  ratio {ratio:.2f}:1  {size / 1024:.0f} KB  "
          f"r_frame_rate={info['r_frame_rate']} avg={info['avg_frame_rate']}")
    for label, good in (
        (f"size > {LI_MIN_BYTES // 1024} KB", size > LI_MIN_BYTES),
        (f"ratio <= {LI_MAX_RATIO}:1", ratio <= LI_MAX_RATIO),
        ("constant fps", info["r_frame_rate"] == info["avg_frame_rate"]),
        ("fits the canvas", (w, h) == (LI_W, LI_H)),
    ):
        print(f"    [{'ok' if good else 'FAIL'}] {label}")
        ok = ok and good
    if not ok:
        sys.exit("mp4 does not meet LinkedIn's constraints")


def main() -> None:
    if not CLI.exists():
        sys.exit(f"{CLI} not found - run `npm run build` first")
    ASSETS.mkdir(exist_ok=True)
    WORK.mkdir(exist_ok=True)

    print("build snapshot:")
    write_build_snapshot()

    print("\nrunning the real CLI:")
    run = run_cli("--strict")
    print(f"  node dist/cli.js <storefront> --strict -> exit {run.code}")
    if run.code != 2:
        sys.exit("expected the strict gate to fail (exit 2); the demo has nothing to show")

    report = wrap(parse_ansi(sanitize(run.stdout).rstrip("\n")), COLS)
    p = Painter()
    print(f"  terminal {p.width}x{p.height} @ {COLS}x{ROWS}, {len(report)} lines of output")

    lines, script = timeline(report, run.code)
    tape, chrome = p.tape(lines), p.chrome()
    frames = [p.frame(tape, chrome, f.shown, f.typing, f.cursor) for f in script]
    durs = [f.ms for f in script]
    print(f"  {len(frames)} frames, {sum(durs) / 1000:.1f}s")

    scale = min(LI_W // p.width, LI_H // p.height)
    encode_gif(frames, durs, ASSETS / "demo.gif")
    encode_mp4(frames, durs, ASSETS / "demo.mp4", scale)
    print(f"\n  demo.gif  {p.width}x{p.height}  {(ASSETS / 'demo.gif').stat().st_size / 1024:.0f} KB")
    check_linkedin(ASSETS / "demo.mp4")
    shutil.rmtree(WORK, ignore_errors=True)


if __name__ == "__main__":
    main()
