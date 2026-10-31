import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** Bundled demo entry for static hosting under web/ (no import map). */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/demo-entry.ts'),
      formats: ['es'],
      fileName: 'demo',
    },
    rollupOptions: {
      output: {
        dir: resolve(__dirname, '../../web'),
        entryFileNames: 'demo.js',
      },
    },
    emptyOutDir: false,
  },
});
