import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  clean: true,
  minify: false,
  // tsup injects baseUrl into the dts pass, which typescript@6 deprecates
  // into a hard error — silence just that deprecation, just for dts.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
});
