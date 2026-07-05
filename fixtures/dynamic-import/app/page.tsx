import dynamic from 'next/dynamic';

// Reached ONLY through next/dynamic — the lazy client subtree must still be
// part of the graph (FP #7: these edges used to vanish).
const Chart = dynamic(() => import('../components/Chart'));

// Non-literal specifier: not statically knowable, must NOT crash or resolve.
declare const someModule: string;
export async function loadSomething() {
  return import(someModule);
}

// Bundler-ignored: webpack/turbopack leave this expression as-is and ship
// nothing — no edge, even though the file exists and would "leak".
export async function loadNative() {
  return import(/* webpackIgnore: true */ '../components/Ignored');
}

// Type position: `typeof import('…')` is a type node, never a graph edge —
// the target file exists, so a wrongly-created edge WOULD show up.
export type UtilNs = typeof import('../components/TypesOnly');

export default function Page() {
  return <Chart />;
}
