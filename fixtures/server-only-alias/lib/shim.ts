// The project aliases "server-only" to this harmless local shim in tsconfig
// `paths` — a real pattern, e.g. so a test runner does not blow up on the real
// package. Next resolves the alias too, so nothing throws at build.
export {};
