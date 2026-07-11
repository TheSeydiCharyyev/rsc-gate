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

/**
 * Matches `Symbol(...)` — and deliberately NOT `Symbol.for(...)`.
 *
 * Flight does not reject symbols; it rejects symbols it cannot name. The check is
 * `if (Symbol.for(name) !== value) throw` (ReactFlightServer.js, react v19.0.0):
 * a symbol from the global registry round-trips through its key and crosses, and
 * only an unregistered `Symbol('x')` throws — the thrown message says so itself
 * ("Only global symbols received from Symbol.for(...) can be passed to Client
 * Components").
 *
 * Flagging `Symbol.for(...)` was a false positive that failed a healthy project's
 * `--strict` run, which is the worst bug this tool can have.
 */
function isSymbolCallee(callee: ts.Expression): boolean {
  return ts.isIdentifier(callee) && callee.text === 'Symbol';
}

type FnLike = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.MethodDeclaration;

function isServerActionFn(fn: FnLike): boolean {
  if (!fn.body || !ts.isBlock(fn.body)) return false;
  const first = fn.body.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteralLike(first.expression) &&
    first.expression.text === 'use server'
  );
}

function hasModifier(st: ts.Statement, kind: ts.SyntaxKind): boolean {
  const mods = (st as { modifiers?: readonly ts.ModifierLike[] }).modifiers;
  return mods?.some((m) => m.kind === kind) ?? false;
}

/**
 * Which of a module's exports are functions — and which of those are Server
 * Actions, which are legal props. Needed because an *imported* function passed to
 * a client component is the same hazard as a local one, and the export kinds are
 * not in ParsedModule (it records names only). Parsed lazily, cached per file.
 */
function exportedFunctionKinds(file: string, cache: Map<string, Map<string, 'function' | 'action'>>) {
  const hit = cache.get(file);
  if (hit) return hit;

  const kinds = new Map<string, 'function' | 'action'>();
  try {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      if (!hasModifier(st, ts.SyntaxKind.ExportKeyword)) continue;
      const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword);
      const record = (name: string, fn: FnLike) =>
        kinds.set(name, isServerActionFn(fn) ? 'action' : 'function');

      if (ts.isFunctionDeclaration(st)) {
        if (st.name) record(st.name.text, st);
        if (isDefault) record('default', st);
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (
            ts.isIdentifier(d.name) &&
            d.initializer &&
            (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
          ) {
            record(d.name.text, d.initializer);
          }
        }
      }
    }
  } catch {
    /* unreadable module — treat as having no known function exports */
  }
  cache.set(file, kinds);
  return kinds;
}

export function analyzeProps(
  nodes: Map<string, NodeLike>,
  resolver: Resolver,
  rel: (f: string) => string,
): { crossings: PropsCrossing[]; findings: PropFinding[] } {
  const crossings: PropsCrossing[] = [];
  const findings: PropFinding[] = [];
  const exportKinds = new Map<string, Map<string, 'function' | 'action'>>();

  for (const [file, node] of nodes) {
    // Only server-evaluated modules without their own "use client" can cross the boundary via JSX.
    if (node.parsed.directive === 'use client' || !node.envs.has('server')) continue;
    if (node.parsed.imports.length === 0) continue;

    // local tag name -> client component origin file
    const clientTags = new Map<string, string>();
    // locals imported from "use server" modules are server actions — legal props
    const actionLocals = new Set<string>();
    // locals bound to a plain (non-action) function exported by another module
    const importedFns = new Set<string>();
    // `import * as UI from './ui'` → 'UI' → the module it points at, so that a
    // namespaced tag `<UI.Button>` can be resolved to the component it renders.
    const namespaceLocals = new Map<string, string>();
    // locals bound to next/dynamic and React.lazy — the lazy-component factories
    const lazyFactories = new Set<string>();
    const reactNamespaces = new Set<string>();
    for (const imp of node.parsed.imports) {
      if (imp.specifier === 'next/dynamic') {
        for (const b of imp.bindings) if (b.imported === 'default') lazyFactories.add(b.local);
      }
      if (imp.specifier === 'react') {
        for (const b of imp.bindings) {
          if (b.imported === 'lazy') lazyFactories.add(b.local);
          if (b.imported === 'default') reactNamespaces.add(b.local); // React.lazy(…)
        }
      }
      const target = resolver.resolve(file, imp.specifier);
      if (!target) continue;
      if (imp.namespaceLocal) namespaceLocals.set(imp.namespaceLocal, target);
      for (const b of imp.bindings) {
        const origin = resolveExportOrigin(nodes, resolver, target, b.imported);
        if (!origin) continue;
        const originNode = nodes.get(origin);
        // A client component passed as a prop is a client *reference*, which React
        // does serialize — so it is a tag, never a function hazard.
        if (originNode?.parsed.directive === 'use client') {
          clientTags.set(b.local, origin);
        } else if (originNode?.parsed.directive === 'use server') {
          actionLocals.add(b.local);
        } else {
          // An imported plain function is exactly the hazard an inline arrow is —
          // it just used to be invisible, because only functions declared in *this*
          // file were tracked.
          const kind = exportedFunctionKinds(origin, exportKinds).get(b.imported);
          if (kind === 'function') importedFns.add(b.local);
          else if (kind === 'action') actionLocals.add(b.local);
        }

        // The other way a namespaced tag arrives: a barrel does
        // `export * as widgets from './widgets'`, and the importer binds `widgets`
        // by name. The local is a namespace object over that module, not a value.
        const nsReexport = nodes.get(origin)?.parsed.reexports.find((re) => re.ns === b.imported);
        if (nsReexport) {
          const nsTarget = resolver.resolve(origin, nsReexport.specifier);
          if (nsTarget) namespaceLocals.set(b.local, nsTarget);
        }
      }
    }

    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);

    // `const Chart = dynamic(() => import('./Chart'))` is a client component used as
    // a JSX tag, but it arrives as a local variable, not an import binding — so it
    // was absent from clientTags and its props were never checked at all. The tag is
    // only registered when the lazily loaded module really is "use client": a server
    // component loaded this way crosses no boundary, and flagging its props would be
    // a false positive.
    const lazyTagOrigin = (init: ts.Expression): string | null => {
      if (!ts.isCallExpression(init) || init.arguments.length === 0) return null;
      const callee = init.expression;
      const isLazyFactory = ts.isIdentifier(callee)
        ? lazyFactories.has(callee.text)
        : ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          reactNamespaces.has(callee.expression.text) &&
          callee.name.text === 'lazy';
      if (!isLazyFactory) return null;

      // The loader is `() => import('…')`, sometimes `.then(m => m.Chart)`. Take the
      // first literal import inside it; a computed specifier is not knowable.
      let specifier: string | null = null;
      const findImport = (n: ts.Node): void => {
        if (
          specifier === null &&
          ts.isCallExpression(n) &&
          n.expression.kind === ts.SyntaxKind.ImportKeyword &&
          n.arguments.length > 0 &&
          ts.isStringLiteralLike(n.arguments[0])
        ) {
          specifier = n.arguments[0].text;
          return;
        }
        ts.forEachChild(n, findImport);
      };
      findImport(init.arguments[0]);
      if (specifier === null) return null;

      const target = resolver.resolve(file, specifier);
      if (!target) return null;
      // dynamic()/lazy() render the module's default export.
      const origin = resolveExportOrigin(nodes, resolver, target, 'default') ?? target;
      return nodes.get(origin)?.parsed.directive === 'use client' ? origin : null;
    };

    if (lazyFactories.size > 0 || reactNamespaces.size > 0) {
      const collectLazy = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
          const origin = lazyTagOrigin(n.initializer);
          if (origin) clientTags.set(n.name.text, origin);
        }
        ts.forEachChild(n, collectLazy);
      };
      collectLazy(sf);
    }

    if (clientTags.size === 0 && namespaceLocals.size === 0) continue;

    /**
     * `<UI.Button>` — a namespaced tag. The tag name is a property access, not an
     * identifier, so it matched nothing and its props were never checked, even
     * though the boundary itself was found. Resolve `Button` through the namespace's
     * module; only a `"use client"` origin is a boundary, so `<UI.ServerCard>` is
     * still left alone.
     */
    const namespacedTagOrigin = (tag: ts.JsxTagNameExpression): string | null => {
      if (!ts.isPropertyAccessExpression(tag) || !ts.isIdentifier(tag.expression)) return null;
      const target = namespaceLocals.get(tag.expression.text);
      if (!target) return null;
      const origin = resolveExportOrigin(nodes, resolver, target, tag.name.text);
      if (!origin) return null;
      return nodes.get(origin)?.parsed.directive === 'use client' ? origin : null;
    };

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

    /**
     * React serializes a prop by walking into it, so a hazard buried in an object,
     * an array or a branch of a ternary breaks the build exactly like a bare one:
     * `{ onPick: () => {} }` throws at prerender just as `onPick={() => {}}` does.
     * Only the top level used to be looked at, so all of those read as `ok`.
     *
     * We descend only where the value is statically knowable. A call result, a
     * template literal or a nested JSX element is opaque — guessing at it would
     * mean inventing findings, so those stay `ok`.
     */
    const hazardOf = (expr: ts.Expression, depth = 0): PropVerdict | null => {
      if (depth > 8) return null; // pathological nesting — stop rather than stall

      if (ts.isParenthesizedExpression(expr)) return hazardOf(expr.expression, depth);
      if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr)) {
        return hazardOf(expr.expression, depth);
      }

      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        return isServerActionFn(expr) ? null : 'function';
      }
      if (ts.isNewExpression(expr)) {
        const ctor = ts.isIdentifier(expr.expression) ? expr.expression.text : null;
        return ctor && SERIALIZABLE_CTORS.has(ctor) ? null : 'class-instance';
      }
      if (ts.isCallExpression(expr) && isSymbolCallee(expr.expression)) return 'symbol';
      if (ts.isIdentifier(expr)) {
        if (actionLocals.has(expr.text) || localActions.has(expr.text)) return null; // Server Action
        if (localFns.has(expr.text) || importedFns.has(expr.text)) return 'function-ref';
        return null;
      }

      if (ts.isConditionalExpression(expr)) {
        return hazardOf(expr.whenTrue, depth + 1) ?? hazardOf(expr.whenFalse, depth + 1);
      }
      if (
        ts.isBinaryExpression(expr) &&
        (expr.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
      ) {
        return hazardOf(expr.left, depth + 1) ?? hazardOf(expr.right, depth + 1);
      }
      if (ts.isObjectLiteralExpression(expr)) {
        for (const p of expr.properties) {
          if (ts.isPropertyAssignment(p)) {
            const hit = hazardOf(p.initializer, depth + 1);
            if (hit) return hit;
          } else if (ts.isShorthandPropertyAssignment(p)) {
            const hit = hazardOf(p.name, depth + 1);
            if (hit) return hit;
          } else if (ts.isMethodDeclaration(p)) {
            if (!isServerActionFn(p)) return 'function'; // { onPick() {} }
          }
          // a spread inside the object is not knowable — leave it alone
        }
        return null;
      }
      if (ts.isArrayLiteralExpression(expr)) {
        for (const el of expr.elements) {
          if (ts.isSpreadElement(el)) continue;
          const hit = hazardOf(el, depth + 1);
          if (hit) return hit;
        }
        return null;
      }

      return null;
    };

    const classify = (attr: ts.JsxAttributeLike): { name: string; verdict: PropVerdict } => {
      if (ts.isJsxSpreadAttribute(attr)) return { name: '...spread', verdict: 'spread' };
      const name = attr.name.getText(sf);
      const init = attr.initializer;
      if (!init || ts.isStringLiteral(init)) return { name, verdict: 'ok' };
      if (ts.isJsxExpression(init) && init.expression) {
        return { name, verdict: hazardOf(init.expression) ?? 'ok' };
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
      if (tag && attrs) {
        const origin =
          ts.isIdentifier(tag) && clientTags.has(tag.text) ? clientTags.get(tag.text)! : namespacedTagOrigin(tag);
        if (origin) {
          const component = tag.getText(sf); // 'Button' or 'UI.Button'
          const componentFile = rel(origin);
          const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
          const props = attrs.properties.map(classify);
          crossings.push({ file: rel(file), component, componentFile, line, props });
          for (const p of props) {
            if (p.verdict === 'ok') continue;
            findings.push({
              file: rel(file),
              component,
              componentFile,
              prop: p.name,
              kind: p.verdict,
              line,
              message: MESSAGES[p.verdict],
            });
          }
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
