import dynamic from 'next/dynamic';
import { lazy } from 'react';

// Reached ONLY through next/dynamic — the lazy client subtree must still be
// part of the graph (FP #7: these edges used to vanish). Its props cross the
// boundary exactly like a statically imported component's, and used to go
// unchecked: the tag arrives as a local variable, not an import binding.
const Chart = dynamic(() => import('../components/Chart'));

// React.lazy is the same boundary.
const Panel = lazy(() => import('../components/Panel'));

// A SERVER component, lazily loaded: no boundary, so its props must not be
// flagged even though one of them is a function.
const ServerBox = dynamic(() => import('../components/ServerBox'));

// Non-literal specifier: not statically knowable, must NOT crash or resolve —
// and must not become a client tag either.
declare const someModule: string;
const Unknowable = dynamic(() => import(someModule));

// Bundler-ignored: webpack/turbopack leave this expression as-is and ship
// nothing — no edge, even though the file exists and would "leak".
export async function loadNative() {
  return import(/* webpackIgnore: true */ '../components/Ignored');
}

// Type position: `typeof import('…')` is a type node, never a graph edge —
// the target file exists, so a wrongly-created edge WOULD show up.
export type UtilNs = typeof import('../components/TypesOnly');

export default function Page() {
  return (
    <main>
      <Chart onSelect={() => {}} thing={new WeakMap()} />
      <Panel onClose={() => {}} />
      <ServerBox render={() => 'ok'} />
      <Unknowable whatever={() => {}} />
    </main>
  );
}
