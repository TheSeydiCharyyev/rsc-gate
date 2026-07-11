import { describe, expect, it } from 'vitest';
import { DEFAULT_HTML_PATH, parseArgs } from '../src/args.js';

/** parseArgs, asserting it succeeded. */
const ok = (argv: string[]) => {
  const result = parseArgs(argv);
  if (!result.ok) throw new Error(`expected parse to succeed, got: ${result.error}`);
  return result.options;
};

/** parseArgs, asserting it failed. */
const err = (argv: string[]) => {
  const result = parseArgs(argv);
  if (result.ok) throw new Error(`expected parse to fail, got: ${JSON.stringify(result.options)}`);
  return result.error;
};

describe('--html does not swallow the project directory (#5)', () => {
  it('leaves a directory positional and falls back to the default report path', () => {
    const opts = ok(['--html', 'fixtures/serialize']);
    expect(opts.dir).toBe('fixtures/serialize');
    expect(opts.html).toBe(true);
    expect(opts.htmlPath).toBe(DEFAULT_HTML_PATH);
  });

  it('accepts an .html value after the flag', () => {
    const opts = ok(['--html', 'out.html']);
    expect(opts.htmlPath).toBe('out.html');
    expect(opts.dir).toBeUndefined();
  });

  it('accepts both argument orders', () => {
    const before = ok(['fixtures/serialize', '--html', 'out.html']);
    expect(before.dir).toBe('fixtures/serialize');
    expect(before.htmlPath).toBe('out.html');

    const after = ok(['--html', 'out.html', 'fixtures/serialize']);
    expect(after.dir).toBe('fixtures/serialize');
    expect(after.htmlPath).toBe('out.html');
  });

  it('matches .htm and is case-insensitive', () => {
    expect(ok(['--html', 'out.HTM']).htmlPath).toBe('out.HTM');
    expect(ok(['--html', 'Report.Html']).htmlPath).toBe('Report.Html');
  });

  it('takes an explicit --html=<path> value whatever its extension', () => {
    const opts = ok(['--html=./app', 'fixtures/serialize']);
    expect(opts.htmlPath).toBe('./app');
    expect(opts.dir).toBe('fixtures/serialize');
  });

  it('rejects an empty --html= value rather than writing to the cwd', () => {
    expect(err(['--html='])).toBe('--html expects a file path');
  });

  it('uses the default path when the flag has no value', () => {
    expect(ok(['--html']).htmlPath).toBe(DEFAULT_HTML_PATH);

    const trailing = ok(['fixtures/serialize', '--html']);
    expect(trailing.dir).toBe('fixtures/serialize');
    expect(trailing.htmlPath).toBe(DEFAULT_HTML_PATH);
  });

  it('never consumes a following flag as its value', () => {
    const opts = ok(['--html', '--no-color', 'fixtures/serialize']);
    expect(opts.htmlPath).toBe(DEFAULT_HTML_PATH);
    expect(opts.noColor).toBe(true);
    expect(opts.dir).toBe('fixtures/serialize');
  });
});

describe('--json and --html cannot both claim the output', () => {
  it('errors instead of silently dropping the HTML report', () => {
    expect(err(['fixtures/serialize', '--json', '--html', 'out.html'])).toBe(
      '--json and --html cannot be combined',
    );
    expect(err(['--html', '--json'])).toBe('--json and --html cannot be combined');
  });

  it('still allows either one alone', () => {
    expect(ok(['--json']).json).toBe(true);
    expect(ok(['--html']).html).toBe(true);
  });
});

describe('unknown options are rejected, not ignored', () => {
  it('rejects a misspelled flag rather than silently disarming the gate', () => {
    // `--stirct` used to parse clean and exit 0 — a CI gate that never fired.
    expect(err(['fixtures/demo', '--stirct'])).toBe("unknown option '--stirct'");
    expect(err(['--htlm', 'out.html'])).toBe("unknown option '--htlm'");
  });

  it('rejects a value handed to a boolean flag', () => {
    expect(err(['--json=true'])).toBe('--json does not take a value');
    expect(err(['--strict=1'])).toBe('--strict does not take a value');
  });

  it('rejects a bare dash', () => {
    expect(err(['-'])).toBe("unknown option '-'");
  });

  it('treats `--` as end-of-options, not as an unknown one', () => {
    expect(ok(['--', 'fixtures/edge']).dir).toBe('fixtures/edge');
    expect(ok(['--']).dir).toBeUndefined();
    expect(ok(['--strict', '--', 'fixtures/edge']).strict).toBe(true);

    // Everything after `--` is an operand, even if it looks like a flag.
    const operand = ok(['--', '--strict']);
    expect(operand.dir).toBe('--strict');
    expect(operand.strict).toBe(false);
  });
});

describe('positional arguments', () => {
  it('accepts exactly one', () => {
    expect(ok([]).dir).toBeUndefined();
    expect(ok(['fixtures/edge']).dir).toBe('fixtures/edge');
  });

  it('rejects a second one instead of silently dropping it', () => {
    expect(err(['fixtures/edge', 'fixtures/demo'])).toBe("unexpected argument 'fixtures/demo'");
    // The trap opened up by treating a non-.html token as positional.
    expect(err(['--html', 'report.txt', 'fixtures/edge'])).toBe("unexpected argument 'fixtures/edge'");
  });
});

describe('--explain', () => {
  it('takes the following code', () => {
    const spaced = ok(['--explain', 'function-props']);
    expect(spaced.explain).toBe(true);
    expect(spaced.explainQuery).toBe('function-props');
    expect(ok(['--explain=function-props']).explainQuery).toBe('function-props');
  });

  it('never consumes a following flag as the code', () => {
    const opts = ok(['--explain', '--json']);
    expect(opts.explainQuery).toBeUndefined();
    expect(opts.json).toBe(true);
  });

  it('leaves the code undefined when the flag is last', () => {
    const opts = ok(['--explain']);
    expect(opts.explain).toBe(true);
    expect(opts.explainQuery).toBeUndefined();
  });
});

describe('help', () => {
  it('supports the -h alias', () => {
    // `-h` never reached the help branch: it was parsed as the project dir.
    expect(ok(['-h']).help).toBe(true);
    expect(ok(['-h']).dir).toBeUndefined();
    expect(ok(['--help']).help).toBe(true);
  });

  it('wins over an otherwise invalid command line', () => {
    expect(ok(['--stirct', '--help']).help).toBe(true);
  });
});

describe('boolean flags', () => {
  it('are all recognized', () => {
    const opts = ok(['--json', '--no-build', '--no-color', '--strict']);
    expect(opts.json).toBe(true);
    expect(opts.noBuild).toBe(true);
    expect(opts.noColor).toBe(true);
    expect(opts.strict).toBe(true);
  });

  it('default to false', () => {
    const opts = ok(['fixtures/demo']);
    expect(opts.json).toBe(false);
    expect(opts.html).toBe(false);
    expect(opts.noBuild).toBe(false);
    expect(opts.noColor).toBe(false);
    expect(opts.strict).toBe(false);
    expect(opts.help).toBe(false);
    expect(opts.explain).toBe(false);
  });
});
