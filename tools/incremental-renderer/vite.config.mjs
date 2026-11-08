// @ts-check
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/** @satisfies {import('vite').UserConfig} */
const config = {
  resolve: { dedupe: ['three', 'react', 'react-dom'] },
  server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  build: { manifest: true },
};

export default defineConfig(config);
