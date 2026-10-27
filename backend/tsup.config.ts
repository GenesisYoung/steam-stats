import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', scheduledSync: 'src/jobs/scheduledSync.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Bundle the workspace package (published as TypeScript source); keep npm deps external.
  noExternal: ['@steam-analytics/shared'],
});
