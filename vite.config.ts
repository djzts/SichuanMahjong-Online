/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// GitHub Pages serves a project site under /<repo-name>/.
// Override with BASE_PATH=/ (or any path) when hosting elsewhere.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/SichuanMahjong-Online/',
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 180_000,
  },
});
