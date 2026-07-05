import ts from 'typescript';
import { readFileSync } from 'node:fs';

export type Directive = 'use client' | 'use server' | null;

export interface ImportEntry {
  specifier: string;
  /** Imported names; 'default' for a default import. Empty + namespace=false => side-effect import. */
  names: Set<string>;
  /** Local alias → exported name, e.g. `import { Button as B }` → { local: 'B', imported: 'Button' }. */
  bindings: { local: string; imported: string }[];
  /** import * as X — pulls everything */
  namespace: boolean;
  sideEffectOnly: boolean;
  /** import('…') anywhere in the module — a lazy edge, loads in the importer's env. */
  dynamic?: boolean;
}

export interface ReexportEntry {
  specifier: string;
  /** export * from './x' — forwards the source's names transparently. */
  wildcard: boolean;
  named: { imported: string; exported: string }[];
  /** export * as ns from './x' — exposes ONLY `ns`; importing it pulls the whole source. */
  ns?: string;
}

export interface ParsedModule {
  file: string;
  directive: Directive;
  imports: ImportEntry[];
  reexports: ReexportEntry[];
  localExportNames: Set<string>;
}

function hasExportModifier(st: ts.Statement): boolean {
  const mods = (st as { modifiers?: readonly ts.ModifierLike[] }).modifiers;
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasDefaultModifier(st: ts.Statement): boolean {
  const mods = (st as { modifiers?: readonly ts.ModifierLike[] }).modifiers;
  return mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

export function parseModule(file: string): ParsedModule {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);

  let directive: Directive = null;
  // Directive prologue: leading string-literal expression statements.
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteralLike(st.expression)) {
      const text = st.expression.text;
      if (text === 'use client' || text === 'use server') {
        directive = text;
        break;
      }
      continue; // other directives ('use strict') — keep scanning the prologue
    }
    break;
  }

  const imports: ImportEntry[] = [];
  const reexports: ReexportEntry[] = [];
  const localExportNames = new Set<string>();

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      if (st.importClause?.isTypeOnly) continue;
      const entry: ImportEntry = {
        specifier: st.moduleSpecifier.text,
        names: new Set(),
        bindings: [],
        namespace: false,
        sideEffectOnly: !st.importClause,
      };
      const clause = st.importClause;
      if (clause?.name) {
        entry.names.add('default');
        entry.bindings.push({ local: clause.name.text, imported: 'default' });
      }
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          entry.namespace = true;
        } else {
          for (const el of clause.namedBindings.elements) {
            if (el.isTypeOnly) continue;
            const imported = el.propertyName?.text ?? el.name.text;
            entry.names.add(imported);
            entry.bindings.push({ local: el.name.text, imported });
          }
        }
      }
      imports.push(entry);
    } else if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue;
      if (st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
        if (!st.exportClause) {
          reexports.push({ specifier: st.moduleSpecifier.text, wildcard: true, named: [] });
        } else if (ts.isNamespaceExport(st.exportClause)) {
          // export * as ns from './x' — NOT a transparent wildcard: only `ns` is
          // importable, and requesting it must pull the whole source module.
          reexports.push({
            specifier: st.moduleSpecifier.text,
            wildcard: false,
            named: [],
            ns: st.exportClause.name.text,
          });
          localExportNames.add(st.exportClause.name.text);
        } else {
          const named = st.exportClause.elements
            .filter((el) => !el.isTypeOnly)
            .map((el) => ({ imported: el.propertyName?.text ?? el.name.text, exported: el.name.text }));
          reexports.push({ specifier: st.moduleSpecifier.text, wildcard: false, named });
        }
      } else if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        // export { a, b as c } — local re-export
        for (const el of st.exportClause.elements) {
          if (!el.isTypeOnly) localExportNames.add(el.name.text);
        }
      }
    } else if (ts.isExportAssignment(st)) {
      if (!st.isExportEquals) localExportNames.add('default');
    } else if (hasExportModifier(st)) {
      if (hasDefaultModifier(st)) localExportNames.add('default');
      if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) {
        localExportNames.add(st.name.text);
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) localExportNames.add(d.name.text);
        }
      } else if (ts.isEnumDeclaration(st)) {
        localExportNames.add(st.name.text);
      }
    }
  }

  // Dynamic imports — import('…') anywhere in the module, including inside
  // next/dynamic(() => import('…')) (#7: lazy client subtrees used to vanish
  // from the graph). The namespace object may expose everything, and the
  // module evaluates in the importer's env, so it behaves like `import * as`.
  // Only literal specifiers are statically knowable; `typeof import('…')` is
  // a type node, not a CallExpression, so type positions never match.
  const visitDynamic = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments.length > 0 &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      // import(/* webpackIgnore: true */ '…') — the bundler leaves the
      // expression as-is and ships nothing, so there is no edge. The magic
      // comment is mid-line trivia before the argument (getLeadingCommentRanges
      // returns nothing for that position), so test the raw trivia slice.
      const arg = n.arguments[0];
      const trivia = sf.text.slice(arg.getFullStart(), arg.getStart(sf));
      const bundlerIgnored = /(webpack|turbopack)Ignore\s*:\s*true/.test(trivia);
      if (!bundlerIgnored) {
        imports.push({
          specifier: arg.text,
          names: new Set(),
          bindings: [],
          namespace: true,
          sideEffectOnly: false,
          dynamic: true,
        });
      }
    }
    ts.forEachChild(n, visitDynamic);
  };
  visitDynamic(sf);

  return { file, directive, imports, reexports, localExportNames };
}
