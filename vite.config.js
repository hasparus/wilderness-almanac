import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { heroScenePlugin } from './tools/hero-scene-plugin.mjs';

export default defineConfig({
  plugins: [heroScenePlugin()],
  build: {
    rolldownOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        hero: fileURLToPath(new URL('./embed/hero/index.html', import.meta.url)),
        footer: fileURLToPath(new URL('./embed/footer/index.html', import.meta.url)),
      },
    },
  },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
