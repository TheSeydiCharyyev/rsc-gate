// Types-only shim: Next's paths plugin skips .d.ts targets and bundles the
// real package — this file must never enter the module graph.
declare module 'untyped-pkg' {
  export function thing(): string;
}
