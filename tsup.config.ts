import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  clean: true,
  minify: false,
  // dts disabled: typescript@6 turns the baseUrl deprecation into a build error.
  // The package is CLI-first; bundled type declarations will return in 0.1.1.
  dts: false,
});
