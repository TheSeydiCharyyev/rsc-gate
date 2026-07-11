/**
 * Argument parsing for the CLI, kept out of cli.ts so the rules can be
 * unit-tested: cli.ts does its work at module scope and calls process.exit().
 */

export const DEFAULT_HTML_PATH = 'rsc-gate-report.html';

export interface CliOptions {
  /** Project root. `undefined` means the current working directory. */
  dir?: string;
  json: boolean;
  html: boolean;
  /** Where `--html` writes. Only meaningful when `html` is true. */
  htmlPath: string;
  noBuild: boolean;
  noColor: boolean;
  strict: boolean;
  help: boolean;
  explain: boolean;
  explainQuery?: string;
}

export type ParseResult = { ok: true; options: CliOptions } | { ok: false; error: string };

const BOOLEAN_FLAGS = new Map<string, 'json' | 'noBuild' | 'noColor' | 'strict'>([
  ['--json', 'json'],
  ['--no-build', 'noBuild'],
  ['--no-color', 'noColor'],
  ['--strict', 'strict'],
]);

/**
 * `--html` takes an optional value, so a bare token after it is ambiguous:
 * in `--html out.html` it is the report path, in `--html ./app` it is the
 * project directory. Only an .html/.htm token is read as the value; anything
 * else stays positional. `--html=<path>` is the unambiguous escape hatch.
 */
const looksLikeHtmlFile = (value: string): boolean => /\.html?$/i.test(value);

const defaults = (): CliOptions => ({
  json: false,
  html: false,
  htmlPath: DEFAULT_HTML_PATH,
  noBuild: false,
  noColor: false,
  strict: false,
  help: false,
  explain: false,
});

export function parseArgs(argv: string[]): ParseResult {
  // Help wins over every other argument, valid or not.
  if (argv.includes('--help') || argv.includes('-h')) return { ok: true, options: { ...defaults(), help: true } };

  const options = defaults();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }

    const eq = token.indexOf('=');
    const name = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);

    const boolean = BOOLEAN_FLAGS.get(name);
    if (boolean) {
      if (inline !== undefined) return { ok: false, error: `${name} does not take a value` };
      options[boolean] = true;
      continue;
    }

    if (name === '--explain') {
      options.explain = true;
      if (inline !== undefined) {
        if (inline) options.explainQuery = inline;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        options.explainQuery = next;
        i++;
      }
      continue;
    }

    if (name === '--html') {
      options.html = true;
      if (inline !== undefined) {
        if (!inline) return { ok: false, error: '--html expects a file path' };
        options.htmlPath = inline;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-') && looksLikeHtmlFile(next)) {
        options.htmlPath = next;
        i++;
      }
      continue;
    }

    return { ok: false, error: `unknown option '${token}'` };
  }

  if (positionals.length > 1) return { ok: false, error: `unexpected argument '${positionals[1]}'` };
  if (options.json && options.html) return { ok: false, error: '--json and --html cannot be combined' };
  if (positionals.length === 1) options.dir = positionals[0];

  return { ok: true, options };
}
