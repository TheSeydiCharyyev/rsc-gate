import ts from 'typescript';
import { readFileSync } from 'node:fs';
import type { ParsedModule } from './parse.js';
import type { Resolver } from './resolve.js';

export interface PropsCrossing {
  /** Server module rendering the client component. */
  file: string;
  /** Local JSX tag name. */
  component: string;
  /** Client module that defines the component. */
  componentFile: string;
  line: number;
  props: { name: string; verdict: PropVerdict }[];
}

export type PropVerdict = 'ok' | 'function' | 'function-ref' | 'spread' | 'class-instance' | 'symbol';

export interface PropFinding {
  file: string;
  component: string;
  componentFile: string;
  prop: string;
  kind: Exclude<PropVerdict, 'ok'>;
  line: number;
  message: string;
}

/**
 * Built-ins React 19 serializes across the boundary — never flag `new X()` for these.
 * Source of truth: ReactFlightServer.js renderModelDestructive() @ react v19.0.0
 * (enableBinaryFlight and enableFlightReadableStream are both shipped as true).
 * Error IS accepted — special-cased by the serializer (message redacted in prod,
 * but the build does not fail). WeakMap/WeakSet/RegExp/URL are NOT accepted —
 * they fall through to the plain-object check and throw at render.
 */
const SERIALIZABLE_CTORS = new Set([
  'Date',
  'Map',
  'Set',
  'Promise',
  'Array',
  'Error',
  'ArrayBuffer',
  'DataView',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
  'Blob',
  'File',
  'FormData',
  'ReadableStream',
]);

const MESSAGES: Record<Exclude<PropVerdict, 'ok'>, string> = {
  function:
    'functions are not serializable across the server→client boundary — next build fails at prerender (pass a Server Action or move the handler into the client component)',
  'function-ref':
    'functions are not serializable across the server→client boundary — next build fails at prerender (pass a Server Action or move the handler into the client component)',
  'class-instance':
    'class instances are not serializable across the server→client boundary — pass plain data (a POJO) instead',
  symbol: 'symbols are not serializable across the server→client boundary',
  spread: 'spread props cannot be statically checked for serializability',
};

interface NodeLike {
  parsed: ParsedModule;
  envs: Set<'server' | 'client'>;
}

/** Follow re-exports until the module that actually defines `name`. */
function resolveExportOrigin(
  nodes: Map<string, NodeLike>,
  resolver: Resolver,
  file: string,
  name: string,
  seen = new Set<string>(),
): string | null {
  const key = file + '|' + name;
  if (seen.has(key)) return null;
  seen.add(key);
  const node = nodes.get(file);
  if (!node) return file;
  if (node.parsed.localExportNames.has(name)) return file;
  for (const re of node.parsed.reexports) {
    const target = resolver.resolve(file, re.specifier);
    if (!target) continue;
    if (re.wildcard) {
      const hit = resolveExportOrigin(nodes, resolver, target, name, seen);
      if (hit) return hit;
    } else {
      const entry = re.named.find((e) => e.exported === name);
      if (entry) {
        const hit = resolveExportOrigin(nodes, resolver, target, entry.imported, seen);
        if (hit) return hit;
      }
    }
  }
  // Reached a module that does not export `name` (e.g. a wildcard re-export that
  // forwards to the wrong sibling). Do NOT claim the current file just because it
  // has a directive — that mis-attributes a server component to a client file (FP #4).
  return null;
}

/** Matches `Symbol(...)` and `Symbol.for(...)`. */
function isSymbolCallee(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return callee.text === 'Symbol';
  if (ts.isPropertyAccessExpression(callee)) {
    return ts.isIdentifier(callee.expression) && callee.expression.text === 'Symbol';
  }
  return false;
}

function isServerActionFn(fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration): boolean {
  if (!fn.body || !ts.isBlock(fn.body)) return false;
  const first = fn.body.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteralLike(first.expression) &&
    first.expression.text === 'use server'
  );
}

export function analyzeProps(
  nodes: Map<string, NodeLike>,
  resolver: Resolver,
  rel: (f: string) => string,
): { crossings: PropsCrossing[]; findings: PropFinding[] } {
  const crossings: PropsCrossing[] = [];
  const findings: PropFinding[] = [];

  for (const [file, node] of nodes) {
    // Only server-evaluated modules without their own "use client" can cross the boundary via JSX.
    if (node.parsed.directive === 'use client' || !node.envs.has('server')) continue;
    if (node.parsed.imports.length === 0) continue;

    // local tag name -> client component origin file
    const clientTags = new Map<string, string>();
    // locals imported from "use server" modules are server actions — legal props
    const actionLocals = new Set<string>();
    for (const imp of node.parsed.imports) {
      const target = resolver.resolve(file, imp.specifier);
      if (!target) continue;
      for (const b of imp.bindings) {
        const origin = resolveExportOrigin(nodes, resolver, target, b.imported);
        if (!origin) continue;
        const originNode = nodes.get(origin);
        if (originNode?.parsed.directive === 'use client') clientTags.set(b.local, origin);
        if (originNode?.parsed.directive === 'use server') actionLocals.add(b.local);
      }
    }
    if (clientTags.size === 0) continue;

    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);

    // Top-level local functions — passing one as a prop is the same hazard as an inline
    // arrow, EXCEPT a function whose body opens with "use server" is a Server Action and
    // is a legal prop. Track those separately so a reference to one is not flagged (FP #1).
    const localFns = new Set<string>();
    const localActions = new Set<string>();
    const note = (name: string, fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration) => {
      (isServerActionFn(fn) ? localActions : localFns).add(name);
    };
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name) note(st.name.text, st);
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (
            ts.isIdentifier(d.name) &&
            d.initializer &&
            (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
          ) {
            note(d.name.text, d.initializer);
          }
        }
      }
    }

    const classify = (attr: ts.JsxAttributeLike): { name: string; verdict: PropVerdict } => {
      if (ts.isJsxSpreadAttribute(attr)) return { name: '...spread', verdict: 'spread' };
      const name = attr.name.getText(sf);
      const init = attr.initializer;
      if (!init || ts.isStringLiteral(init)) return { name, verdict: 'ok' };
      if (ts.isJsxExpression(init) && init.expression) {
        const expr = init.expression;
        if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
          return { name, verdict: isServerActionFn(expr) ? 'ok' : 'function' };
        }
        if (ts.isNewExpression(expr)) {
          const ctor = ts.isIdentifier(expr.expression) ? expr.expression.text : null;
          return { name, verdict: ctor && SERIALIZABLE_CTORS.has(ctor) ? 'ok' : 'class-instance' };
        }
        if (ts.isCallExpression(expr) && isSymbolCallee(expr.expression)) {
          return { name, verdict: 'symbol' };
        }
        if (ts.isIdentifier(expr)) {
          if (actionLocals.has(expr.text) || localActions.has(expr.text)) return { name, verdict: 'ok' };
          if (localFns.has(expr.text)) return { name, verdict: 'function-ref' };
        }
      }
      return { name, verdict: 'ok' };
    };

    const visit = (n: ts.Node): void => {
      let tag: ts.JsxTagNameExpression | null = null;
      let attrs: ts.JsxAttributes | null = null;
      if (ts.isJsxSelfClosingElement(n)) {
        tag = n.tagName;
        attrs = n.attributes;
      } else if (ts.isJsxElement(n)) {
        tag = n.openingElement.tagName;
        attrs = n.openingElement.attributes;
      }
      if (tag && attrs && ts.isIdentifier(tag) && clientTags.has(tag.text)) {
        const componentFile = rel(clientTags.get(tag.text)!);
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        const props = attrs.properties.map(classify);
        crossings.push({ file: rel(file), component: tag.text, componentFile, line, props });
        for (const p of props) {
          if (p.verdict === 'ok') continue;
          findings.push({
            file: rel(file),
            component: tag.text,
            componentFile,
            prop: p.name,
            kind: p.verdict,
            line,
            message: MESSAGES[p.verdict],
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  crossings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { crossings, findings };
}
