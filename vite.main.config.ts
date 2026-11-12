import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      // @xterm/headless 6.0.0 names a "module" file that is not in the package (lib/xterm.mjs), so
      // Vite cannot resolve it. The real build is in lib-headless (AFT-85, usage-reader.ts).
      '@xterm/headless': path.resolve(__dirname, 'node_modules/@xterm/headless/lib-headless/xterm-headless.mjs'),
    },
  },
  build: {
    rollupOptions: {
      external: ['electron', 'node-pty'],
    },
  },
});
